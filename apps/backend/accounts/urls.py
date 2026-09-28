"""Rutas de la API de cuentas."""

from django.urls import path

from .views import (
    ClaimGuestView,
    LoginView,
    LogoutView,
    MatchHistoryView,
    MeView,
    PlayerStatisticsView,
    PublicUserView,
    RefreshView,
    RegisterView,
)

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="auth-register"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/claim-guest/", ClaimGuestView.as_view(), name="auth-claim-guest"),
    path("me/", MeView.as_view(), name="me"),
    path("players/<uuid:user_id>/", PublicUserView.as_view(), name="player-detail"),
    path("players/<uuid:user_id>/statistics/", PlayerStatisticsView.as_view(), name="player-stats"),
    path("players/<uuid:user_id>/match-history/", MatchHistoryView.as_view(), name="player-history"),
]
