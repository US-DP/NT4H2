"""game.views — superficie pública del API de salas.

Paquete dividido por dominio (antes un solo views.py de ~1400 líneas):
rooms (ciclo de vida), players (moderación), engine (runner/tickets WS),
stats (leaderboard/salud) y _common (guardas, rate limit, helpers). Los
nombres públicos se reexportan aquí para que `from game.views import X`
siga funcionando sin cambios en urls.py, tests ni consumers.
"""

from ..engine_client import EngineRunnerClient  # patch target de los tests
from ._common import reap_stale_rooms
from .engine import (
    _issue_ws_ticket,
    consume_ws_ticket,
    room_engine_state,
    ws_ticket,
)
from .players import kick_player, skip_turn, transfer_host, unkick_player
from .rooms import (
    close_room,
    create_room,
    join_room,
    leave_room,
    list_rooms,
    room_state,
    set_ready,
    start_room,
)
from .stats import health_check, leaderboard, metrics, stats_community, stats_report

__all__ = [
    "EngineRunnerClient",
    "_issue_ws_ticket",
    "close_room",
    "consume_ws_ticket",
    "create_room",
    "health_check",
    "join_room",
    "kick_player",
    "leaderboard",
    "leave_room",
    "list_rooms",
    "metrics",
    "reap_stale_rooms",
    "room_engine_state",
    "room_state",
    "set_ready",
    "skip_turn",
    "start_room",
    "stats_community",
    "stats_report",
    "transfer_host",
    "unkick_player",
    "ws_ticket",
]
