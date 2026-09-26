"""Views for the content app — REST CRUD API for cards."""

import hashlib
import hmac
import json
import logging
import os

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import CardDefinition, CardVersion, ContentAuditEntry
from .serializers import CardDefinitionSerializer, CardVersionSerializer

logger = logging.getLogger(__name__)

# D438: escrituras de contenido protegidas por tokens con ROL.
#
#   Ejemplo: CONTENT_API_TOKENS con JSON de token a rol
#            ("<tok1>" -> "author", "<tok2>" -> "publisher")
#
# Roles (de menor a mayor):
#   author    — crea/edita/elimina SOLO contenido personalizado
#               (CardDefinition.author != 'official'). No publica versiones.
#   publisher — además puede tocar contenido oficial y crear CardVersion.
#   admin     — todo (equivale al legado CONTENT_API_TOKEN).
#
# CONTENT_API_TOKEN (legado) sigue funcionando como 'admin' para no romper
# despliegues existentes — migrar a CONTENT_API_TOKENS.
#
# Toda operación de escritura queda registrada en ContentAuditEntry con el
# hash del token, nunca el token en claro.
CONTENT_API_TOKEN = os.environ.get("CONTENT_API_TOKEN", "")
_CONTENT_TOKENS_RAW = os.environ.get("CONTENT_API_TOKENS", "")

_ROLE_RANK = {"viewer": 0, "author": 1, "publisher": 2, "admin": 3}


def _token_roles() -> dict:
    """Mapa token -> role desde CONTENT_API_TOKENS (JSON o 'tok:role,...')."""
    roles: dict = {}
    if _CONTENT_TOKENS_RAW:
        try:
            parsed = json.loads(_CONTENT_TOKENS_RAW)
            if isinstance(parsed, dict):
                roles = dict(parsed)
        except json.JSONDecodeError:
            for pair in _CONTENT_TOKENS_RAW.split(","):
                if ":" in pair:
                    tok, role = pair.split(":", 1)
                    roles[tok.strip()] = role.strip()
    if CONTENT_API_TOKEN:
        roles[CONTENT_API_TOKEN] = "admin"
    return roles


def _role_for(request) -> str | None:
    """Devuelve el rol del token Bearer, o None si no hay token válido."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer ") :]
    for tok, role in _token_roles().items():
        if hmac.compare_digest(token, tok):
            return role
    return None


def _token_hash(request) -> str:
    """Hash truncado del token para auditoría (nunca el token en claro)."""
    auth = request.headers.get("Authorization", "")
    token = auth[len("Bearer ") :] if auth.startswith("Bearer ") else "anon"
    return hashlib.sha256(token.encode()).hexdigest()[:16]


def _audit(request, role, action, entity_type, entity_id, *, detail=None, outcome="ok"):
    """Registra la operación de escritura; fallos de log no bloquean."""
    try:
        ContentAuditEntry.objects.create(
            token_hash=_token_hash(request),
            role=role or "none",
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            detail=detail or {},
            outcome=outcome,
        )
    except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
        # La auditoría no debe tumbar la API
        logger.exception("content audit failed")


def _content_scope_check(request, view, obj=None):
    """True si el rol permite la operación; escribe auditoría en denegación."""
    if request.method in permissions.SAFE_METHODS:
        return True
    role = _role_for(request)
    # Sin tokens configurados (dev/tests) → abierto
    if not _token_roles():
        return True
    if role is None:
        return False
    rank = _ROLE_RANK.get(role, 0)
    # Operaciones sobre contenido oficial requieren publisher+
    is_official = getattr(obj, "author", None) == "official"
    if is_official and rank < _ROLE_RANK["publisher"]:
        return False
    # Escribir author='official' en el payload (create/update/import) es
    # equivalente a tocar contenido oficial: exige publisher+ aunque obj
    # sea None (create) o una carta custom (promoción a oficial).
    try:
        target_author = request.data.get("author")
    except AttributeError:  # petición sin data parseable
        target_author = None
    if target_author == "official" and rank < _ROLE_RANK["publisher"]:
        return False
    # Ownership entre authors: una carta custom solo la edita su creador
    # (mismo hash de token); sin dueño registrado exige publisher+.
    if (
        obj is not None
        and not is_official
        and role == "author"
        and getattr(obj, "owner_hash", None) != _token_hash(request)
    ):
        return False
    # DELETE siempre requiere publisher+
    if request.method == "DELETE" and rank < _ROLE_RANK["publisher"]:
        return False
    # CardVersion (publicación inmutable) requiere publisher+
    return not (view.__class__.__name__ == "CardVersionViewSet" and rank < _ROLE_RANK["publisher"])


class ContentWritePermission(permissions.BasePermission):
    """Lectura pública; escritura con token con rol suficiente."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return _content_scope_check(request, view)

    def has_object_permission(self, request, view, obj):
        return _content_scope_check(request, view, obj)


def _check_write_token(request, obj=None, action="write"):
    """Para @api_view: None si permitido, Response 403 si no (con auditoría)."""
    if not _token_roles():
        return None
    role = _role_for(request)
    fake_view = type("V", (), {"__name__": "FunctionView"})
    ok = role is not None and _content_scope_check(request, fake_view, obj)
    if not ok:
        _audit(request, role, action, "card", getattr(obj, "card_id", "?"), outcome="denied")
        return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
    return None


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

    def perform_create(self, serializer):
        # Registrar el dueño: los authors solo pueden editar sus cartas.
        obj = serializer.save(owner_hash=_token_hash(self.request))
        _audit(
            self.request,
            _role_for(self.request),
            "create",
            "card",
            obj.card_id,
            detail={"version": obj.version, "author": obj.author},
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        _audit(
            self.request,
            _role_for(self.request),
            "update",
            "card",
            obj.card_id,
            detail={"version": obj.version, "author": obj.author},
        )

    def perform_destroy(self, instance):
        _audit(
            self.request,
            _role_for(self.request),
            "delete",
            "card",
            instance.card_id,
            detail={"version": instance.version},
        )
        instance.delete()


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
    card_id = request.data.get("card_id")
    if not card_id:
        return Response({"detail": "card_id is required"}, status=status.HTTP_400_BAD_REQUEST)
    # Scope check con el OBJETO REAL: si ya existe y es oficial o de otro
    # author, un rol 'author' no puede sobrescribirla vía import.
    existing = CardDefinition.objects.filter(card_id=card_id).first()
    denied = _check_write_token(request, existing, action="import")
    if denied is not None:
        return denied
    # Whitelist: solo campos del modelo — un campo desconocido en el
    # payload crudo provocaba FieldError (500) en update_or_create.
    allowed = {
        "name",
        "card_type",
        "hero_class",
        "copies",
        "printed_attack",
        "printed_fortitude",
        "printed_cost",
        "effects",
        "author",
        "version",
    }
    payload = {k: v for k, v in request.data.items() if k in allowed}
    if existing is None:
        payload["owner_hash"] = _token_hash(request)
    card, created = CardDefinition.objects.update_or_create(
        card_id=card_id,
        defaults=payload,
    )
    serializer = CardDefinitionSerializer(card)
    return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
