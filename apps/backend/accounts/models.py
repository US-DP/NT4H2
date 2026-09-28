"""Identidad de cuenta: usuario, perfil público y estadísticas.

La identidad de partida concreta sigue siendo ``game.Player`` (con su
``auth_token`` por sala); ``User`` es la identidad persistente que se
vincula a cada ``Player`` cuando el jugador está autenticado.
"""

import uuid

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    """Manager para un modelo sin username: el login es por email."""

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("The email field must be set")
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("display_name", email.split("@")[0])
        if extra_fields.get("is_staff") is not True or extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_staff=True and is_superuser=True")
        return self.create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Cuenta persistente. Login por email; ``display_name`` es el nick público."""

    username = None
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)  # noqa: A003
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=32, unique=True)
    avatar = models.URLField(blank=True)
    locale = models.CharField(max_length=10, default="es")
    timezone = models.CharField(max_length=50, default="UTC")
    created_at = models.DateTimeField(auto_now_add=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.display_name


class PlayerProfile(models.Model):
    """Datos públicos editables del jugador (bio, país, privacidad)."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    biography = models.CharField(max_length=240, blank=True)
    country_code = models.CharField(max_length=2, blank=True)
    preferred_game_mode = models.CharField(max_length=30, blank=True)
    allow_friend_requests = models.BooleanField(default=True)
    allow_match_invites = models.BooleanField(default=True)
    show_online_status = models.BooleanField(default=True)


class PlayerStatistics(models.Model):
    """Contadores agregados del jugador (se actualizan al cerrar partidas)."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="statistics")
    games_played = models.PositiveIntegerField(default=0)
    games_won = models.PositiveIntegerField(default=0)
    games_lost = models.PositiveIntegerField(default=0)
    games_abandoned = models.PositiveIntegerField(default=0)
    total_turns = models.PositiveIntegerField(default=0)
    average_turn_seconds = models.FloatField(default=0)
