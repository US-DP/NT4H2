from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import PlayerProfile, PlayerStatistics, User


class ProfileInline(admin.StackedInline):
    model = PlayerProfile
    can_delete = False


class StatisticsInline(admin.StackedInline):
    model = PlayerStatistics
    can_delete = False


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Public", {"fields": ("display_name", "avatar", "locale", "timezone")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "created_at")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "display_name", "password1", "password2")}),)
    readonly_fields = ("id", "created_at")
    list_display = ("email", "display_name", "is_staff", "created_at")
    search_fields = ("email", "display_name")
    ordering = ("email",)
    inlines = (ProfileInline, StatisticsInline)


@admin.register(PlayerProfile)
class PlayerProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "country_code", "preferred_game_mode")


@admin.register(PlayerStatistics)
class PlayerStatisticsAdmin(admin.ModelAdmin):
    list_display = ("user", "games_played", "games_won", "games_lost")
