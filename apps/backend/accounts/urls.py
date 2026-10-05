"""Rutas de la API de cuentas."""

from django.urls import path

from .views import (
    LoginView,
    LogoutView,
    MeView,
    PlayerStatisticsView,
    RefreshView,
    RegisterView,
)

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="auth-register"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="me"),
    path("players/<uuid:user_id>/statistics/", PlayerStatisticsView.as_view(), name="player-stats"),
    # (players/<id>/ perfil público, match-history y claim-guest retirados:
    #  ningún cliente los consumía — superficie muerta de la API)
]
