"""Django settings for NT4H backend."""

import os
import sys
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY: leer SECRET_KEY de variable de entorno; el fallback solo es
# aceptable en desarrollo (DJANGO_DEBUG=True) o durante los tests.
# En produccion (DEBUG=False, no tests) el arranque con esta clave se rechaza abajo.
_DEV_SECRET_KEY = "dev-secret-key-change-in-production"  # nosec B105  # noqa: S105
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", _DEV_SECRET_KEY)
DEBUG = os.environ.get("DJANGO_DEBUG", "False").lower() == "true"
TESTING = "test" in sys.argv
ALLOWED_HOSTS = [
    h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()
]

if not DEBUG and not TESTING and SECRET_KEY == _DEV_SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is False")

INSTALLED_APPS = [
    "daphne",
    "channels",
    "corsheaders",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.admin",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "accounts",
    "game.apps.GameConfig",
    "content",
]

AUTH_USER_MODEL = "accounts.User"

# Validadores estándar de Django: el registro los aplica vía validate_password.
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CORS debe ir lo más alto posible (antes de CommonMiddleware) para
    # poder responder también a los preflight OPTIONS.
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backend.wsgi.application"
ASGI_APPLICATION = "backend.asgi.application"

DATABASES: dict[str, dict[str, str | int]] = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("SQLITE_PATH", str(BASE_DIR / "db.sqlite3")),
    }
}

# Base de datos de producción via DATABASE_URL (postgres://user:pass@host:port/db).
# SQLite sigue siendo el default en dev/tests.
_database_url = os.environ.get("DATABASE_URL", "")
if _database_url:
    from urllib.parse import urlparse

    _db = urlparse(_database_url)
    if _db.scheme in ("postgres", "postgresql"):
        DATABASES["default"] = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db.path.lstrip("/"),
            "USER": _db.username or "",
            "PASSWORD": _db.password or "",
            "HOST": _db.hostname or "",
            "PORT": str(_db.port or 5432),
            "CONN_MAX_AGE": 60,
        }
    else:
        raise RuntimeError(f"DATABASE_URL scheme not supported: {_db.scheme}")

# CORS: orígenes permitidos explícitos (CSV en CORS_ALLOWED_ORIGINS).
# En dev se acepta el dev-server de Expo por defecto. Nunca usar '*'.
_cors_env = os.environ.get("CORS_ALLOWED_ORIGINS", "")
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]
if DEBUG and not CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081"]

# D437: capa de canales — Redis en producción (REDIS_URL), memoria en dev.
REDIS_URL = os.environ.get("REDIS_URL", "")
if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [REDIS_URL]},
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }

# DRF: por defecto solo lectura anónima; las escrituras de contenido pueden
# protegerse con CONTENT_API_TOKEN (Bearer) — ver content/views.py.
# Las vistas de cuentas autentican con JWT (simplejwt); las vistas de salas
# siguen usando playerToken + get_auth_user() para el enlace opcional.
# NB: NO DEFAULT_AUTHENTICATION_CLASSES global — el Bearer de
# CONTENT_API_TOKEN pasaría por JWTAuthentication y moriría con 401
# antes del permission check. JWT se declara por vista en accounts.
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    # Rotación + blacklist: un refresh robado queda invalidado al primer uso
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

LANGUAGE_CODE = "es-es"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Seguridad adicional en producción
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    X_FRAME_OPTIONS = "DENY"
    # Detrás de proxy terminador TLS (nginx/ALB): confiar en X-Forwarded-Proto
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # No redirigir durante tests: el cliente de test usa http:// y un 301
    # rompería cada petición. En producción real se fuerza con la env o on.
    SECURE_SSL_REDIRECT = not TESTING and os.environ.get("SECURE_SSL_REDIRECT", "true").lower() == "true"

# Producción: fail-closed si falta infraestructura obligatoria.
# El runner sin token compartido acepta comandos de cualquiera.
if not DEBUG and not TESTING:
    if not os.environ.get("ENGINE_RUNNER_TOKEN"):
        raise RuntimeError("ENGINE_RUNNER_TOKEN must be set when DJANGO_DEBUG is False")
    if not os.environ.get("CONTENT_API_TOKEN") and not os.environ.get("CONTENT_API_TOKENS"):
        raise RuntimeError("CONTENT_API_TOKEN(S) must be set when DJANGO_DEBUG is False")
    if not REDIS_URL:
        raise RuntimeError(
            "REDIS_URL must be set when DJANGO_DEBUG is False "
            "(InMemoryChannelLayer no comparte estado entre procesos)"
        )
