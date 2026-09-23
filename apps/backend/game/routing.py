"""URL routing for WebSocket consumers."""
from django.urls import path

from .consumers import GameConsumer

websocket_urlpatterns = [
    path("ws/game/<str:room_id>/", GameConsumer.as_asgi()),
]
