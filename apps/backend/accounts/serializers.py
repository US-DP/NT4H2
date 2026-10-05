"""Serializers de la API de cuentas (auth JWT + perfil)."""

import re

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import PlayerProfile, User

_DISPLAY_NAME_RE = re.compile(r"^[\w.\-ñáéíóúüÑÁÉÍÓÚÜ ]{2,32}$")


class RegisterSerializer(serializers.Serializer):  # pylint: disable=abstract-method
    """Registro por email + contraseña + nick público."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    display_name = serializers.CharField(min_length=2, max_length=32)
    locale = serializers.ChoiceField(choices=("es", "en"), default="es", required=False)

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("email already registered")
        return value.lower()

    def validate_display_name(self, value: str) -> str:
        value = value.strip()
        if not _DISPLAY_NAME_RE.match(value):
            raise serializers.ValidationError("invalid display name")
        if User.objects.filter(display_name__iexact=value).exists():
            raise serializers.ValidationError("display name already taken")
        return value

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def create(self, validated_data) -> User:
        user = User.objects.create_user(**validated_data)
        PlayerProfile.objects.create(user=user)
        from .models import PlayerStatistics

        PlayerStatistics.objects.create(user=user)
        return user


class ProfileSerializer(serializers.ModelSerializer):
    """Perfil público del usuario."""

    class Meta:
        model = PlayerProfile
        fields = (
            "biography",
            "country_code",
            "preferred_game_mode",
            "allow_friend_requests",
            "allow_match_invites",
            "show_online_status",
        )


class UserSerializer(serializers.ModelSerializer):
    """Vista del propio usuario (privada)."""

    profile = ProfileSerializer()

    class Meta:
        model = User
        fields = ("id", "email", "display_name", "avatar", "locale", "timezone", "created_at", "profile")
        read_only_fields = ("id", "email", "created_at")


class PlayerStatisticsSerializer(serializers.Serializer):  # pylint: disable=abstract-method
    """Contadores agregados del jugador."""

    games_played = serializers.IntegerField()
    games_won = serializers.IntegerField()
    games_lost = serializers.IntegerField()
    games_abandoned = serializers.IntegerField()
    total_turns = serializers.IntegerField()
    average_turn_seconds = serializers.FloatField()
    win_rate = serializers.SerializerMethodField()

    def get_win_rate(self, obj) -> float:
        if not obj.games_played:
            return 0.0
        return round(obj.games_won / obj.games_played, 4)
