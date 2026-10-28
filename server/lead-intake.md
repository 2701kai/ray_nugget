# Shared lead intake

This is Pete's non-sending intake, not a live CRM or Ray connector. It runs as part
of an authenticated shared-visitor cloud save. No additional save button or form
is required. Personal backup copies remain outside intake; sharing a visitor is
an explicit action unless it was created in the selected team workspace.

## Identity and atomic acceptance

The API derives the storage scope from the authorized team, verifies membership,
and requires the team event and SHA-256 of the draft ID to match the upload path.
This canonical shared identity is independent of device installation IDs. Matching
names, companies, emails or phone numbers do not merge separate visitors.

`leadId = SHA256("pete-lead/v1/" + scope + "/" + draftKey)`.
`receiptId = SHA256(leadId + "/" + sourceFingerprint)`.

The source fingerprint hashes the exact portable manifest. Each distinct accepted
snapshot gets one receipt, retaining its source revision and fingerprint. A retry
of an accepted snapshot returns its existing receipt; a stale update cannot
replace a newer snapshot. Empty new visitors have no lead until content exists.
Clearing details from an existing lead still produces an updated receipt.

The cloud service validates the manifest and verifies every original's stored
hash, byte count and media type. It writes the manifest and a content-addressed
`pete-lead/v1` JSON envelope into the existing private originals bucket, then
atomically commits the shared visitor pointer, latest intake record and immutable
receipt in Firestore. A failed object write or transaction cannot acknowledge a
receipt. An object written before a rejected transaction may remain unreferenced;
cleanup/retention of historical or unreferenced objects is not implemented here.

Envelope objects are under `owners/{scope}/leads/{draftKey}/{digest}.json`.
Firestore intake records are under `cloudOwners/{scope}/leads/{draftKey}` with
`receipts/{receiptId}` and `assignments/{version}` subcollections. Source bodies
stay in object storage rather than approaching Firestore's per-document limit.

The envelope retains original full name, company, contact fields, event, request,
throughput with its unit, notes, source hashes, completed source text/extractions,
field provenance and pending/review information. It does not guess name splits,
country, unit conversions or confirmed identity. A pending processing job is not
reported as completed. Seller intake does not assert filling qualification.
Recording consent stays with the source; inquiry, follow-up and newsletter
permission remain `not_collected`.

## Owner and receipt semantics

The first authenticated sharer is the default owner, including an existing
shared copy's server-recorded `createdBy` during migration. This is ownership,
not proof of who originally recorded imported material. Subsequent uploads retain
the owner. The latest editor and the owner are separate fields.

`POST /api/teams/{teamId}/drafts/{draftKey}/owner` accepts `ownerEmail` and
`expectedVersion`. Only current members may act or be newly assigned. The server
compares the owner version inside the same transaction as the shared copy update;
stale competing changes return409. Replaying a lost successful assignment response
is idempotent. Assignment audit records do not rewrite source receipt history or
customer fields. Local `.pete` backups do not carry team assignment authority.

The copy returned by save/get/list includes the latest public `lead` receipt
summary. The UI only says **Received by Pete** when that receipt matches the
current acknowledged shared source; otherwise it shows pending changes. Assignment
information is fetched from the team service; after an offline reload it becomes
available again on reconnect. Automatic capture itself stays available offline.

`state: received` means durable intake acceptance. `crmState: not_connected` is
explicit. There is no downstream submission, email, WhatsApp send, CRM write,
catalog import or closed-app delivery worker in this increment. A future adapter
must agree a destination contract, preserve this operation identity, distinguish
acceptance from applied delivery, and keep inquiry authorization separate.

## Migration and checks

`intakeVersion: 1` on team metadata marks a checked copy, including empty visitors.
Team sync resubmits an unchanged legacy snapshot once to create its receipt.
There is no bulk scan or personal-data sharing migration. Existing storage names,
draft IDs, media and portable backup format remain unchanged.

Tests cover incomplete intake, retry after acceptance, stable identity/ownership,
later edits and stale writes, personal/empty exclusion, legacy migration, cleared
details, storage failure, missing originals, foreign source references, manual
corrections, card/voice evidence, seller intent, permission separation, member and
origin checks, and versioned assignment. The hosted browser scenario exercises
two members, offline merge/conflicts, owner changes, receipts and reloads using
synthetic data and intercepted services.
