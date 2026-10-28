from django.urls import path, re_path
from . import views

urlpatterns = [
    path("", views.receive, name="pete-intake"),
    re_path(r"^operations/(?P<operation_id>[a-f0-9]{64})$", views.operation, name="pete-intake-operation"),
]
