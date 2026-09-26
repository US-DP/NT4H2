"""URL configuration for NT4H backend."""

from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from content.views import (
    CardDefinitionViewSet,
    CardVersionViewSet,
    card_by_id,
    import_card,
)
from game.views import (
    close_room,
    create_room,
    health_check,
    join_room,
    kick_player,
    leaderboard,
    leave_room,
    list_rooms,
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

# DRF router for content CRUD
router = DefaultRouter()
router.register(r"cards", CardDefinitionViewSet, basename="card-definition")
router.register(r"card-versions", CardVersionViewSet, basename="card-version")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health"),
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
    # Content custom endpoints (must be BEFORE router to avoid being matched as detail views)
    path("api/cards/by-id/<str:card_id>/", card_by_id, name="card-by-id"),
    path("api/cards/import/", import_card, name="card-import"),
    # Content CRUD (DRF router)
    path("api/", include(router.urls)),
]
