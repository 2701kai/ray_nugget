from django.db import models


class IntakeLead(models.Model):
    """Separate inbox record: never a subclass of the CRM's automated Lead."""

    external_id = models.CharField(max_length=64, primary_key=True)
    sequence = models.PositiveBigIntegerField(default=0)
    workspace_id = models.CharField(max_length=128)
    owner_email = models.CharField(max_length=254)
    owner_version = models.PositiveBigIntegerField(default=1)
    envelope = models.JSONField(default=dict)
    received_at = models.DateTimeField(auto_now=True)


class IntakeOperation(models.Model):
    operation_id = models.CharField(max_length=64, primary_key=True)
    lead = models.ForeignKey(IntakeLead, on_delete=models.PROTECT)
    sequence = models.PositiveBigIntegerField()
    body_hash = models.CharField(max_length=64)
    receipt = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["lead", "sequence"], name="pete_intake_lead_sequence")
        ]
