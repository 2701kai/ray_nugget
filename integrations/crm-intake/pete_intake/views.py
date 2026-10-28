from django.core.exceptions import RequestDataTooBig
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .auth import service_identity
from .contract import MAX_BODY_BYTES, parse_delivery
from .models import IntakeLead, IntakeOperation


def response(body, status=200):
    result = JsonResponse(body, status=status)
    result["Cache-Control"] = "no-store"
    return result


@csrf_exempt
@require_http_methods(["POST"])
@service_identity
def receive(request):
    if request.content_type != "application/json":
        return response({"error": "JSON is required."}, 415)
    try:
        if len(request.body) > MAX_BODY_BYTES:
            return response({"error": "Delivery is too large."}, 413)
        body, envelope, body_hash = parse_delivery(request.body)
    except RequestDataTooBig:
        return response({"error": "Delivery is too large."}, 413)
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        return response({"error": "Invalid lead delivery."}, 400)
    # No legacy CRM Lead model, signal, email, Zendesk or newsletter call belongs
    # here. The inbox update and immutable receipt share this transaction.
    with transaction.atomic():
        lead, _ = IntakeLead.objects.get_or_create(external_id=body["leadId"], defaults={
            "workspace_id": envelope["workspace"]["id"], "owner_email": body["owner"]["email"],
        })
        lead = IntakeLead.objects.select_for_update().get(pk=lead.pk)
        previous = IntakeOperation.objects.filter(pk=body["operationId"]).first()
        if previous:
            if previous.body_hash != body_hash:
                return response({"error": "Operation was already used for different details."}, 409)
            return response(previous.receipt)
        if lead.workspace_id != envelope["workspace"]["id"]:
            return response({"error": "Lead workspace cannot change."}, 409)
        if body["sequence"] == lead.sequence:
            return response({"error": "Lead sequence is already occupied."}, 409)
        state = "received" if body["sequence"] > lead.sequence else "superseded"
        if state == "received":
            if body["owner"]["version"] < lead.owner_version:
                return response({"error": "Lead owner version cannot move backward."}, 409)
            if body["owner"]["version"] == lead.owner_version and body["owner"]["email"] != lead.owner_email:
                return response({"error": "Owner changed without a new version."}, 409)
            lead.sequence = body["sequence"]
            lead.owner_email = body["owner"]["email"]
            lead.owner_version = body["owner"]["version"]
            lead.envelope = envelope
            lead.save()
        receipt = {
            "format": "pete-crm-receipt/v1", "operationId": body["operationId"], "leadId": body["leadId"],
            "sequence": body["sequence"], "sourceReceiptId": body["sourceReceiptId"],
            "envelopeSha256": body["envelopeSha256"], "status": state,
            "recordId": lead.pk, "receivedAt": timezone.now().isoformat(), "messagesSent": False,
        }
        IntakeOperation.objects.create(operation_id=body["operationId"], lead=lead, sequence=body["sequence"], body_hash=body_hash, receipt=receipt)
    return response(receipt, 201)


@require_http_methods(["GET"])
@service_identity
def operation(request, operation_id):
    saved = IntakeOperation.objects.filter(pk=operation_id).first()
    return response(saved.receipt) if saved else response({"error": "Operation not found."}, 404)
