# Pete CRM intake adapter

This is an **isolated, non-sending integration package**, not a deployed CRM
endpoint. The Pete API does not import or run the sender. Production still reports
`crmDelivery: false` and the app says CRM transfer is not connected.

The receiver targets the inspected Django 5.1.3 / Python 3.11 CRM runtime. Its
compatibility environment pins those versions; it is not an upgrade proposal or
a claim that these are the latest versions. No CRM checkout, database, service
configuration, identity or customer record is changed by these tests.

## Responsibility

`pete_intake` stores a dedicated inbox record and an immutable operation receipt.
It never subclasses or imports the legacy CRM Lead, newsletter serializers,
Zendesk tasks or mail signals. Capturing a lead is not an inquiry submission or
follow-up authorization. Incomplete buyers and sellers are accepted. Different
visitors with similar names or email addresses are not automatically merged.

The Bun sender is [server/crm-delivery.ts](../../server/crm-delivery.ts). It
requires an explicit endpoint, token supplier and audience, blocks redirects,
distinguishes retryable failures from rejections, and verifies that a response
acknowledges the exact operation. A generic HTTP 202 is not an acknowledgment.

## Contract

Proposed mount: `POST /api/v1/pete-intake/` and
`GET /api/v1/pete-intake/operations/{operationId}`. These URLs exist only in the
isolated test server until integration and deployment are completed.

`pete-crm-delivery/v1` carries:

- `leadId`: the existing canonical Pete team/visitor identity.
- `sequence`: a positive, monotonically allocated safe integer per lead.
- `operationId`: SHA-256 of `pete-crm/v1/{leadId}/{sequence}`.
- `sourceReceiptId`: the existing Pete source-snapshot receipt.
- `owner`: verified server-side email and independent assignment version.
- `envelopeJson` and `envelopeSha256`: exact immutable `pete-lead/v1` source
  bytes as a UTF-8 string plus their SHA-256. Preserve the string; do not
  reserialize it across languages before checking its hash.

The receiver binds workspace, visitor, source receipt, source hashes and
field-level provenance; retains throughput **with its original unit**, source
text, manual corrections, gaps and conflicts; and distinguishes a memo from a
consented conversation. Inquiry, follow-up and newsletter permission must remain
`not_collected`. It relies on Pete's upstream original-media verification; it
does **not** download or independently verify GCS media. No public media URLs or
credentials enter this envelope. Authorized source retrieval is still to build.

The wire body limit is 10 MiB, including escaping of the upstream manifest
(limited to 4 MiB) inside the outer delivery. Unsupported/malformed content is
rejected explicitly. Oversize or rejected deliveries must remain in the future
outbox for inspection; they must not be reported as delivered.

The inbox row and receipt commit in one database transaction. PostgreSQL locks
serialize concurrent first deliveries and updates. Identical replays return the
same receipt; altered reuse returns 409. Older sequences receive a
`superseded` receipt and cannot roll the lead back. Newer owner versions can
arrive without a changed source receipt. The returned `pete-crm-receipt/v1`
contains operation/source identities, sequence, digest, record ID, received time,
`received` or `superseded` status, and `messagesSent: false`. The record ID is the
**intake inbox** ID, not a claim that a legacy CRM sales lead has been created.

## Repeatable isolated verification

Use Bun for the runner and JavaScript; `uv` manages only the Python compatibility
environment. Docker is required for the PostgreSQL/concurrency proof:

```sh
bun run test:crm
```

The runner builds synthetic card-first, speech-first and seller envelopes using
Pete's actual intake serializer, creates an ephemeral PostgreSQL container on a
random loopback-only port, applies the migration, runs Django tests and a real
Bun-to-Django HTTP probe, then removes the container. It never reads a company DB
URL. Fixture output is Git-excluded under `.cache/`.

```sh
bun scripts/test-crm-receiver.ts  # SQLite fallback; concurrency proof is skipped
bun test tests/crm-delivery.test.ts
```

The tests cover preserved source evidence/units, incomplete leads, same-operation
replays, acceptance followed by response loss, receipt lookup, owner-only updates,
reordering, concurrent duplicate delivery, rollback on receipt-write failure,
wrong identities, digest/source/permission/consent rejection and invalid receipts.
Authentication tests mock Google's signature verifier locally; no real service
token is minted. Actual IAM, proxy and deployed CRM integration remain untested.

## Remaining activation work

1. Build the durable Pete producer/worker. Allocate the delivery sequence in the
   same transaction as accepting a source or owner change. Persist the exact
   payload before sending; retry that operation after timeouts. A draft revision
   alone is insufficient: source processing and owner changes can advance
   independently. Leases, backoff, failure visibility and durable destination
   receipts still need implementation. This module does not claim that worker
   already exists.
2. Integrate `pete_intake.apps.PeteIntakeConfig` and its migration in a dedicated
   CRM change. Mount its URLs separately from existing form endpoints. Add an
   inbox view or explicitly reviewed promotion into existing sales records;
   preserve this endpoint's no-message boundary.
3. Configure `PETE_INTAKE_AUDIENCE` and
   `PETE_INTAKE_ALLOWED_SERVICE_ACCOUNTS` (a list of exact service-account emails).
   Missing/malformed configuration rejects all requests. The audience is the
   intended Google ID-token audience, not necessarily the custom URL hostname.
   Set Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` to 10 MiB and align proxy limits.
   Check both Cloud Run invoker authorization and receiver token verification
   using the chosen sender identity.
4. Verify the integrated CRM's real signal registration, database routing,
   migration and side-effect behavior in an environment proven isolated from
   customers. Existing staging names alone do not establish isolation. Only then
   enable controlled live delivery and expose confirmed CRM status in Pete.

No worker configuration, migration or rollout step above has been applied to
the production CRM. Ray advice, catalog synchronization and customer messaging
are separate future integrations.
