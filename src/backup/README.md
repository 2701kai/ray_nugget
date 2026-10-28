# Pete backup format v1

A `.pete` file is an uncompressed binary archive for one visitor. It is not a ZIP,
an encrypted container, a signed document, or a cloud processing request.

In order, the file contains:

1. The 15 UTF-8 bytes `PETE_BACKUP_V1\n` (a literal newline after `V1`).
2. A four-byte, big-endian unsigned length of the JSON manifest.
3. The manifest's SHA-256 as 64 lowercase ASCII hex characters.
4. The UTF-8 JSON manifest.
5. Original media bytes in the manifest draft's attachment order, with no padding.

The manifest has `format: "pete-backup/v1"`, `draft` (domain Draft schema v1),
and `jobs`. Each job carries attachmentId, createdAt, updatedAt, plus result and
reviewedAt only when complete. Results may additionally carry a request (intent,
product, packaging, capacity pair), source-quote evidence and clarification questions.
These optional fields are additive; older backups without them remain valid.
Automatic draft values carry source provenance without a reviewedAt/appliedJobs
entry until explicitly reviewed. Attachment bytes and sha256 define the bounds and
integrity of each original. Missing data, extra trailing bytes, invalid source
references, duplicates, unsupported media types or versions are rejected. Only
known metadata fields are reconstructed. Hashes detect corruption, not authorship.

Limits: 128 MiB total, 4 MiB manifest, 250 attachments/jobs, normal per-capture media
limits. Export reserves manifest space before loading originals. Snapshot reads
are transactional; hashing happens outside storage transactions. Import validates
everything before its atomic insert. IndexedDB writes copy each media slice to
avoid storing the complete archive backing buffer per attachment.

The manifest hash gives the restored draft ID `restored-<hash>`. Job IDs and all
provenance/review references are remapped to that draft. A repeated restore opens
the existing copy without replacing edits. Restoring a different snapshot creates
a separate draft; no conflict merge is attempted. Source IDs remain unchanged.
Complete jobs retain their result/review state. Other jobs become failed/paused
with no lease and no automatic retry. Account settings and credentials are never
restored. Follow-up previews become outdated because the salesperson may differ.

Do not change this contract in place. An incompatible format requires a new magic
and schema version plus an explicit migration strategy for existing backup files.

Pete 0.8.0 keeps the v1 archive envelope and adds optional request qualifications,
source-bound capture context, question decisions, and conversationVersion=1. Old
archives remain readable. Restore preserves these facts and rebinds visitor IDs;
it never activates Ray assistance or starts a new consultation. Pete 0.8.0+ is
required to edit the enriched records. Hosted pointers reject updates from older
clients that strip the conversation marker. No originals or decisions are dropped
to make an older client accept a newer record.

The workflow preview reads v1 and v2. Visitors with corrected transcripts export
`PETE_BACKUP_V2\n` / `pete-backup/v2`, so older apps reject the archive instead of
silently using the misheard original. Existing v1 files need no migration; they
open normally and become v2 only when a transcript is corrected. The envelope,
hashing and media layout stay the same. `result.text` remains the original;
`sourceEdits` retains corrections and `activeEditId` selects the current wording.
`sourceEngine` identifies transcription separately from detail extraction.
V2 also carries unfinished correction results with `processingComplete: false`;
these restore paused and never trigger processing by import alone.

Hosted rollout requires the new reader and server protection first: pointers
retain every correction ID and reject clients that drop one. The workflow
preview is local-only and has not been published to the hosted pilot.
