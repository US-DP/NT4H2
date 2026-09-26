"""Admin registration for the content app."""

from django.contrib import admin

from .models import CardDefinition, CardVersion


@admin.register(CardDefinition)
class CardDefinitionAdmin(admin.ModelAdmin):
    list_display = ("card_id", "name", "card_type", "hero_class", "author", "version", "created_at")
    list_filter = ("card_type", "hero_class", "author")
    search_fields = ("card_id", "name")
    ordering = ("-created_at",)


@admin.register(CardVersion)
class CardVersionAdmin(admin.ModelAdmin):
    list_display = ("id", "card", "version", "created_at")
    list_filter = ("version",)
    search_fields = ("card__card_id", "card__name")
    ordering = ("-created_at",)
