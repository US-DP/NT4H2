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
    # Propiedad del contenido custom: hash truncado del token que la creó.
    # Un rol 'author' solo puede editar sus propias cartas; las filas sin
    # dueño (legadas o creadas por publisher/admin) requieren publisher+.
    owner_hash = models.CharField(max_length=16, null=True, blank=True)
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


class ContentAuditEntry(models.Model):
    """Registro inmutable de operaciones de escritura sobre contenido.

    Nunca guarda el token en claro — solo su hash truncado para atribuir
    la operación a una credencial concreta sin exponerla.
    """

    token_hash = models.CharField(max_length=16)
    role = models.CharField(max_length=20)
    action = models.CharField(max_length=20)  # create|update|delete|publish|import
    entity_type = models.CharField(max_length=40)  # card|card_version|set|...
    entity_id = models.CharField(max_length=200)
    detail = models.JSONField(default=dict)
    outcome = models.CharField(max_length=20, default="ok")  # ok|denied|error
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "content"
        ordering = ["-created_at"]
