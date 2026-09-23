"""Views for the content app — REST CRUD API for cards."""
import hmac
import os

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import CardDefinition, CardVersion
from .serializers import CardDefinitionSerializer, CardVersionSerializer

# D438: si CONTENT_API_TOKEN está definido, las escrituras requieren
# "Authorization: Bearer <token>". Si no está definido (dev/tests), abierto.
CONTENT_API_TOKEN = os.environ.get("CONTENT_API_TOKEN", "")


class ContentWritePermission(permissions.BasePermission):
    """Lectura pública; escritura protegida por token cuando está configurado."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        if not CONTENT_API_TOKEN:
            return True
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False
        return hmac.compare_digest(auth[len("Bearer "):], CONTENT_API_TOKEN)


def _check_write_token(request):
    """Para @api_view: None si permitido, Response 403 si no."""
    if not CONTENT_API_TOKEN:
        return None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and hmac.compare_digest(auth[len("Bearer "):], CONTENT_API_TOKEN):
        return None
    return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)


class CardDefinitionViewSet(viewsets.ModelViewSet):
    """CRUD endpoint for card definitions.

    Routes:
      GET    /api/cards/                 — list
      POST   /api/cards/                 — create
      GET    /api/cards/<card_id>/       — retrieve (card_id allows dots, e.g. 'explorer.rapid-shot')
      PUT    /api/cards/<card_id>/       — update
      PATCH  /api/cards/<card_id>/       — partial update
      DELETE /api/cards/<card_id>/       — destroy
    """
    queryset = CardDefinition.objects.all().order_by("-created_at")
    serializer_class = CardDefinitionSerializer
    permission_classes = [ContentWritePermission]
    lookup_field = "card_id"
    lookup_value_regex = "[^/]+"  # allow dots, hyphens in card_id


class CardVersionViewSet(viewsets.ModelViewSet):
    """CRUD endpoint for card version snapshots.

    Routes:
      GET    /api/card-versions/         — list
      POST   /api/card-versions/         — create
      GET    /api/card-versions/<id>/    — retrieve
      DELETE /api/card-versions/<id>/    — destroy
    """
    queryset = CardVersion.objects.all().order_by("-created_at")
    serializer_class = CardVersionSerializer
    permission_classes = [ContentWritePermission]


@api_view(["GET"])
def card_by_id(request, card_id):
    """Lookup a card definition by its card_id (e.g. 'explorer.rapid-shot').

    GET /api/cards/by-id/<card_id>/
    """
    try:
        card = CardDefinition.objects.get(card_id=card_id)
    except CardDefinition.DoesNotExist:
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)
    serializer = CardDefinitionSerializer(card)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([ContentWritePermission])
def import_card(request):
    """Import a card definition from JSON (idempotent by card_id).

    POST /api/cards/import/
    Body: full card definition JSON.
    """
    denied = _check_write_token(request)
    if denied is not None:
        return denied
    card_id = request.data.get("card_id")
    if not card_id:
        return Response({"detail": "card_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    payload = dict(request.data)
    payload.pop("id", None)
    card, created = CardDefinition.objects.update_or_create(
        card_id=card_id,
        defaults=payload,
    )
    serializer = CardDefinitionSerializer(card)
    return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
