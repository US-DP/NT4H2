"""Django models for the game app."""
import secrets
import string

from django.db import models


def _generate_room_id():
    """Generate a short, readable room code."""
    return ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


def _generate_player_token():
    """Generate an unguessable per-player auth token for the session."""
    return secrets.token_urlsafe(32)


class GameSession(models.Model):
    """A game session (room)."""
    room_id = models.CharField(max_length=20, unique=True, default=_generate_room_id)
    mode = models.CharField(max_length=20, default="STANDARD")
    status = models.CharField(max_length=20, default="WAITING")
    seed = models.CharField(max_length=200, default="")
    host_id = models.CharField(max_length=100, default="")
    max_players = models.IntegerField(default=4)
    config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "game"

    def to_dict(self):
        # SECURITY: seed NUNCA sale del servidor — el motor es determinista
        # y con la seed cualquiera podría predecir los robos del RNG.
        return {
            "roomId": self.room_id,
            "mode": self.mode,
            "status": self.status,
            "hostId": self.host_id,
            "maxPlayers": self.max_players,
            "config": self.config,
            "players": [p.to_dict() for p in self.players.all()],
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }


class Player(models.Model):
    """A player inside a game room."""
    session = models.ForeignKey(GameSession, related_name="players", on_delete=models.CASCADE)
    player_id = models.CharField(max_length=100)
    name = models.CharField(max_length=100)
    is_connected = models.BooleanField(default=True)
    # Recuento de conexiones WS abiertas: un jugador con dos pestañas solo
    # pasa a offline cuando TODAS sus conexiones se cierran.
    connection_count = models.IntegerField(default=0)
    is_host = models.BooleanField(default=False)
    hero_id = models.CharField(max_length=100, blank=True, default="")
    # D431: token de autorizacion por jugador — requerido para acciones
    # sensibles (start, leave, comandos WS, estado proyectado). Nunca se
    # expone en to_dict() ni en listados.
    auth_token = models.CharField(max_length=128, default=_generate_player_token)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "game"
        unique_together = ["session", "player_id"]

    def to_dict(self):
        return {
            "playerId": self.player_id,
            "name": self.name,
            "connected": self.is_connected,
            "isHost": self.is_host,
            "heroId": self.hero_id,
            "joinedAt": self.joined_at.isoformat(),
        }


class GameEvent(models.Model):
    """An event in a game session (event sourcing)."""
    session = models.ForeignKey(GameSession, related_name="events", on_delete=models.CASCADE)
    seq = models.IntegerField()
    event_type = models.CharField(max_length=50)
    player_id = models.CharField(max_length=100, null=True, blank=True)
    data = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "game"
        ordering = ["seq"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "seq"], name="uniq_event_seq_per_session"
            )
        ]
