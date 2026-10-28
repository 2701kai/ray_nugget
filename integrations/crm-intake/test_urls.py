from django.urls import include, path

urlpatterns = [path("api/v1/pete-intake/", include("pete_intake.urls"))]
