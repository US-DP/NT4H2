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
    """Health check endpoint."""
    return JsonResponse({"status": "ok", "service": "nt4h-backend"})


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

    name = str(data.get("name", "")).strip()[:40]
    # Sanitizar: sin caracteres de control; el nombre vacío no clasifica
    name = "".join(c for c in name if ord(c) >= 32).strip()
    if not name or name.startswith("_"):
        return JsonResponse({"error": "name is required"}, status=400)
    won = data.get("won") is True

    with transaction.atomic():
        entry, _ = LeaderboardEntry.objects.select_for_update().get_or_create(name=name)
        entry.games += 1
        if won:
            entry.wins += 1
        entry.save(update_fields=["wins", "games", "updated_at"])

    return JsonResponse({"ok": True, "entry": entry.to_dict()})
