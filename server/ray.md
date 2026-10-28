# Pete → Ray consultation

Pete 0.8.2 restores the 0.7.1 equipment-advice policy while keeping assisted
continuation, richer request fields and team recovery. The authenticated Pete
API uses Ray's existing public consultation interface. Capture, transcription,
cloud saving and lead intake remain independent. No inquiry endpoint or messaging
action is called. CRM delivery remains disabled.

Ask Ray qualifies unclear technical fit with up to three essential questions or
suggests up to three evidenced candidates. Automatic scheduling does not force a
question or a machine search on every turn. Known and deferred questions are skipped.
Previously discussed SKUs are rechecked for availability and supplied as visible
references, never as selected machines. Evidence may include rejected alternatives;
Pete shows the complete assessment before “Listings referenced in this advice.”
Earlier listings stay with their original assessment in expandable history. Saved
choices remain accessible with an earlier-advice label. New requests omit the old
machine-search goal; legacy requests remain valid. No archive migration is needed.

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
the sent brief in saved advice; originating questions and answers remain attached to their recordings. Sources remain intact in Pete. Excerpts that do
not fit are counted and disclosed; pending recordings are disclosed too. A short
voice summary can add omitted context. This first slice does not summarize arbitrarily
long conversations through another model. Seller matching is intentionally unavailable.

The full local need source is fingerprinted, but only the fingerprint and bounded
brief and bounded question/answer history leave the browser. Throughput and its unit travel together as text; Ray's
unitless capacity filter is always null. Fields marked confirmed take precedence
over older source statements. Responses remain advice, not edits to customer facts.
Version 2 requests carry up to three source-bound question/answer pairs and a bounded deferred-question reminder. They do not share a global Ray browser session. Established requirements retain separate attributes for process, particles, closure, scope, brand and timing. The bounded history is context, not a substitute for current source-backed facts. Version 1 calls remain accepted. The existing service determines its own model processing policy;
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

`Ask Ray` activates assistance for the selected visitor in this open app session.
`Answer by voice` opens the memo recorder, retaining the current request and only
the selected, displayed Ray question at capture start. General voice notes and
consented conversation recordings retain known requirements without being assigned
an implicit Ray question. Existing captures retain their original context. Once new voice jobs finish and genuine conflicts have
been resolved, Pete requests updated advice automatically. The current visitor
must still be selected, the app visible/online, and capture/edit panels closed.
Metadata changes and saved advice do not trigger another call. Calls are spaced
at least three seconds apart, grouped while captures are pending, and stop after
12 automatic updates per activation. Errors pause automatic updates; retry with Ask Ray is explicit.
Pause automatic updates leaves an in-flight reply to finish and save. Cancel request
appears only while busy, disables continuation and aborts the browser request; a
late reply cannot be saved by that canceled request. The server may finish and cache
work already started. Hide Ray collapses the panel without changing continuation
or deleting advice. Show Ray does not initiate a request or start the microphone.
A reload starts paused; offline capture continues normally. No audio is streamed
while recording for live coaching.

The screen shows the full assessment and a follow-up question before referenced
listings. Other questions can be selected explicitly for a contextual voice answer.
Not known yet records a visitor-bound decision; Revisit question reopens it.
Question decisions are append-only and merge by ID. They travel in backups and
team/cloud manifests. A `conversationVersion` cloud pointer rejects older clients
that would strip the additive conversation attributes. Use Pete 0.8.0+ to edit
these records. Clear facts fill empty fields; reviewed/manual values remain
protected. Narrow translation equivalences avoid false conflicts. Contextual
extraction includes the source's request/question snapshot in its cache identity.
Legacy context-free extraction remains compatible with older clients.
Previously saved advice remains readable offline; new consultations need a
connection. Status distinguishes asking (with elapsed time), processing a saved
recording, a completed reply and a canceled request. Automatic updates are shown
separately. A completed consultation needs no Stop action. The microphone remains
off until a recording control is used; the recording dock names the visitor, mode
and selected question when answering. Native hosted auth/processing is not introduced by this PWA release.

## Verification

`bun test tests/ray.test.ts` covers association, redaction/excerpt limits, exact
units, source staleness, backup/restore/team merging, URL validation, cached replay,
concurrency/lease fencing, cooldown, origin/auth enforcement, non-sending transport
and old-client cloud protection. `e2e/ray.spec.ts` exercises mobile saving, reload,
offline refusal, later corrections, navigation during a request and voice answers.
Live verification uses synthetic needs only; private logs record the deployed Ray
contract and actual response times. Chromium checks do not prove physical iPhone
behavior. A separate full-project “Continue in Ray” handoff remains future work.

`tests/conversation.test.ts` covers additive enrichment, contextual cache identity,
unknown answers, deferred decisions, source binding, continuation gates, and
portable/team state. `e2e-hosted/ray-conversation.spec.ts` runs the complete saved
answer → automatic advice loop, Pause/reload/defer, cancellation and correction confirmation.
`bun scripts/evaluate-conversation.ts` is an explicit live model evaluation using
synthetic examples and company credentials. Source-span wording can vary; the
acceptance criteria are correct attributes, preserved facts, and no unnecessary
review. Google schema array bounds are validated in Pete to avoid a constrained
decoding complexity error; field enums and typed structured output remain enabled.
See [Google structured-output guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output).

0.8.1 also detects a team copy missing cloud-retained advice even when an older client
already acknowledged that cloud fingerprint. It pulls and merges the missing
history instead of repeatedly attempting a destructive overwrite. The server
continues to reject missing advice; the protection was not weakened.

Regression evidence includes cancellation/late responses, hide/show without changing
continuation, consented conversations and general memos continuing advice, selected
question context, retained earlier-listing actions and recovery from an
acknowledged-but-stripped team baseline. Synthetic fixtures only; no automatic
repair of old reviewed facts.

`bun scripts/evaluate-ray-advice.ts` explicitly calls live Ray with synthetic
requirements, comparing the 0.7.1 policy/interface behavior with the restored
integration. It includes a four-turn qualification conversation and a qualified
candidate scenario. Inspect the complete replies for preserved facts, useful
questions, handling of unknowns and grounded candidates; listing counts alone do
not establish quality. It is intentionally separate from the mocked browser tests
and does not promise identical wording or exhaustive engineering matching.
