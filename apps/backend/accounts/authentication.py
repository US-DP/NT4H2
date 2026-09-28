"""Autenticación JWT para las vistas de función (no-DRF) del proyecto.

Las vistas de ``game.views`` son funciones csrf_exempt con sus propios
tokens por sala; este helper extrae el usuario del Bearer JWT sin
pasar por el middleware de DRF para que esas vistas puedan vincular
``Player`` ↔ ``User``.
"""

import logging

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

logger = logging.getLogger(__name__)

_jwt = JWTAuthentication()


def get_auth_user(request):
    """Devuelve el User autenticado por Bearer JWT o None.

    Nunca lanza: un token inválido/ausente simplemente deja la petición
    anónima (los endpoints de salas siguen funcionando con playerToken).
    """
    try:
        result = _jwt.authenticate(request)
    except (InvalidToken, TokenError):
        return None
    except Exception:  # noqa: PIE786  # pylint: disable=broad-exception-caught
        logger.warning("jwt authenticate failed", exc_info=True)
        return None
    if result is None:
        return None
    user, _token = result
    return user if user.is_active else None
