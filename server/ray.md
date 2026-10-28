# Pete → Ray consultation

Pete 0.7.0 adds optional equipment advice inside a visitor. The authenticated Pete
API uses Ray's existing public consultation interface. Capture, transcription,
cloud saving and lead intake remain independent. No inquiry endpoint or messaging
action is called. CRM delivery remains disabled.

## Contract and configuration

`PETE_RAY_ENABLED=true` enables `POST /api/ray/{id}`. The endpoint requires a
verified BEVMAQ Firebase identity and an allowed app origin. Results are cached
under that identity, never returned across users. Team sharing happens only through
the visitor's existing authorized cloud workflow. No additional Ray credential is
required by the currently deployed public interface. Only the reviewed HTTPS Ray
origin is accepted; redirects are rejected.

`src/ray/brief.ts` builds a bounded need brief from request fields and whole excerpts
of this visitor's notes/voice transcripts. Card text, media, contact fields and
event attribution are excluded. Known contact values, email addresses and
international phone numbers are redacted from excerpts; this is not a guarantee
of detecting every incidental personal reference in free speech. A user can inspect
the exact request in saved advice. Sources remain intact in Pete. Excerpts that do
not fit are counted and disclosed; pending recordings are disclosed too. A short
voice summary can add omitted context. This first slice does not summarize arbitrarily
long conversations through another model. Seller matching is intentionally unavailable.

The full local need source is fingerprinted, but only the fingerprint and bounded
brief leave the browser. Throughput and its unit travel together as text; Ray's
unitless capacity filter is always null. Fields marked confirmed take precedence
over older source statements. Responses remain advice, not edits to customer facts.
Every consultation starts with fresh, visitor-specific context, not a global Ray
browser session. The existing service determines its own model processing policy;
Pete's EU transcription configuration is not a model-residency claim about Ray.

The request ID hashes the validated body, including visitor, source fingerprint and
a 15-minute time window. Identical taps in that window reuse the result; a later
window allows an availability refresh. New requirements create a different request.
Firestore transactions deduplicate concurrent requests across instances, with a
100-second lease, fenced commits, 60-second failure cooldown and three attempts per
request. Caps: 60 attempts/user/UTC day and 150 globally. Ray has its own limits;
429s remain visible and never stop capture. The upstream deadline is 75 seconds,
client deadline 110 seconds. A lost reply can recover from the saved result. Advice
requests may be repeated after a failed/expired attempt; this is not exactly-once
model execution. Interrupted requests are retried by tapping, not silently queued.

Only Ray's catalogue evidence IDs can produce machine cards. Each is checked via
the live product endpoint, and only available records with approved HTTPS BEVMAQ
links are retained. Up to three cards are shown. Technical compatibility and future
availability are not guaranteed. Ray's `action`, `review`, generated URLs and markup
are not executed; no `/api/enquiries`, shortlist publishing, email or CRM write occurs.

## Persistence and mobile behavior

`Draft.ray` is optional, append-only consultation history with separate selected
SKUs. `rayAdvice` validates visitor binding; `raySelect` only accepts a machine in
that consultation. Up to 100 consultations are retained; the limit refuses a new
save rather than evicting history. Old advice stays visible after a source edit,
marked for refresh. Adding advice or selecting a machine does not stale the need.
Results return to the original visitor even after navigation; account changes abort
the client request. Active requests and machine-choice writes guard PWA updates.

Advice/selections travel with IndexedDB/SQLite drafts, `.pete` backups and company
cloud manifests. Restoring a copy rebinds the advice to the new visitor identity.
Team merging unions consultations; concurrent edits to the same selection are
explicit conflicts. Cloud pointer `rayIds` prevents older clients from silently
dropping already-saved consultations. Use Pete 0.7.0+ for backups containing advice.

`Answer by voice` opens the existing recorder for the same visitor. After text
arrives, `Ask Ray again` includes the new evidence. No extra form is required.
Previously saved advice remains readable offline; new consultations need a
connection. Native hosted auth/processing is not introduced by this PWA release.

## Verification

`bun test tests/ray.test.ts` covers association, redaction/excerpt limits, exact
units, source staleness, backup/restore/team merging, URL validation, cached replay,
concurrency/lease fencing, cooldown, origin/auth enforcement, non-sending transport
and old-client cloud protection. `e2e/ray.spec.ts` exercises mobile saving, reload,
offline refusal, later corrections, navigation during a request and voice answers.
Live verification uses synthetic needs only; private logs record the deployed Ray
contract and actual response times. Chromium checks do not prove physical iPhone
behavior. A separate full-project “Continue in Ray” handoff remains future work.
