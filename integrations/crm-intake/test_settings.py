"""Isolated tests only. Never import the legacy CRM's settings or signals."""
import os

SECRET_KEY = "synthetic-local-receiver-test-only"
DEBUG = False
ALLOWED_HOSTS = ["testserver", "127.0.0.1", "localhost"]
INSTALLED_APPS = ["pete_intake"]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
ROOT_URLCONF = "test_urls"
USE_TZ = True
MIDDLEWARE = []
STATIC_URL = "/static/"
MEDIA_URL = "/media/"
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PETE_INTAKE_AUDIENCE = "https://crm.example.test"
PETE_INTAKE_ALLOWED_SERVICE_ACCOUNTS = ["pete@synthetic.iam.gserviceaccount.com"]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
# The only PostgreSQL destination accepted by this test configuration is the
# ephemeral localhost container started by the Bun test runner.
if os.environ.get("PETE_TEST_POSTGRES_PORT"):
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql", "HOST": "127.0.0.1",
        "PORT": int(os.environ["PETE_TEST_POSTGRES_PORT"]), "NAME": "pete_receiver_test",
        "USER": "pete_test", "PASSWORD": "synthetic-local-test-only",
        "CONN_MAX_AGE": 0,
    }}
