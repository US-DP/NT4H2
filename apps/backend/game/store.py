"""Estado compartido entre workers vía django.core.cache.

Con ``REDIS_URL`` configurada, ``CACHES`` apunta a Redis y todos los
contadores/tickets/dedups son globales (multi-worker). Sin ella se usa
LocMemCache — por proceso, mismo comportamiento que los dicts en
memoria anteriores.

Componentes:
- Rate limiting REST: ventana deslizante por (scope, ip).
- Tickets WS de un solo uso + índice por jugador para revocación.
- Conteo de espectadores por sala (cap global, no N×workers).
- Idempotencia de ``clientMessageId`` de chat (sobrevive a reconexiones,
  a diferencia del set por conexión anterior).
"""

import contextlib
import secrets
import time

from django.core.cache import cache

# --- Rate limiting -----------------------------------------------------------

_RATE_WINDOW = 60.0


def rate_hit(scope: str, ip: str, limit: int) -> bool:
    """True si (scope, ip) supera ``limit`` hits en la ventana.

    Ventana deslizante en cache (lista de timestamps). El get→append→set
    no es atómico entre workers — la carrera solo puede *infra-contar*
    (alguna petición extra en el borde), nunca bloquear de más.
    """
    key = f"rl:{scope}:{ip}"
    now = time.monotonic()
    hits = cache.get(key) or []
    hits = [t for t in hits if now - t < _RATE_WINDOW]
    if len(hits) >= limit:
        cache.set(key, hits, timeout=int(_RATE_WINDOW) + 10)
        return True
    hits.append(now)
    cache.set(key, hits, timeout=int(_RATE_WINDOW) + 10)
    return False


# --- Tickets WS (un solo uso, ~60 s) -----------------------------------------

_WS_TICKET_TTL = 60  # segundos


def ws_ticket_create(room_id: str, player_id: str) -> str:
    """Emite ticket de un solo uso para (sala, jugador)."""
    ticket = secrets.token_urlsafe(32)
    cache.set(f"wst:{ticket}", {"room_id": room_id, "player_id": player_id}, timeout=_WS_TICKET_TTL)
    # Índice por jugador para revocación en kick/leave.
    idx_key = f"wstix:{room_id}:{player_id}"
    idx = cache.get(idx_key) or []
    idx.append(ticket)
    cache.set(idx_key, idx[-64:], timeout=_WS_TICKET_TTL + 30)
    return ticket


def ws_ticket_consume(ticket: str) -> dict | None:
    """Consume el ticket: devuelve {room_id, player_id} o None.

    get→delete tiene una carrera de ms entre workers (doble consumo);
    la mitiga el TTL corto y que la membresía se re-verifica tras el
    connect. Con Redis, delete es atómico sobre la misma clave.
    """
    info = cache.get(f"wst:{ticket}")
    if info is None:
        return None
    cache.delete(f"wst:{ticket}")
    return info


def ws_tickets_revoke(room_id: str, player_id: str) -> int:
    """Invalida los tickets pendientes de un jugador. Devuelve cuántos."""
    idx_key = f"wstix:{room_id}:{player_id}"
    idx = cache.get(idx_key) or []
    removed = 0
    for ticket in idx:
        if cache.delete(f"wst:{ticket}"):
            removed += 1
    cache.delete(idx_key)
    return removed


# --- Conteo de espectadores --------------------------------------------------

_SPECTATOR_MAX_PER_ROOM = 32
_SPEC_TTL = 6 * 3600  # un contador stale de un worker muerto expira solo


def spectator_try_add(room_id: str) -> bool:
    """True si la sala admite un espectador más (cap global)."""
    key = f"spec:{room_id}"
    try:
        cache.add(key, 0, timeout=_SPEC_TTL)
        n = cache.incr(key)
        cache.touch(key, _SPEC_TTL)
        if n <= _SPECTATOR_MAX_PER_ROOM:
            return True
        _spectator_undo(key)
        return False
    except ValueError:  # clave evanescente perdida entre add/incr
        return True


def _spectator_undo(key: str) -> None:
    """Deshace un incr por encima del cap."""
    with contextlib.suppress(ValueError):
        cache.decr(key)


def spectator_remove(room_id: str) -> None:
    key = f"spec:{room_id}"
    try:
        if (cache.get(key) or 0) > 0:
            cache.decr(key)
    except ValueError:
        pass


# --- Idempotencia de chat (clientMessageId) ----------------------------------

_CMID_TTL = 300  # 5 min: cubre el resend tras reconexión


def chat_cmid_is_duplicate(room_id: str, player_id: str, cmid: str) -> bool:
    """True si este clientMessageId ya fue emitido.

    ``cache.add`` es atómico (SETNX en Redis): dos entregas concurrentes
    del mismo cmid no pueden pasar ambas — aunque provengan de sockets
    distintos del mismo jugador (doble pestaña, reconexión rápida).
    """
    if not cmid:
        return False
    return not cache.add(f"cmid:{room_id}:{player_id}:{cmid}", 1, timeout=_CMID_TTL)
