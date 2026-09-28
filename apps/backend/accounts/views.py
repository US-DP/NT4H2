"""Endpoints de identidad: registro, tokens JWT, perfil y claim de invitado."""

import contextlib
import hmac
import logging

from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from game.models import GameSession, Player

from .authentication import get_auth_user
from .models import User
from .serializers import (
    PlayerStatisticsSerializer,
    ProfileSerializer,
    PublicUserSerializer,
    RegisterSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)


class _AuthedAPIView(APIView):
    """APIView base que autentica por Bearer JWT (solo vistas de cuentas).

    La auth no es global a propósito: los Bearer de CONTENT_API_TOKEN no
    son JWT y morirían con 401 en el interceptor antes de su permission.
    """

    authentication_classes = (JWTAuthentication,)
    permission_classes = (IsAuthenticated,)


def _tokens_for(user) -> dict:
    """Par access/refresh para un usuario recién autenticado."""
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


class RegisterView(APIView):
    """POST /api/v1/auth/register — crea cuenta y devuelve tokens."""

    authentication_classes = ()
    permission_classes = ()

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        logger.info("user registered %s", user.display_name)
        return JsonResponse({"user": UserSerializer(user).data, "tokens": _tokens_for(user)}, status=201)


class LoginView(TokenObtainPairView):
    """POST /api/v1/auth/login — {email, password} → {access, refresh}."""


class RefreshView(TokenRefreshView):
    """POST /api/v1/auth/refresh — rota el refresh (blacklist del viejo)."""


@method_decorator(csrf_exempt, name="dispatch")
class LogoutView(_AuthedAPIView):
    """POST /api/v1/auth/logout — revoca el refresh token (blacklist)."""

    def post(self, request):
        refresh = request.data.get("refresh", "")
        if not isinstance(refresh, str) or not refresh:
            return JsonResponse({"error": "refresh is required"}, status=400)
        # Un refresh inválido/expirado no debe tumbar el logout
        with contextlib.suppress(Exception):
            RefreshToken(refresh).blacklist()
        return JsonResponse({"ok": True})


@method_decorator(csrf_exempt, name="dispatch")
class MeView(_AuthedAPIView):
    """GET/PATCH /api/v1/me — perfil propio (usuario + profile embebidos)."""

    def get(self, request):
        return JsonResponse(UserSerializer(request.user).data)

    def patch(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        profile_data = data.get("profile", {})
        for field in ("display_name", "avatar", "locale", "timezone"):
            if field in data:
                setattr(request.user, field, str(data[field])[:100])
        request.user.save()
        if isinstance(profile_data, dict):
            profile = request.user.profile
            ser = ProfileSerializer(profile, data=profile_data, partial=True)
            ser.is_valid(raise_exception=True)
            ser.save()
        return JsonResponse(UserSerializer(request.user).data)


@method_decorator(csrf_exempt, name="dispatch")
class PublicUserView(_AuthedAPIView):
    """GET /api/v1/players/<user_id> — perfil público de otro jugador."""

    def get(self, request, user_id):
        try:
            user = User.objects.select_related("profile").get(pk=user_id)
        except (User.DoesNotExist, ValueError):
            return JsonResponse({"error": "Player not found"}, status=404)
        return JsonResponse(PublicUserSerializer(user).data)


@method_decorator(csrf_exempt, name="dispatch")
class PlayerStatisticsView(_AuthedAPIView):
    """GET /api/v1/players/<user_id>/statistics — contadores del jugador."""

    def get(self, request, user_id):
        try:
            user = User.objects.select_related("statistics").get(pk=user_id)
        except (User.DoesNotExist, ValueError):
            return JsonResponse({"error": "Player not found"}, status=404)
        return JsonResponse(PlayerStatisticsSerializer(user.statistics).data)


@method_decorator(csrf_exempt, name="dispatch")
class MatchHistoryView(_AuthedAPIView):
    """GET /api/v1/players/<user_id>/match-history — partidas del jugador."""

    def get(self, request, user_id):
        try:
            user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError):
            return JsonResponse({"error": "Player not found"}, status=404)
        sessions = GameSession.objects.filter(players__user=user).order_by("-updated_at").distinct()[:50]
        return JsonResponse({"games": [s.to_dict(include_private_config=False) for s in sessions]})


@method_decorator(csrf_exempt, name="dispatch")
class ClaimGuestView(_AuthedAPIView):
    """POST /api/v1/auth/claim-guest — vincula un Player de sala al usuario.

    El invitado demuestra posesión con su (roomId, playerId, playerToken);
    la cuenta queda vinculada y el historial/statistics lo heredan.
    """

    def post(self, request):
        room_id = str(request.data.get("roomId", ""))[:64]
        player_id = str(request.data.get("playerId", ""))[:64]
        token = str(request.data.get("playerToken", ""))[:256]
        if not room_id or not player_id or not token:
            return JsonResponse({"error": "roomId, playerId and playerToken are required"}, status=400)
        try:
            player = Player.objects.select_related("session").get(session__room_id=room_id, player_id=player_id)
        except Player.DoesNotExist:
            return JsonResponse({"error": "Player not found"}, status=404)
        if not hmac.compare_digest(player.auth_token, token):
            return JsonResponse({"error": "Invalid player token"}, status=403)
        if player.user_id is not None and player.user_id != request.user.id:
            return JsonResponse({"error": "Player already claimed by another account"}, status=409)
        player.user = request.user
        player.save(update_fields=["user"])
        logger.info("guest player %s claimed by %s", player_id, request.user.display_name)
        return JsonResponse({"claimed": True, "player": player.to_dict()})


def require_auth(request):
    """403 si la petición no lleva un JWT válido. Devuelve (user, error)."""
    user = get_auth_user(request)
    if user is None:
        return None, JsonResponse({"error": "Authentication required"}, status=401)
    return user, None
