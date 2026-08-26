"""
Django settings for Spotter ELD Trip Planner (assessment MVP).
"""
from pathlib import Path
import os

import dj_database_url
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-only-insecure-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() in {"1", "true", "yes"}
ALLOWED_HOSTS = [
    h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "trips",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

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

WSGI_APPLICATION = "config.wsgi.application"

# PostgreSQL only (no SQLite). Prefer DATABASE_URL; else discrete POSTGRES_* vars.
_default_db_url = (
    f"postgres://{os.getenv('POSTGRES_USER', 'postgres')}:"
    f"{os.getenv('POSTGRES_PASSWORD', 'postgres')}@"
    f"{os.getenv('POSTGRES_HOST', '127.0.0.1')}:"
    f"{os.getenv('POSTGRES_PORT', '5432')}/"
    f"{os.getenv('POSTGRES_DB', 'spotter_eld')}"
)
DATABASES = {
    "default": dj_database_url.config(
        default=os.getenv("DATABASE_URL", _default_db_url),
        conn_max_age=600,
        conn_health_checks=True,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "UNAUTHENTICATED_USER": None,
}

# CORS — frontend (Vite local + Vercel)
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = False

CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",")
    if o.strip()
]

# Behind nginx / reverse proxy on your VPS
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = os.getenv("USE_X_FORWARDED_HOST", "false").lower() in {
    "1",
    "true",
    "yes",
}

# Free map / routing APIs (no paid keys)
MAP_USER_AGENT = os.getenv(
    "MAP_USER_AGENT",
    "SpotterELDTripPlanner/1.0 (assessment; https://github.com/spotter-eld-trip-planner)",
)
MAP_HTTP_TIMEOUT = float(os.getenv("MAP_HTTP_TIMEOUT", "20"))
NOMINATIM_BASE_URL = os.getenv("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
PHOTON_BASE_URL = os.getenv("PHOTON_BASE_URL", "https://photon.komoot.io")
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org")
MAP_TILE_ATTRIBUTION = "© OpenStreetMap contributors"
