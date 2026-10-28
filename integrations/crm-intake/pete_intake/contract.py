import hashlib
import json
import math
import re


# The source manifest is capped at 4 MiB upstream. A JSON string can double
# escaping overhead when enclosed in this delivery; leave room for its wrapper.
MAX_BODY_BYTES = 10 * 1024 * 1024
MAX_SEQUENCE = 9_007_199_254_740_991
HEX = re.compile(r"^[a-f0-9]{64}$")


def sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def strict_json(raw):
    def text(value):
        if "\0" in value:
            raise ValueError("NUL is not supported by the destination JSON store.")
        value.encode("utf-8")  # Reject unpaired surrogate escapes.

    def pairs(items):
        result = {}
        for key, value in items:
            text(key)
            if key in result:
                raise ValueError("Repeated JSON key.")
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ValueError("Invalid JSON number.")

    def inspect(value):
        if isinstance(value, str):
            text(value)
        elif isinstance(value, float) and not math.isfinite(value):
            raise ValueError("Invalid JSON number.")
        elif isinstance(value, dict):
            for item in value.values():
                inspect(item)
        elif isinstance(value, list):
            for item in value:
                inspect(item)
    result = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    inspect(result)
    return result


def parse_delivery(raw):
    """Check binding before persistence; source evidence stays byte-exact."""
    if len(raw) > MAX_BODY_BYTES:
        raise ValueError("Delivery is too large.")
    body = strict_json(raw)
    required = {"format", "operationId", "leadId", "sequence", "sourceReceiptId", "owner", "envelopeSha256", "envelopeJson"}
    if not isinstance(body, dict) or set(body) != required or body["format"] != "pete-crm-delivery/v1":
        raise ValueError("Invalid delivery format.")
    for field in ["operationId", "leadId", "sourceReceiptId", "envelopeSha256"]:
        if not isinstance(body[field], str) or not HEX.fullmatch(body[field]):
            raise ValueError("Invalid delivery identity.")
    sequence = body["sequence"]
    if type(sequence) is not int or not 1 <= sequence <= MAX_SEQUENCE:
        raise ValueError("Invalid delivery sequence.")
    expected = sha(f'pete-crm/v1/{body["leadId"]}/{sequence}')
    if body["operationId"] != expected:
        raise ValueError("Operation does not belong to this lead sequence.")
    owner = body["owner"]
    if (not isinstance(owner, dict) or set(owner) != {"email", "version"}
            or not isinstance(owner["email"], str) or not 1 <= len(owner["email"]) <= 254
            or type(owner["version"]) is not int or not 1 <= owner["version"] <= MAX_SEQUENCE):
        raise ValueError("Invalid owner.")
    source = body["envelopeJson"]
    if not isinstance(source, str) or sha(source) != body["envelopeSha256"]:
        raise ValueError("Source digest mismatch.")
    envelope = strict_json(source)
    if (not isinstance(envelope, dict) or envelope.get("format") != "pete-lead/v1"
            or envelope.get("leadId") != body["leadId"] or envelope.get("receiptId") != body["sourceReceiptId"]):
        raise ValueError("Source belongs to another lead or receipt.")
    workspace = envelope.get("workspace")
    if (not isinstance(workspace, dict) or not isinstance(workspace.get("id"), str)
            or not re.fullmatch(r"[a-z0-9-]{1,128}", workspace["id"])):
        raise ValueError("Invalid workspace.")
    permissions = {"inquiry": "not_collected", "followup": "not_collected", "newsletter": "not_collected"}
    if envelope.get("permissions") != permissions:
        raise ValueError("This intake does not accept sending permissions.")
    source_meta = envelope.get("source", {})
    if (not isinstance(source_meta, dict) or not isinstance(source_meta.get("fingerprint"), str)
            or not HEX.fullmatch(source_meta["fingerprint"])
            or body["sourceReceiptId"] != sha(f'{body["leadId"]}/{source_meta["fingerprint"]}')):
        raise ValueError("Source receipt mismatch.")
    draft_id = source_meta.get("draftId")
    if (not isinstance(draft_id, str) or not draft_id
            or body["leadId"] != sha(f'pete-lead/v1/{sha("pete-team/" + workspace["id"])}/{sha(draft_id)}')):
        raise ValueError("Lead does not belong to this workspace and visitor.")
    for field in ["contact", "request", "provenance", "readiness"]:
        if not isinstance(envelope.get(field), dict):
            raise ValueError("Invalid source fields.")
    if envelope["request"].get("intent") not in ["unspecified", "buy", "sell"]:
        raise ValueError("Invalid request intent.")
    if envelope["request"].get("unit") not in ["", "bottles/h", "units/h", "L/h"]:
        raise ValueError("Invalid throughput unit.")
    sources = envelope.get("sources")
    if not isinstance(sources, list) or len(sources) > 250:
        raise ValueError("Invalid sources.")
    ids = set()
    for item in sources:
        if (not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]
                or item["id"] in ids or not isinstance(item.get("sha256"), str)
                or not HEX.fullmatch(item["sha256"]) or item.get("kind") not in ["card", "voice"]):
            raise ValueError("Invalid or repeated source identity.")
        ids.add(item["id"])
        if item.get("voiceMode") == "conversation" and item.get("consentConfirmed") is not True:
            raise ValueError("Conversation consent is missing.")
        if item["kind"] == "voice" and item.get("voiceMode") not in [None, "memo", "conversation"]:
            raise ValueError("Invalid voice mode.")
    for origin in envelope["provenance"].values():
        if not isinstance(origin, dict) or origin.get("source") not in ["manual", "extraction"]:
            raise ValueError("Invalid provenance.")
        if origin["source"] == "extraction" and origin.get("attachmentId") not in ids:
            raise ValueError("Field evidence belongs to another source.")
        if origin["source"] == "extraction" and origin.get("jobId") != f'{draft_id}/{origin["attachmentId"]}':
            raise ValueError("Processing job belongs to another visitor.")
    readiness = envelope["readiness"]
    pending, changes = readiness.get("pendingSources"), readiness.get("changesToReview")
    if not isinstance(pending, list) or any(not isinstance(key, str) or key not in ids for key in pending):
        raise ValueError("Pending source does not belong to this visitor.")
    if (not isinstance(changes, list)
            or any(not isinstance(change, dict) or change.get("attachmentId") not in ids for change in changes)):
        raise ValueError("Review source does not belong to this visitor.")
    # Canonicalize the outer object only for local replay comparison. The source
    # string itself is never reserialized before its digest is checked.
    body_hash = sha(json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    return body, envelope, body_hash
