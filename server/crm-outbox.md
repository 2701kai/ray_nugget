# Durable CRM outbox

This implements the producer and worker for the [isolated CRM receiver](../integrations/crm-intake/README.md).
It is **disabled in production**. The hosted API constructs `cloudBackups` without
an outbox, and no CRM worker job or schedule has been deployed. There is no live
customer backlog, new browser action or claim of CRM delivery.

## Saving and ordering

An explicitly supplied `crmOutbox(transport.destinationId)` adds the queue head
to the same transaction reads as the cloud pointer and Pete intake receipt.
Accepting a source or changing its owner atomically appends one operation and
advances a per-lead sequence. If that write fails, the source/owner acceptance also
rolls back. No task dispatch occurs inside a Firestore transaction, which can be
retried by the database.

Identity is scoped by destination (SHA-256 of normalized endpoint and exact token
audience), then by canonical team/visitor lead. Queue paths:

```text
crmOutboxes/{destinationId}/leads/{leadId}
crmOutboxes/{destinationId}/leads/{leadId}/operations/{sequence}
```

The head carries the latest queued sequence, last settled sequence, latest source
and owner fingerprint, lease, wake time, last receipt and safe failure code.
An operation freezes its source receipt, envelope path/hash, owner/version,
sequence and operation identity. Mutable attempt/lease/receipt metadata is stored
separately from those fields within that operation record.

The source JSON stays in its existing content-addressed GCS object. The worker
checks its hash and identity before building the exact wire delivery. Owner-only
changes keep the same source envelope and get a new delivery sequence. This also
handles processing changes that do not increment the editable draft revision.
Queue records stay small even when source text exceeds a Firestore document's
size limit. See [Firestore transaction behavior](https://firebase.google.com/docs/firestore/manage-data/transactions)
and [document limits](https://firebase.google.com/docs/firestore/quotas).

Identical save/assignment retries add nothing. If explicitly enabled after an
earlier Pete intake, the next save or owner action can queue the latest accepted
snapshot once. This is **not** a scan or automatic delivery of all historical
visitors. Personal backups and empty visitor placeholders do not queue.

Changing endpoint or audience selects another namespace and never drains the old
one accidentally. Do not casually change either for an existing CRM destination:
the receiver retains per-lead sequences and immutable receipts. A destination
migration needs an explicit sequence/history reconciliation plan; resetting a
queue namespace is not that plan.

## Worker and recovery

`crmWorker.run(leadId)` leases the next unsettled operation for up to two minutes.
Competing workers skip an active lease. Expired leases are reclaimable; the lease
ID and cursor fence every outcome write, including late success and late failure.

The worker queries the destination receipt before a submission. A receipt lost
after remote acceptance, a process exit or failure of local receipt persistence
can therefore recover without a second POST. The destination still must enforce
idempotency: a lease can expire during an already-running network call, so this
is at-least-once delivery with duplicate-safe receiver effects, not exactly-once
network transmission.

Successful or superseded receipts settle that operation; newer queued work stays
intact. A bounded `drain` discovers due heads and processes them round-robin,
returning to ready leads while capacity remains. The default batch is 20 operations,
maximum 100. Firestore discovery uses a single ordered `wakeAt` field.

Temporary transport/identity/storage failures retry with exponential backoff and
jitter. Eight submission attempts are allowed by default, followed by a final
receipt-only recovery attempt. Explicit rejections, corrupted source evidence or
exhausted recovery become `blocked`; later operations for that lead wait. A blocked
state means operator attention, not proof that an uncertain request never reached
the receiver. The original operation remains available.

`status` exposes the internal head for diagnostics. Failure metadata is restricted
to a code, time and optional HTTP status; no response bodies, tokens or customer
text are logged. Trusted operators can call `retryBlocked` with the current
operation ID and total attempt count after resolving the cause. This resets its
retry budget, preserves total attempts and records the manual retry time. Stale
retry requests do nothing. No public/browser endpoint exposes that action.

## Explicit runner, not a deployed scheduler

`bun run worker:crm` is a bounded service job entry point. It fails before touching
GCP unless `PETE_CRM_DELIVERY_ENABLED=true` and all of these are explicitly set:

- `PETE_GCP_PROJECT`
- `PETE_FIRESTORE_DATABASE`
- `PETE_BACKUP_BUCKET`
- `PETE_CRM_ENDPOINT` (dedicated intake URL ending in `/`)
- `PETE_CRM_AUDIENCE` (intended Google ID-token audience)

Optional `PETE_CRM_BATCH_SIZE` defaults to 20. The runner uses ADC/service identity,
existing Firestore/GCS adapters and a Google ID token; it prints only outcome
counts. Tokens and sources stay server-side. The UI remains on the existing
“CRM transfer is not connected yet” wording.

Before activation: integrate the receiver in the actual CRM, verify its signal/
database/proxy/IAM boundaries in isolation, wire the producer to the chosen target,
and deploy an authenticated job/schedule with monitoring. An environment variable
on the runner alone does not enable the hosted producer. No service account,
schedule, API environment or CRM migration was changed by this implementation.

## Verification

- `bun test tests/crm-outbox.test.ts tests/crm-delivery.test.ts`: source/owner
  atomicity, replay/backfill, disabled/personal/empty paths, concurrent workers,
  lease expiry, late success, local receipt-write failure, unavailable/corrupted
  sources, rejection and guarded retry, retry budget, destination isolation,
  compact records for large sources, and fail-closed runner configuration.
- `bun run test:crm`: actual Bun HTTP to the Django receiver on isolated PostgreSQL.
  Three separate Bun worker processes exercise acceptance with a lost response,
  durable receipt recovery, then owner-only delivery. All inputs are synthetic;
  Google token verification is mocked only in the local receiver tests.
- The production Firestore/GCS adapters were separately checked against isolated
  synthetic records: concurrent saves/workers, source over 1 MiB, receipt recovery,
  due query and bounded batch. Records/objects were cleaned afterward. That check
  used a mocked destination, not live CRM, and changed no production configuration.

Real service-to-service IAM, a deployed job's lifecycle, monitoring/alerts, a CRM
inbox view and promotion into existing CRM sales records remain rollout work.
