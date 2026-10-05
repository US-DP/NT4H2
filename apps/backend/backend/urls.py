"""URL configuration for NT4H backend."""

import os

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from game.views import (
    close_room,
    create_room,
    health_check,
    join_room,
    kick_player,
    leaderboard,
    leave_room,
    list_rooms,
    metrics,
    room_engine_state,
    room_state,
    set_ready,
    skip_turn,
    start_room,
    stats_community,
    stats_report,
    transfer_host,
    unkick_player,
    ws_ticket,
)

urlpatterns = [
    # Cuentas/identidad JWT (Fase 1): auth + me + players públicos
    path("api/v1/", include("accounts.urls")),
    path("api/health/", health_check, name="health"),
    path("api/metrics/", metrics, name="metrics"),
    path("api/rooms/", create_room, name="create-room"),
    path("api/rooms/list/", list_rooms, name="list-rooms"),
    path("api/rooms/<str:room_id>/", room_state, name="room-state"),
    path("api/rooms/<str:room_id>/engine/", room_engine_state, name="room-engine-state"),
    path("api/rooms/<str:room_id>/join/", join_room, name="join-room"),
    path("api/rooms/<str:room_id>/leave/", leave_room, name="leave-room"),
    path("api/rooms/<str:room_id>/ready/", set_ready, name="set-ready"),
    path("api/rooms/<str:room_id>/kick/", kick_player, name="kick-player"),
    path("api/rooms/<str:room_id>/unkick/", unkick_player, name="unkick-player"),
    path("api/rooms/<str:room_id>/start/", start_room, name="start-room"),
    path("api/rooms/<str:room_id>/transfer-host/", transfer_host, name="transfer-host"),
    path("api/rooms/<str:room_id>/close/", close_room, name="close-room"),
    path("api/rooms/<str:room_id>/skip-turn/", skip_turn, name="skip-turn"),
    path("api/rooms/<str:room_id>/ws-ticket/", ws_ticket, name="ws-ticket"),
    # Estadísticas de comunidad (anónimas, opt-in)
    path("api/stats/report/", stats_report, name="stats-report"),
    path("api/stats/community/", stats_community, name="stats-community"),
    path("api/stats/leaderboard/", leaderboard, name="stats-leaderboard"),
]

# El admin solo se monta en DEBUG, o en producción tras un path secreto
# configurable con ADMIN_URL (p. ej. ADMIN_URL=gestion-x9k2): reduce la
# superficie de brute-force del panel de administración.
_admin_path = os.environ.get("ADMIN_URL", "admin" if settings.DEBUG else "")
if _admin_path:
    urlpatterns.insert(0, path(f"{_admin_path.strip('/')}/", admin.site.urls))
