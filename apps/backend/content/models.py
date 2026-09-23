"""Django models for the content app."""
from django.db import models


class CardDefinition(models.Model):
    """A card definition (official or custom)."""
    card_id = models.CharField(max_length=200, unique=True)
    name = models.CharField(max_length=200)
    card_type = models.CharField(max_length=20)
    hero_class = models.CharField(max_length=20, null=True, blank=True)
    copies = models.IntegerField(default=1)
    printed_attack = models.IntegerField(null=True, blank=True)
    printed_fortitude = models.IntegerField(null=True, blank=True)
    printed_cost = models.IntegerField(null=True, blank=True)
    effects = models.JSONField(default=list)
    author = models.CharField(max_length=100, default="official")
    version = models.CharField(max_length=50, default="1.0.0")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "content"


class CardVersion(models.Model):
    """A versioned snapshot of a card definition."""
    card = models.ForeignKey(CardDefinition, related_name="versions", on_delete=models.CASCADE)
    version = models.CharField(max_length=50)
    data = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "content"
        ordering = ["-created_at"]
