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
    create_room,
    health_check,
    join_room,
    leave_room,
    list_rooms,
    room_engine_state,
    room_state,
    start_room,
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
    path("api/rooms/<str:room_id>/start/", start_room, name="start-room"),
    # Content custom endpoints (must be BEFORE router to avoid being matched as detail views)
    path("api/cards/by-id/<str:card_id>/", card_by_id, name="card-by-id"),
    path("api/cards/import/", import_card, name="card-import"),
    # Content CRUD (DRF router)
    path("api/", include(router.urls)),
]
