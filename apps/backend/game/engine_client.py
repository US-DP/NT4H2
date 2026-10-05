"""Client for the engine-runner HTTP service."""

import json
import logging
import os

import httpx  # noqa: ASYNC127 - httpx sigue mantenido; la sugerencia httpx2 es errónea

logger = logging.getLogger(__name__)

ENGINE_RUNNER_URL = os.environ.get("ENGINE_RUNNER_URL", "http://localhost:3001")
# D433: secreto compartido backend → runner. Vacío solo en dev — el runner
# rechaza arrancar sin token a menos que ENGINE_RUNNER_DEV_OPEN=1.
ENGINE_RUNNER_TOKEN = os.environ.get("ENGINE_RUNNER_TOKEN", "")
if not ENGINE_RUNNER_TOKEN:
    logger.warning(
        "ENGINE_RUNNER_TOKEN vacío — el runner aceptará peticiones sin auth (solo aceptable en desarrollo local)"
    )


def _url(path: str) -> str:
    return f"{ENGINE_RUNNER_URL}{path}"


def _headers() -> dict:
    if ENGINE_RUNNER_TOKEN:
        return {"X-Engine-Token": ENGINE_RUNNER_TOKEN}
    return {}


# B-12: techo al body de respuesta del runner. Un runner mal portado (o
# un proxy que devuelve una página gigante) descargaba en memoria sin
# límite antes del .json().
_RESPONSE_MAX_BYTES = 8 * 1024 * 1024


def _bounded_get(client: httpx.Client, url: str, *, params: dict | None = None) -> dict:
    """GET con lectura acotada: corta si el body supera _RESPONSE_MAX_BYTES."""
    with client.stream("GET", url, params=params, headers=_headers()) as response:
        response.raise_for_status()
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > _RESPONSE_MAX_BYTES:
                raise ValueError(f"runner response too large (>{_RESPONSE_MAX_BYTES} bytes)")
            chunks.append(chunk)
    return json.loads(b"".join(chunks))


def _post_idempotent(path: str, body: dict, *, timeout: float) -> "httpx.Response":
    """POST con UN reintento ante errores de transporte (no de estado).

    Un ReadTimeout/ConnectError no dice si el runner aplicó la petición;
    la dedup por cid (comandos) o el 409 already-exists (restore) hacen
    el reintento seguro. Un HTTPStatusError nunca se reintenta: es una
    respuesta real del runner.
    """
    last_exc: httpx.HTTPError | None = None
    for _attempt in range(2):
        try:
            with httpx.Client(timeout=timeout) as client:
                return client.post(_url(path), json=body, headers=_headers())
        except httpx.HTTPStatusError:
            raise
        except httpx.HTTPError as exc:
            last_exc = exc
            logger.warning("runner POST %s falló (intento %s/2): %s", path, _attempt + 1, exc)
    assert last_exc is not None
    raise last_exc


class EngineRunnerClient:  # noqa: PIE798 - namespacing deliberado sobre los 5 endpoints
    """Thin client that delegates game state execution to engine-runner."""

    @staticmethod
    def create_room(room_id: str, config: dict) -> dict:
        with httpx.Client(timeout=5.0) as client:
            response = client.post(
                _url(f"/rooms/{room_id}/create"),
                json={"config": config},
                headers=_headers(),
            )
            response.raise_for_status()
            return response.json()

    @staticmethod
    def execute_command(
        room_id: str,
        cid: str,
        player_id: str,
        command: dict,
        *,
        expected_revision: int | None = None,
        client_sequence: int | None = None,
    ) -> dict:
        body = {"cid": cid, "playerId": player_id, "command": command}
        if expected_revision is not None:
            body["expectedRevision"] = expected_revision
        if client_sequence is not None:
            body["clientSequence"] = client_sequence
        response = _post_idempotent(f"/rooms/{room_id}/command", body, timeout=5.0)
        # 409 stale_revision: propagar al cliente para que re-sincronice
        if response.status_code == 409:
            data = response.json()
            return {"accepted": False, "reason": "stale_revision", "revision": data.get("revision")}
        # 429 rate limit del runner: un rechazo honesto — no es un runner
        # caído y no debe persistirse como engine_unavailable.
        if response.status_code == 429:
            return {"accepted": False, "reason": "rate_limited"}
        # 403 unknown_player: el jugador no es de la sala (kick pendiente
        # de propagar, race con el cierre…). Sin esta rama el cliente
        # recibía "engine_unavailable" — un motivo falso.
        if response.status_code == 403:
            data = response.json()
            return {"accepted": False, "reason": data.get("reason") or "unknown_player"}
        # 400 del runner = rechazo de validación (Zod, cid inválido…), no
        # una caída: propagar el motivo real en vez de "engine_unavailable".
        if response.status_code == 400:
            data = response.json()
            return {"accepted": False, "reason": data.get("error") or data.get("reason") or "invalid_command"}
        response.raise_for_status()
        return response.json()

    @staticmethod
    def get_state(room_id: str, player_id: str | None = None) -> dict:
        with httpx.Client(timeout=5.0) as client:
            params = {"playerId": player_id} if player_id else None
            return _bounded_get(client, _url(f"/rooms/{room_id}/state"), params=params)

    @staticmethod
    def get_full_state(room_id: str) -> dict:
        """Estado COMPLETO de la sala (state + rngState + revision).

        PRIVACY: uso interno — contiene manos y RNG sin proyectar.
        Solo para snapshots/auditoría del backend; nunca servir a clientes.
        """
        with httpx.Client(timeout=5.0) as client:
            return _bounded_get(client, _url(f"/rooms/{room_id}/full-state"))

    @staticmethod
    def restore_room(room_id: str, snapshot: dict) -> dict:
        """Restaura una sala perdida en el runner desde un snapshot.

        El snapshot es el blob completo guardado en GameSnapshot.state
        (state + rngState + revision + lastClientSeq) más customSets de
        la config de la sala. PRIVACY: igual que full-state — interno.
        """
        response = _post_idempotent(
            f"/rooms/{room_id}/restore",
            {"snapshot": snapshot},
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()

    @staticmethod
    def delete_room(room_id: str) -> dict:
        """Elimina la sala del runner (cleanup de salas abandonadas)."""
        with httpx.Client(timeout=5.0) as client:
            response = client.delete(
                _url(f"/rooms/{room_id}"),
                headers=_headers(),
            )
            response.raise_for_status()
            return response.json()
