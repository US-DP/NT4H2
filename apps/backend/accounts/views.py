"""Endpoints de identidad: registro, tokens JWT, perfil y claim de invitado."""

import contextlib
import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.db import IntegrityError
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from game.views._common import _rate_limited

from .models import PlayerProfile, PlayerStatistics, User
from .serializers import (
    _DISPLAY_NAME_RE,
    PlayerStatisticsSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)


class _AuthedAPIView(APIView):
    """APIView base que autentica por Bearer JWT (solo vistas de cuentas).

    La auth no es global a propósito: los Bearer no-JWT (tokens de
    servicio históricos) morirían con 401 en el interceptor antes de
    llegar a sus permissions.
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
        # Rate limit por IP (scope "auth"): register/login son el punto
        # de entrada a brute-force de credenciales y enumeración de emails.
        if _rate_limited(request, "auth"):
            return JsonResponse({"error": "Too many requests"}, status=429)
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = serializer.save()
        except IntegrityError:
            # TOCTOU: otro registro concurrente con el mismo
            # email/display_name pasó la validación pero perdió la carrera.
            return JsonResponse({"error": "email or display name already registered"}, status=409)
        logger.info("user registered %s", user.display_name)
        return JsonResponse({"user": UserSerializer(user).data, "tokens": _tokens_for(user)}, status=201)


class LoginView(TokenObtainPairView):
    """POST /api/v1/auth/login — {email, password} → {access, refresh}."""

    def post(self, request, *args, **kwargs):
        # Mismo rate limit que register: fuerza bruta de contraseñas.
        if _rate_limited(request, "auth"):
            return JsonResponse({"error": "Too many requests"}, status=429)
        return super().post(request, *args, **kwargs)


class RefreshView(TokenRefreshView):
    """POST /api/v1/auth/refresh — rota el refresh (blacklist del viejo)."""

    def post(self, request, *args, **kwargs):
        # Mismo rate limit que login/register: un flood de refresh es
        # un vector de enumeración/DoS que quedaba libre (auditoría).
        if _rate_limited(request, "auth"):
            return JsonResponse({"error": "Too many requests"}, status=429)
        return super().post(request, *args, **kwargs)


@method_decorator(csrf_exempt, name="dispatch")
class LogoutView(_AuthedAPIView):
    """POST /api/v1/auth/logout — revoca el refresh token (blacklist)."""

    def post(self, request):
        # request.data puede no ser dict (JSON array/escalar) — .get
        # lanzaría AttributeError y devolvería 500 por un body malformado.
        data = request.data if isinstance(request.data, dict) else {}
        refresh = data.get("refresh", "")
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

        # Validar como el registro: un PATCH sin checks permitía 500 por
        # IntegrityError (display_name unique), DataError (locale>10 en
        # Postgres) y, peor, tomar "alice" existiendo "Alice" — el unique
        # de BD es case-sensitive y el anti-impersonación del leaderboard
        # (display_name__iexact) quedaba roto para cuentas registradas.
        errors = {}
        if "display_name" in data:
            value = str(data["display_name"]).strip()[:32]
            if not _DISPLAY_NAME_RE.match(value):
                errors["display_name"] = "invalid display name"
            elif User.objects.filter(display_name__iexact=value).exclude(pk=request.user.pk).exists():
                errors["display_name"] = "display name already taken"
            else:
                request.user.display_name = value
        if "avatar" in data:
            value = str(data["avatar"])[:200]
            if value:
                try:
                    URLValidator()(value)
                except DjangoValidationError:
                    errors["avatar"] = "invalid avatar url"
            if "avatar" not in errors:
                request.user.avatar = value
        if "locale" in data:
            value = str(data["locale"])[:10]
            if value not in ("es", "en"):
                errors["locale"] = "unsupported locale"
            else:
                request.user.locale = value
        if "timezone" in data:
            request.user.timezone = str(data["timezone"])[:50]
        if errors:
            return JsonResponse({"errors": errors}, status=400)
        try:
            request.user.save()
        except IntegrityError:
            return JsonResponse({"error": "display name already taken"}, status=409)
        if isinstance(profile_data, dict):
            # get_or_create: usuarios sin PlayerProfile (creados por
            # createsuperuser/admin) provocaban RelatedObjectDoesNotExist.
            profile, _ = PlayerProfile.objects.get_or_create(user=request.user)
            ser = ProfileSerializer(profile, data=profile_data, partial=True)
            ser.is_valid(raise_exception=True)
            ser.save()
        return JsonResponse(UserSerializer(request.user).data)


@method_decorator(csrf_exempt, name="dispatch")
class PlayerStatisticsView(_AuthedAPIView):
    """GET /api/v1/players/<user_id>/statistics — contadores del jugador."""

    def get(self, request, user_id):
        try:
            user = User.objects.select_related("statistics").get(pk=user_id)
        except (User.DoesNotExist, ValueError):
            return JsonResponse({"error": "Player not found"}, status=404)
        # get_or_create: autocura usuarios sin fila de estadísticas
        statistics, _ = PlayerStatistics.objects.get_or_create(user=user)
        return JsonResponse(PlayerStatisticsSerializer(statistics).data)
