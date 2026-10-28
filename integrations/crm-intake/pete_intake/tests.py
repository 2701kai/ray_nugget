import copy
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch

from django.core import mail
from django.db import close_old_connections, connection
from django.test import Client, LiveServerTestCase, TestCase, TransactionTestCase, override_settings

from .contract import MAX_BODY_BYTES, sha
from .models import IntakeLead, IntakeOperation

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / ".cache/crm-delivery-fixtures.json"
URL = "/api/v1/pete-intake/"
CLAIMS = {"aud": "https://crm.example.test", "email": "pete@synthetic.iam.gserviceaccount.com", "email_verified": True}


def fixture(index=0, sequence=1):
    body = json.loads(FIXTURES.read_text())[index]
    body["sequence"] = sequence
    body["operationId"] = sha(f'pete-crm/v1/{body["leadId"]}/{sequence}')
    return body


def alter_source(body, edit):
    envelope = json.loads(body["envelopeJson"])
    edit(envelope)
    body["envelopeJson"] = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    body["envelopeSha256"] = sha(body["envelopeJson"])


def post(client, body):
    return client.post(URL, data=json.dumps(body), content_type="application/json", HTTP_AUTHORIZATION="Bearer synthetic-test-token")


class ReceiverTests(TestCase):
    def setUp(self):
        self.verifier = patch("pete_intake.auth.verify_oauth2_token", return_value=CLAIMS).start()
        self.addCleanup(patch.stopall)
        # These guards make an accidental Django mail side effect fail the test.
        patch("django.core.mail.send_mail", side_effect=AssertionError("No mail allowed")).start()
        patch("django.core.mail.EmailMessage.send", side_effect=AssertionError("No mail allowed")).start()

    def test_actual_intake_card_speech_and_seller_envelopes_preserve_evidence(self):
        for index in range(3):
            with self.subTest(index=index):
                body = fixture(index)
                answer = post(self.client, body)
                self.assertEqual(answer.status_code, 201, answer.content)
                row = IntakeLead.objects.get(pk=body["leadId"])
                self.assertEqual(row.envelope, json.loads(body["envelopeJson"]))
                self.assertEqual(row.envelope["request"]["unit"], "L/h")
                self.assertEqual(row.envelope["contact"]["email"], "")  # Incomplete is valid.
                self.assertEqual(answer.json()["messagesSent"], False)
                self.assertEqual(row.envelope["permissions"]["inquiry"], "not_collected")
                if index == 2:
                    self.assertIsNone(row.envelope["readiness"]["fillingRequirementsMissing"])
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(IntakeLead.objects.count(), 3)  # Similar names never auto-merge.

    def test_replay_and_receipt_lookup_after_lost_acknowledgment(self):
        body = fixture()
        first = post(self.client, body)
        again = post(self.client, body)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.json(), again.json())
        lookup = self.client.get(f'{URL}operations/{body["operationId"]}', HTTP_AUTHORIZATION="Bearer synthetic-test-token")
        self.assertEqual(lookup.json(), first.json())
        self.assertEqual(lookup.headers["Cache-Control"], "no-store")
        self.assertEqual(IntakeOperation.objects.count(), 1)
        body["owner"]["email"] = "changed@example.test"
        self.assertEqual(post(self.client, body).status_code, 409)
        self.assertEqual(IntakeOperation.objects.count(), 1)

    def test_reordered_source_and_owner_changes_cannot_roll_back_latest_lead(self):
        latest = fixture(sequence=3)
        latest["owner"] = {"email": "new-owner@example.test", "version": 2}
        alter_source(latest, lambda e: e["contact"].update(name="Manually corrected name"))
        self.assertEqual(post(self.client, latest).status_code, 201)
        older = fixture(sequence=1)
        self.assertEqual(post(self.client, older).json()["status"], "superseded")
        row = IntakeLead.objects.get(pk=latest["leadId"])
        self.assertEqual(row.sequence, 3)
        self.assertEqual(row.owner_email, "new-owner@example.test")
        self.assertEqual(row.envelope["contact"]["name"], "Manually corrected name")
        backward = fixture(sequence=4)
        self.assertEqual(post(self.client, backward).status_code, 409)
        backward["owner"]["version"] = 2  # Same owner version with another owner is also invalid.
        self.assertEqual(post(self.client, backward).status_code, 409)
        backward["owner"]["version"] = 3
        self.assertEqual(post(self.client, backward).status_code, 201)
        self.assertEqual(IntakeLead.objects.count(), 1)

    def test_invalid_binding_permission_consent_and_unit_never_persist(self):
        edits = [
            lambda e: e.update(leadId="0" * 64),
            lambda e: e["workspace"].update(id="another-team"),
            lambda e: e["source"].update(draftId="another-visitor"),
            lambda e: e["source"].update(fingerprint="0" * 64),
            lambda e: e["permissions"].update(inquiry=True),
            lambda e: e["permissions"].update(newsletter="granted"),
            lambda e: e["request"].update(unit="m3/h"),
            lambda e: e["sources"][0].update(consentConfirmed=False),
            lambda e: e["sources"].append(copy.deepcopy(e["sources"][0])),
            lambda e: e["provenance"]["contact.name"].update(attachmentId="another-card"),
            lambda e: e["provenance"]["contact.name"].update(jobId="another-visitor/job"),
            lambda e: e["readiness"].update(pendingSources=["another-card"]),
            lambda e: e["readiness"].update(changesToReview=[{"attachmentId": "another-card"}]),
        ]
        for edit in edits:
            with self.subTest(edit=edits.index(edit)):
                body = fixture(2)
                alter_source(body, edit)
                self.assertEqual(post(self.client, body).status_code, 400)
        for bad in [0, -1, True, 2 ** 53, "1"]:
            body = fixture()
            body["sequence"] = bad
            self.assertEqual(post(self.client, body).status_code, 400)
        body = fixture()
        body["envelopeJson"] += " "
        self.assertEqual(post(self.client, body).status_code, 400)
        self.assertEqual(IntakeLead.objects.count(), 0)
        self.assertEqual(IntakeOperation.objects.count(), 0)

    def test_malformed_json_and_size_limits(self):
        for raw in ['{"format":1,"format":2}', '{"value":NaN}', '{"value":1e9999}', '{"value":"\\u0000"}', '{"value":"\\ud800"}', '[1]', '{', '\ud800']:
            data = raw.encode("utf-8", errors="surrogatepass")
            self.assertEqual(self.client.post(URL, data=data, content_type="application/json", HTTP_AUTHORIZATION="Bearer synthetic").status_code, 400)
        self.assertEqual(self.client.post(URL, data="x", content_type="text/plain", HTTP_AUTHORIZATION="Bearer synthetic").status_code, 415)
        self.assertEqual(self.client.post(URL, data=b"x" * (MAX_BODY_BYTES + 1), content_type="application/json", HTTP_AUTHORIZATION="Bearer synthetic").status_code, 413)
        with override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=10):
            self.assertEqual(post(self.client, fixture()).status_code, 413)

    def test_authentication_fails_closed_and_receipt_requires_same_service_identity(self):
        self.assertEqual(self.client.post(URL, data="{}", content_type="application/json").status_code, 403)
        for claims in [{**CLAIMS, "aud": "wrong"}, {**CLAIMS, "email": "outsider@example.test"}, {**CLAIMS, "email_verified": "true"}, {}]:
            self.verifier.return_value = claims
            self.assertEqual(post(self.client, fixture()).status_code, 403)
        self.verifier.side_effect = ValueError("Synthetic invalid token")
        self.assertEqual(post(self.client, fixture()).status_code, 403)
        self.verifier.side_effect = None
        self.verifier.return_value = CLAIMS
        for settings in [{"PETE_INTAKE_AUDIENCE": ""}, {"PETE_INTAKE_ALLOWED_SERVICE_ACCOUNTS": []}, {"PETE_INTAKE_ALLOWED_SERVICE_ACCOUNTS": CLAIMS["email"]}]:
            with override_settings(**settings):
                self.assertEqual(post(self.client, fixture()).status_code, 403)
        self.assertEqual(self.client.get(f'{URL}operations/{"0" * 64}').status_code, 403)
        self.assertEqual(IntakeLead.objects.count(), 0)

    def test_receipt_failure_rolls_back_lead_update(self):
        with patch.object(IntakeOperation.objects, "create", side_effect=RuntimeError("Synthetic database failure")):
            with self.assertRaises(RuntimeError):
                post(self.client, fixture())
        self.assertEqual(IntakeLead.objects.count(), 0)
        self.assertEqual(IntakeOperation.objects.count(), 0)


@skipUnless(connection.vendor == "postgresql", "PostgreSQL is required to prove row-lock concurrency.")
class ConcurrencyTests(TransactionTestCase):
    def test_simultaneous_first_delivery_and_reordered_updates(self):
        def deliver(body):
            close_old_connections()
            try:
                result = post(Client(), body)
                return result.status_code, result.json()
            finally:
                close_old_connections()
        with patch("pete_intake.auth.verify_oauth2_token", return_value=CLAIMS):
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(deliver, [fixture()] * 4))
            self.assertEqual(sorted(code for code, _ in responses), [200, 200, 200, 201])
            self.assertTrue(all(body == responses[0][1] for _, body in responses))
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(deliver, [fixture(sequence=n) for n in [3, 2, 5, 4]]))
            self.assertTrue(all(code == 201 for code, _ in responses), responses)
        self.assertEqual(IntakeLead.objects.get().sequence, 5)
        self.assertEqual(IntakeOperation.objects.count(), 5)


class HttpInteropTests(LiveServerTestCase):
    def test_bun_sender_against_real_django_http_receiver(self):
        with patch("pete_intake.auth.verify_oauth2_token", return_value=CLAIMS):
            result = subprocess.run(["bun", "scripts/crm-receiver-probe.ts", f"{self.live_server_url}{URL}"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(IntakeLead.objects.count(), 1)
        self.assertEqual(IntakeOperation.objects.count(), 2)
        self.assertEqual(IntakeLead.objects.get().owner_version, 2)
