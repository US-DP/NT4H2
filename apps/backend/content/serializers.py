"""Serializers for the content app (CardDefinition, CardVersion)."""
from rest_framework import serializers

from .models import CardDefinition, CardVersion


class CardVersionSerializer(serializers.ModelSerializer):
    """Serializer for a versioned snapshot of a card definition."""

    class Meta:
        model = CardVersion
        fields = ["id", "card", "version", "data", "created_at"]
        read_only_fields = ["id", "created_at"]


class CardDefinitionSerializer(serializers.ModelSerializer):
    """Serializer for a card definition (official or custom)."""
    versions = CardVersionSerializer(many=True, read_only=True)

    class Meta:
        model = CardDefinition
        fields = [
            "id", "card_id", "name", "card_type", "hero_class",
            "copies", "printed_attack", "printed_fortitude", "printed_cost",
            "effects", "author", "version", "created_at", "versions",
        ]
        read_only_fields = ["id", "created_at"]
