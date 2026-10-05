"""Endpoints de estadísticas comunitarias, leaderboard y health."""

import logging

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..models import CommunityStat, LeaderboardEntry
from ._common import _guard_post, _rate_limited

logger = logging.getLogger(__name__)


@csrf_exempt
def health_check(request):
    """Health check endpoint (solo GET/HEAD)."""
    if request.method not in ("GET", "HEAD"):
        return JsonResponse({"error": "method not allowed"}, status=405)
    return JsonResponse({"status": "ok", "service": "nt4h-backend"})


def metrics(request):
    """Métricas en formato texto Prometheus (`GET /api/metrics/`).

    Protegido por ``METRICS_TOKEN`` (Bearer) cuando está configurado;
    sin el env solo responde a localhost (sondeo interno).
    Contadores derivados del estado persistido — sin telemetría extra.
    """
    import os

    from django.http import HttpResponse

    token = os.environ.get("METRICS_TOKEN", "")
    if token:
        if request.headers.get("Authorization") != f"Bearer {token}":
            return JsonResponse({"error": "unauthorized"}, status=401)
    elif request.META.get("REMOTE_ADDR") not in ("127.0.0.1", "::1", "localhost"):
        return JsonResponse({"error": "metrics are localhost-only without METRICS_TOKEN"}, status=403)

    from django.db.models import Count

    from ..models import GameEvent, GameSession, Player

    lines: list[str] = [
        "# HELP nt4h_rooms_total Salas por estado",
        "# TYPE nt4h_rooms_total gauge",
    ]
    by_status = {row["status"]: row["n"] for row in GameSession.objects.values("status").annotate(n=Count("id"))}
    for status in ("WAITING", "PLAYING", "FINISHED"):
        lines.append(f'nt4h_rooms_total{{status="{status.lower()}"}} {by_status.get(status, 0)}')
    lines += [
        "# HELP nt4h_players_connected Jugadores con socket abierto",
        "# TYPE nt4h_players_connected gauge",
        f"nt4h_players_connected {Player.objects.filter(is_connected=True).count()}",
        "# HELP nt4h_events_total Eventos persistidos (comandos + chat)",
        "# TYPE nt4h_events_total counter",
        f"nt4h_events_total {GameEvent.objects.count()}",
    ]
    return HttpResponse("\n".join(lines) + "\n", content_type="text/plain; version=0.0.4")


# Estadísticas de comunidad — informes anónimos opt-in (contadores
# agregados; nunca se persiste quién informa ni cuándo).
MAX_ACHIEVEMENTS_PER_REPORT = 50


@csrf_exempt
def stats_report(request):
    """Recibe un informe anónimo de desbloqueos del jugador.

    Body: {"unlocks": ["achievement-id", ...]}. Cada informe cuenta como
    UN reportero: `rarity` mide el % de informantes que tiene el logro.
    """
    data, guard_error = _guard_post(request, "stats")
    if guard_error is not None:
        return guard_error

    unlocks = data.get("unlocks")
    if not isinstance(unlocks, list):
        return JsonResponse({"error": "unlocks must be a list"}, status=400)
    ids = {str(a)[:50] for a in unlocks if isinstance(a, str) and 0 < len(a) <= 50 and a != "_total"}
    ids = set(list(ids)[:MAX_ACHIEVEMENTS_PER_REPORT])

    with transaction.atomic():
        total, _ = CommunityStat.objects.select_for_update().get_or_create(achievement_id="_total")
        total.reporters += 1
        total.save(update_fields=["reporters"])
        for achievement_id in ids:
            row, _ = CommunityStat.objects.select_for_update().get_or_create(achievement_id=achievement_id)
            row.reporters += 1
            row.save(update_fields=["reporters"])

    return JsonResponse({"ok": True})


def stats_community(request):
    """Devuelve % de informantes que posee cada logro ("rareza")."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if _rate_limited(request, "read"):
        return JsonResponse({"error": "Too many requests"}, status=429)
    rows = list(CommunityStat.objects.all())
    total = next((r.reporters for r in rows if r.achievement_id == "_total"), 0)
    rarity = (
        {r.achievement_id: round(r.reporters / total, 4) for r in rows if r.achievement_id != "_total"} if total else {}
    )
    return JsonResponse({"reports": total, "rarity": rarity})


@csrf_exempt
def leaderboard(request):
    """Clasificación pública opt-in.

    GET → top 25 por victorias {"entries": [{name, wins, games}]}.
    POST {"name": str, "won": bool} → suma 1 partida (+1 victoria si won).
    El cliente solo informa si el usuario activó la casilla pública.
    """
    if request.method == "GET":
        if _rate_limited(request, "read"):
            return JsonResponse({"error": "Too many requests"}, status=429)
        entries = LeaderboardEntry.objects.order_by("-wins", "-games", "name")[:25]
        return JsonResponse({"entries": [e.to_dict() for e in entries]})

    data, guard_error = _guard_post(request, "leaderboard")
    if guard_error is not None:
        return guard_error

    # Con sesión JWT el nombre es el display_name de la cuenta — nadie
    # puede farmear victorias bajo el nick registrado de otro usuario.
    # La entrada anónima sigue permitida: el informe es opt-in y
    # auto-declarado por diseño (no es una clasificación competitiva).
    from accounts.authentication import get_auth_user

    auth_user = get_auth_user(request)
    name = auth_user.display_name if auth_user is not None else str(data.get("name", "")).strip()[:40]
    # Sanitizar: sin caracteres de control; el nombre vacío no clasifica
    name = "".join(c for c in name if ord(c) >= 32).strip()
    if not name or name.startswith("_"):
        return JsonResponse({"error": "name is required"}, status=400)
    if auth_user is None:
        # Un anónimo no puede escribir bajo el display_name de una
        # cuenta registrada — el nick público de otro no se suplanta.
        from accounts.models import User

        if User.objects.filter(display_name__iexact=name).exists():
            return JsonResponse(
                {"error": "That name belongs to a registered account — log in to use it"},
                status=409,
            )
    won = data.get("won") is True

    with transaction.atomic():
        entry, _ = LeaderboardEntry.objects.select_for_update().get_or_create(name=name)
        entry.games += 1
        if won:
            entry.wins += 1
        entry.save(update_fields=["wins", "games", "updated_at"])

    return JsonResponse({"ok": True, "entry": entry.to_dict()})
