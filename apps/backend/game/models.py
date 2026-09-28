"""Django models for the game app."""

import secrets
import string

from django.db import models


def _generate_room_id():
    """Generate a short, readable room code."""
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


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
    # D440: player_ids expulsados por el host — no pueden re-unirse a la
    # sala mientras esté en WAITING (revocación lógica del token: aunque
    # conserven el auth_token, join y WS connect lo rechazan).
    kicked_ids = models.JSONField(default=list, blank=True)
    # Revisión monotónica de la sala: cada mutación (join/leave/ready/
    # kick/start) la incrementa. Los clientes descartan respuestas REST
    # o broadcasts con revisión <= a la última aplicada (anti-stale).
    revision = models.PositiveIntegerField(default=0)
    # Reloj de turno autoritativo: el backend observa el activePlayerId
    # proyectado por el runner y guarda cuándo empezó — los clientes
    # sincronizan su contador con este timestamp (anti-AFK justo para todos).
    turn_player_id = models.CharField(max_length=100, default="", blank=True)
    turn_started_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "game"

    # Claves de config compartibles con no-miembros: el manifest, las
    # versiones y los snapshots de sets (las definiciones que un invitado
    # necesita importar para poder jugar). Lo que SÍ queda privado son
    # los pools del motor (hordeCardIds/warlordIds/marketCardIds…): saber
    # qué hordas o señores hay en la partida es información oculta.
    _PUBLIC_CONFIG_KEYS = {
        "contentManifest",
        "useScenarios",
        "mode",
        "scenarioIds",
        "catalogVersion",
        "engineVersion",
        "customSets",
    }

    def to_dict(self, include_private_config: bool = True):
        # SECURITY: seed NUNCA sale del servidor — el motor es determinista
        # y con la seed cualquiera podría predecir los robos del RNG.
        config = self.config or {}
        if not include_private_config:
            config = {k: v for k, v in config.items() if k in self._PUBLIC_CONFIG_KEYS}
        return {
            "roomId": self.room_id,
            "mode": self.mode,
            "status": self.status,
            "hostId": self.host_id,
            "revision": self.revision,
            "maxPlayers": self.max_players,
            "config": config,
            "players": [p.to_dict() for p in self.players.all()],
            # Expulsados: solo ids — el host necesita la lista para
            # «Permitir volver»; no contiene credenciales.
            "kickedIds": list(self.kicked_ids or []),
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
    # Preparado para empezar: el host solo puede iniciar cuando todos los
    # invitados están listos (el propio host lo está implícitamente).
    is_ready = models.BooleanField(default=False)
    hero_id = models.CharField(max_length=100, blank=True, default="")
    # Elección del jugador para el motor: mazo de habilidades y cara del
    # héroe. Sin ambos, start_room no puede incluirlo en el roster del
    # runner (los invitados declaran su héroe al entrar, no en create).
    deck_id = models.CharField(max_length=100, blank=True, default="")
    hero_face = models.CharField(max_length=10, blank=True, default="")
    # Mazo del Taller: si se informa, sustituye a deck_id en el roster del
    # motor. La definición viaja en session.config["customDecks"].
    custom_deck_id = models.CharField(max_length=100, blank=True, default="")
    # D431: token de autorizacion por jugador — requerido para acciones
    # sensibles (start, leave, comandos WS, estado proyectado). Nunca se
    # expone en to_dict() ni en listados.
    auth_token = models.CharField(max_length=128, default=_generate_player_token)
    # Fase 1 (identidad persistente): si el jugador entró autenticado con
    # JWT, su Player de sala queda vinculado a su cuenta para historial,
    # estadísticas y ELO. Invitados: null hasta claim-guest.
    user = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="game_players",
    )
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
            "ready": self.is_ready,
            "heroId": self.hero_id,
            "deckId": self.deck_id,
            "heroFace": self.hero_face,
            "customDeckId": self.custom_deck_id,
            "userId": str(self.user_id) if self.user_id else None,
            "joinedAt": self.joined_at.isoformat(),
        }


class CommunityStat(models.Model):
    """Aggregate anonymous stats shared by players (opt-in).

    PRIVACY: solo contadores acumulativos por achievement_id — sin
    usuario, IP, sala ni timestamp. La fila reservada ``_total`` lleva
    el número de informes recibidos (denominador de la "rareza" de cada
    logro, como los % globales de desbloqueo de Steam).
    """

    achievement_id = models.CharField(max_length=50, primary_key=True)
    reporters = models.PositiveIntegerField(default=0)

    class Meta:
        app_label = "game"


class LeaderboardEntry(models.Model):
    """Clasificación pública opt-in: victorias por nombre visible.

    PRIVACY: el nombre lo elige el jugador (displayName) y solo se envía
    si activa la casilla de clasificación pública. Sin ids ni datos del
    dispositivo — el propio nombre ES la identidad pública optada.
    """

    name = models.CharField(max_length=40, primary_key=True)
    wins = models.PositiveIntegerField(default=0)
    games = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "game"

    def to_dict(self):
        return {"name": self.name, "wins": self.wins, "games": self.games}


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
        constraints = [models.UniqueConstraint(fields=["session", "seq"], name="uniq_event_seq_per_session")]


class GameSnapshot(models.Model):
    """Checkpoint del estado del motor para replay/recuperación (Fase 2).

    Contiene el estado COMPLETO del runner (manos privadas, RNG, dedup
    de cids). PRIVACY: nunca se sirve a clientes — es almacenamiento
    interno de auditoría; la proyección por jugador sigue en el runner.
    Se conservan como máximo ``MAX_SNAPSHOTS_PER_SESSION`` por sala.
    """

    session = models.ForeignKey(GameSession, related_name="snapshots", on_delete=models.CASCADE)
    # seq del último GameEvent cubierto por el snapshot
    seq = models.IntegerField()
    # revisión del estado en el runner al tomar el snapshot
    revision = models.IntegerField(default=0)
    state = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "game"
        ordering = ["-seq"]
