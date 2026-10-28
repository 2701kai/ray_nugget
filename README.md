# Pete by BEVMAQ

A capture workspace for trade fairs and customer visits. Start with a contact,
business-card photo, voice note, or buyer/seller request, then enrich the same
editable visitor draft in any order.

The Firebase pilot is at **https://bevmaq-platform.web.app**. The dedicated address
**https://pete.bevmaq.com** is configured; initial DNS and certificate propagation
may still be in progress. The repository remains `ray_nugget`; the app is named Pete.

## Hosted pilot

Pete uses US English, including sign-in, dates, and new clarification questions.
German and English source material remain supported; extracted names and source
quotes keep their original language. Existing saved content is not rewritten.

Use **Continue with Google** and select your `@bevmaq.com` work account.
Only verified company accounts can open the workspace or use transcription.
Open **Settings** and choose **Sign out** near the top,
under your email. Mobile body text is 18 pixels, with labels and helper text at
least 16 pixels and darker secondary text. Controls use compact 44px targets;
the capture dock uses 48px buttons. Padding and repeated help text are reduced.
Web inputs keep the browser's editing buffer and focus during dictation and
background updates. Manual forms save only edited fields, preserving details
filled in the background while the form was open.

Voice capture stays in a compact dock below the conversation. The visitor and
previous notes remain visible; navigation, editing, and playback controls are
locked until capture finishes or an idle recorder is closed. A running or unsaved
recording cannot be dismissed silently. The same recorder survives mobile/desktop
layout changes and remains bound to its source visitor. Conversation recordings
still require consent. Playback shows elapsed time, duration when available, and
10-second back/forward controls; starting a recording pauses existing playback.
A quiet version hint appears at the bottom of the workspace and sign-in screen;
Settings shows the same numeric version. It identifies the page actually open,
including a cached offline page, so an older tab cannot report a newer release.
The Google account picker hints at the company domain;
the application and API enforce it independently. Google sign-in with an existing
account's email keeps its Firebase UID and corresponding local drafts.
The Google screen currently uses this company's shared OAuth brand,
**CRM Email Processing**. Pete requests only basic sign-in scopes.
Each account has its own local browser database. Sign in online once and wait for
the offline shell to be ready before taking the app offline.

Firebase Hosting serves the installable PWA. A Bun service on Cloud Run in
`europe-west4` verifies Firebase ID tokens and saves processing state in the named
EU Firestore database `pete`. Audio uploads directly to a private bucket using
resumable sessions; the service checks its size and SHA-256 before submitting it
to EU Speech-to-Text V2. Reopening Pete resumes the existing operation. An uncertain
submission stops for administrator review rather than risking a duplicate.
Temporary audio is deleted on observed completion/failure, with a one-day bucket
lifecycle as fallback. Transcripts and job metadata remain in Firestore; automatic
retention of those records is not configured yet.

Drafts, notes, photos, and original recordings save **on this device first**.
In the signed-in hosted app, Pete automatically backs up existing and new visitors
to company GCP while open and online. A private EU bucket retains originals and
versioned JSON details; the named Firestore database stores upload state and the
latest confirmed copy. **Saved to company cloud** appears only after originals
pass size/hash checks and the details are committed. Pending/offline/error states
remain distinct. Reconnects resume saving; unchanged originals upload once.

**Personal cloud backups** in **Settings** opens a separate local
copy under the same Google account. It lists up to 1,000 recent copies. Existing
local drafts remain intact, and restored unfinished processing stays paused until
explicitly retried. A `.pete` file is an optional portable snapshot through the
phone's file picker, independent of automatic GCP saving. It includes original
media and versioned metadata; it is not a ZIP or an encrypted container. Existing
v1 files remain supported. Localhost stays local-only.

### Shared CIBUSTEC pilot

The hosted **CIBUSTEC** workspace shares visitor records and original media among
an explicit server-side list of verified company Google accounts. Configure the
comma-separated `PETE_TEAM_MEMBERS` at deployment; do not commit personal account
addresses or include them in the public web build. Without this setting the team
catalog is empty. Other company accounts do not inherit team access. Personal
cloud routes remain scoped to the signed-in UID.

New captures in the selected team workspace share automatically. Existing personal
visitors only join via **Details & request → Share with the CIBUSTEC team**.
The event picker also opens **My personal visits**. Team metadata is
listed while online (poll every 15 seconds); opening a visitor downloads originals
with integrity checks for offline use. It does not pre-download every team's
recording. The list currently returns at most 1,000 recent visitors.

Copies keep the same visitor/source IDs, with an atomic local baseline and a
server fingerprint precondition. Separate edits and append-only notes/sources
merge; conflicting fields require an explicit local/team choice. Throughput and
unit stay paired. Changes made during a download prevent that response from
replacing newer local edits. Portable pending jobs remain paused on another
device; a source device keeps its pending work. Concurrent media with the same
hash share cloud storage, while visitor identities are never guessed from names.

Keep Pete open and online until **Saved to team**. Team sharing is currently
web-only; native devices, real iPhone dictation, screen lock and long recordings
still need physical acceptance. Use `pete.bevmaq.com` consistently. This does not
connect CRM, Ray matching or automatic messaging.

Cloud originals use `bevmaq-platform-pete-originals`, separate from the temporary
speech bucket and its one-day deletion rule. No automatic expiry is configured
for cloud copies; bucket soft deletion retains deleted objects for seven days.
Uploads are capped at 1 GiB per storage scope (personal account or shared team) / 5 GiB total per UTC day, with existing
per-original limits and a 128 MiB portable visitor limit. Large originals restore
in authenticated 4 MiB parts with a final hash check. Company Google SSO and
owner isolation apply to personal routes; explicit membership applies to team routes. Runtime bucket access is limited to
the Pete service account; exact browser origins are in `deploy/storage-cors.json`.
Pilot transcription is capped at 40 new attempts per account and 200 total per UTC
day, with 60 MiB per recording. Processing needs Pete open and connected to submit
or collect results; Google's accepted operation can continue while Pete is closed.
Hosting, storage, compute, and speech use the existing company GCP billing account.

Release targets and non-secret runtime settings are in `deploy/`. Build/release
the frontend with Bun:

```sh
bun run build:hosted
bun run deploy:hosting
```

The hosted build uses `dist-hosted/`, leaving the localhost build and its data
alone. The build reads Firebase's public browser configuration and verifies its
project/app against the target. Publishing uses company Application Default
Credentials, falling back to an already authenticated gcloud session if ADC has
expired; tokens stay in memory. The release script checks the site's associated
app before publishing, and sends only static assets. Reserved Firebase `/__/`
handlers and `/api/` bypass the service worker.

Google sign-in configuration is in `deploy/firebase-auth.json`. Provision it with:

```sh
bunx firebase-tools@15.34.1 deploy --only auth --project bevmaq-platform \
  --config deploy/firebase-auth.json --non-interactive
```

Firebase may require the deploying account to accept its terms in the console
before provisioning Google OAuth. All three Hosting domains have explicit OAuth
redirect URIs. The browser uses its current Hosting domain as `authDomain` so
redirects work with third-party storage restrictions. The config enables Google;
it does not disable previously enabled providers. Email/password has been disabled
in Firebase Auth for this deployment. Existing users and UIDs are retained; do not
delete/recreate accounts to switch providers. App updates preserve the persistent
Google session; signing out is never part of an update.

To update the API, build and deploy its container with the dedicated service identity:

```sh
gcloud builds submit . --project=bevmaq-platform --region=europe-west4 \
  --tag=europe-west4-docker.pkg.dev/bevmaq-platform/pete/api:release
gcloud run deploy pete-api --project=bevmaq-platform --region=europe-west4 \
  --image=europe-west4-docker.pkg.dev/bevmaq-platform/pete/api:release \
  --service-account=pete-api@bevmaq-platform.iam.gserviceaccount.com \
  --env-vars-file=deploy/cloud-run.env.yaml --memory=512Mi --cpu=1 \
  --min-instances=0 --max-instances=3 --concurrency=40 --timeout=300 \
  --allow-unauthenticated
```

Cloud Run allows HTTP invocation so Hosting can proxy requests; the application
requires a verified company Firebase token for every processing route. No service
account key is deployed. Build-upload allowlists exclude local documents,
credentials, recordings, browser captures, and unrelated repository contents.

## Run locally

Use Bun for dependencies, scripts, tests, and the lockfile:

```sh
bun install --frozen-lockfile
bun run web
```

Open http://localhost:8081. Microphone capture requires localhost or HTTPS and
browser permission. Capture and card OCR need no account or seeded customer data.
The web command prepares the local OCR assets automatically from Bun dependencies.

For the installable PWA and offline reopening, use the production build:

```sh
bun run build:web
bun run preview
```

Stop the development server first; both commands use http://localhost:8081 so
existing drafts remain available. Chromium offers installation in its browser menu
and Pete's Settings when supported. On iPhone, use Safari's Share menu → Add to
Home Screen. A real phone needs a reachable HTTPS host; localhost on the phone
refers to the phone itself. Use the hosted HTTPS pilot for a real phone.

The first successful online load caches the application shell. Settings confirms
when it is ready to reopen offline. Captures remain local while offline, and queued
processing resumes after reconnecting. Large OCR resources load on demand. Only
public application resources enter the service-worker cache; customer media and
drafts stay in IndexedDB. From v0.4.2, Pete checks for updates on opening,
foreground return, reconnect and every minute while visible. A fully cached new
worker activates immediately, while each page waits for a five-second idle period
before refreshing. Open capture/edit/review sheets, focused inputs, playback,
team-conflict review and foreground saves block that refresh. Hidden tabs wait
until visible. IndexedDB drafts and the persistent Google session survive.
Older pages retain their public assets until they acknowledge a newer build;
unknown or suspended clients prevent cache deletion, not other tabs' updates.
A failed/inconsistent installation leaves the previous worker available. Existing
v0.4.1 or older pages need one ordinary refresh after this release installs; they
cannot acquire new page-side update logic without loading it. No logout or data
clearing is needed. `bun run test:updates` exercises real release transitions,
multiple tabs, unfinished forms/recordings, sign-in persistence and failed installs
with synthetic data and a locally served hosted build.

The lifecycle uses [skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)
and [controllerchange](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange_event);
page refresh safety is enforced separately by Pete. Development/HMR does not install a
worker; unregister a previous worker in browser DevTools before switching that
same origin back to development, without clearing IndexedDB/site data.

For a phone preview, run `bun run start` and open the project in a compatible
Expo Go app on the same network. `bun run android` starts an available Android
device/emulator; `bun run ios` requires macOS and an iOS simulator. Actual phone
camera, microphone, interruption, and SQLite persistence checks are still pending.
The OCR and Google transcription adapters currently run in the browser preview;
native captures keep their queued work until a native processor is connected.

## Google Speech-to-Text V2

The optional Bun gateway transcribes audio through a company Google Cloud project
using the EU endpoint and `chirp_3`. Its batch path supports the longer conversation
mode. The service requires Speech-to-Text enabled, billing, and permission to use
Speech and a private EU Cloud Storage bucket.

```sh
cp .env.example .env.local
# Fill in the project and bucket in .env.local.
gcloud auth application-default login
bun run server
# In a second terminal (restart it after changing .env.local):
bun run web
```

Google credentials stay in Application Default Credentials, outside the app bundle.
The gateway listens only on `127.0.0.1:8091` and accepts the configured browser
origin. It is a local development service, with no public user authentication;
the hosted pilot uses the separate authenticated Cloud Run service described above.
Native access is not connected to that hosted service yet.

The original recording remains in the browser. A copy is uploaded to the configured
Google bucket, then deleted when processing completes or definitively fails.
Configure a one-day deletion lifecycle as a fallback and disable soft delete if
deleted temporary copies must not remain recoverable. The gateway keeps operation
IDs and transcripts in Git-excluded `data/transcriptions.sqlite`, allowing browser
reconnects and gateway restarts to resume without repeating confirmed submissions.
If submission acknowledgement is lost, it stops with an uncertain status instead
of automatically submitting a duplicate. That case needs an operation check.

## Available in this prototype

- Four capture entry points, explicit new visitors, editable contact/event details,
  searchable drafts, and buyer/seller requests.
- Opening a draft goes straight to its conversation feed. The selected visitor
  survives reloads. Voice note, card photo, and quick-note controls stay at the
  bottom of the phone screen; Details & request holds editable structured fields.
  Voice note starts recording on one tap. Record conversation opens consent and
  the longer recording mode. Card photo offers the rear camera or an existing image.
- Notes and original media form a chronological feed. Pending captures and delayed
  processing results keep their source draft ID when another visitor is opened.
- RFQ completeness checks for product, container, and throughput with units.
- Original card photos and voice recordings saved with the selected draft;
  audio playback, attachment hashes, and duplicate protection. Voice notes are
  limited to three minutes; consented conversations to 30 minutes. Photos are
  limited to 15 MiB and audio to 60 MiB. Further recordings can enrich the same
  visitor. Keep the app open until stop/save completes; long recordings and
  screen-lock behavior still need real-device validation.
- Browser recording collects final audio even when the microphone disconnects or
  the browser stops the recorder. Leaving the visible app attempts to save to the
  original visitor. If saving fails, Close stays disabled: retry, download the
  original, or explicitly confirm discarding it. A navigation warning helps guard
  unsaved recordings where the browser supports it. Recovery before a successful
  save depends on the page staying alive; abrupt OS termination is not covered.
- Draft metadata and media stored together in SQLite on native platforms and
  IndexedDB in browsers. Saved browser drafts and media survive reloads.
- Capture also commits a persistent processing job. Separate card/audio workers,
  leases, bounded retries, and explicit retry controls keep slow processing separate
  from capture. Older local databases migrate their existing attachments into jobs.
- Browser card OCR uses English/German Tesseract in a Web Worker, with engine and
  model files served from Pete's own origin. Card photos are not uploaded for OCR.
- New visitor opens straight into the conversation. Speaking and photographing a
  card require no contact/request form. Clear extracted details fill empty fields
  automatically; manual edits, deliberate blanks and earlier values are preserved.
  Conflicting results show the saved and proposed values together. Confirm all shown
  changes with one tap, keep saved details, or choose individual fields; typing is
  optional. Older sources stop raising conflict warnings after a newer correction.
- Hosted OCR text and transcripts are interpreted by `gemini-3.1-flash-lite` through
  the company's EU multi-region endpoint (`aiplatform.eu.rep.googleapis.com`, location
  `eu`). A single structured call proposes contact details and voice-derived buying/
  selling intent, product, packaging, and paired throughput/unit. Source quotes,
  schemas, lengths, phone codes and units are validated before source-bound commit.
  Ambiguous details stay in the source with a clarification. Model errors remain
  possible; corrections and optional source review stay available.
- Source text is checkpointed locally before interpretation, so retries reuse OCR/
  transcription. Server results are cached per Firebase owner, source kind, text hash
  and extraction version. Atomic leases fence concurrent calls; at most two model
  attempts per source and daily limits of 100 per user / 500 globally bound usage.
  Result/evidence metadata is stored in the existing `pete` Firestore database;
  whole input text is not duplicated in the extraction cache. Photo OCR runs locally;
  hosted cloud backup separately retains the original photo. Removing
  `PETE_DETAILS_MODEL` disables hosted extraction; sources stay saved.
  Runtime identity needs `roles/aiplatform.user` as well as existing permissions.
- The unauthenticated localhost preview keeps its conservative local contact/RFQ
  parser. Hosted interpretation does not run without company authentication. Older
  completed captures keep their prior review flow; no bulk reprocessing is triggered.
- A dated English WhatsApp introduction preview with salesperson details and
  recipient checks. Correcting contact details marks an existing preview outdated.
  Copying a preview is supported; opening WhatsApp and sending are not connected.
- JSON metadata export, including notes, source text, provenance, and unresolved RFQ fields.
  Original media is **not** included in the export.
- Per-visitor `.pete` backups include original card photos, recordings, transcripts,
  notes, reviewed fields and source links. Offline restore creates a separate
  draft and keeps existing visitors and account preferences intact.

CRM writes, Ray matching, and automatic WhatsApp sending remain future integrations.
OCR contact parsing suggests unambiguous email/international phone values and
labelled names/company names; it does not infer missing country codes. Review the
source text and correct OCR/transcription errors before applying details.

Local data belongs to this installation/browser origin. Clearing site data or
uninstalling removes those local records. In the hosted app, confirmed cloud
copies remain recoverable through **Personal cloud backups**; captures still waiting
to upload are not protected by that backup. Keep Pete open until cloud saving finishes.
Save backup files separately before moving devices or clearing storage. A move
from localhost to `pete.bevmaq.com` uses a different browser database.
The development preview needs the server to reopen; the production PWA can reopen
offline after its first successful cache installation. Keep recording open until
saving finishes. OCR, transcription and model interpretation can be wrong; check
important details before acting on them. Throughput and its unit are applied together.
Physical-phone capture quality and long-conversation endurance still need field tests.

## Back up and recover a visitor

For an optional file export, in **Details & request**, choose
**Download backup file → Save backup file**. Keep the
`.pete` file in company file storage and check that the download/share completed.
It includes customer details and original recordings and is not encrypted. Pete
does not upload it automatically. This is a snapshot of one visitor; make a new
backup after adding more information. Account credentials and personal settings
are not included. The older JSON export remains a metadata-only handoff.

On the destination device/origin, sign in and choose **Restore a backup** from **Settings**. Select the file, check the visitor and original-file
counts, then choose **Restore draft**. This works offline once Pete is cached and
the account is signed in. Existing drafts are never overwritten. Importing the
same file again opens its restored copy and preserves any edits to that copy.
Different snapshots create separate copies; Pete does not merge them.

Completed source text and review state travel with the originals. Unfinished
processing stays paused after restore until **Verarbeitung wiederholen** is selected;
retrying audio can submit a new paid transcription. Introduction previews are
marked outdated so they can be prepared with the destination user's details.

Files are checked for schema, source ownership, lengths and SHA-256 integrity
before a transaction writes the complete draft/media/jobs together. Corruption
or a failed write leaves existing drafts intact. Backups are limited to 128 MiB,
including up to 4 MiB of metadata, and 250 attachments. Both SQLite and IndexedDB
adapters implement restore; physical native picker/share behavior remains untested.
The native picker uses [Expo DocumentPicker](https://docs.expo.dev/versions/latest/sdk/document-picker/).
The format is documented in [src/backup/README.md](src/backup/README.md).

## Verification

```sh
bun run typecheck
bun test
bun run test:auth
bun run build:web

# Install the test browser once, then run browser workflows.
bunx playwright install chromium
bun run test:e2e
```

To use an existing Chrome installation instead:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome bun run test:e2e

# Production suite also verifies installation resources and offline reload/capture.
EXPO_PUBLIC_PROCESSING_URL=http://127.0.0.1:8091 bun run build:web
PETE_E2E_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome bun run test:e2e
```

The browser suite starts or reuses the local server and uses synthetic contacts,
images, and a simulated microphone. It includes real local OCR; transcription
responses are intercepted, so browser tests do not call the company Google service.
Its server configuration enables the mock gateway URL even without cloud credentials.
If reusing a manually started server, use the same `EXPO_PUBLIC_PROCESSING_URL` as
`.env.example`. Tests cover capture/reload/playback, visitor separation, RFQs, export,
follow-up corrections, narrow screens, permission denial, and extraction review.
Recording regressions exercise microphone disconnection, a visibility interruption,
and a failed media write: downloaded and retried originals must have identical
hashes, retries must create one job, and the microphone must be released.
Production tests use port 8082 and additionally cover offline reopen/recording,
reconnection, source association after switching visitors, static-only caching,
and the visible version remaining tied to the cached build.
Unit tests cover draft rules, database migration, transaction rollback, queue leases,
retry/recovery, manual-edit protection, and Google operation persistence/cleanup.
Cloud tests require verified originals before acknowledging a save, isolate owners,
and reject corrupted media or stale snapshots. Hosted browser tests replay a lost
upload response, offline edits/reconnect, original reuse and cloud recovery. Input
tests simulate composition and keyboard resize in Chromium/WebKit, including
background filling while a manual form remains open. Actual iPhone dictation is
still a physical-device check.

The storage recovery regression also runs in WebKit against the production build:

```sh
bunx playwright install webkit
bun run build:web
bun run test:webkit
```

It replays the reported missing-transaction index error on real browser requests,
then verifies card capture, local OCR, review, and persistence after reload. A second
case verifies that background queue failures leave capture available and clear on
recovery. The workaround rolls back the failed transaction and uses an atomic
object-store scan in bounded batches on the affected connection; it does not reset
the database.
These checks do not replace physical-device testing. An Android JavaScript/Hermes
export can be checked with:

```sh
bun expo export --platform android --output-dir .tmp/android-export
```

The application uses Expo/React Native with platform-specific storage and media
adapters. UI is in `App.tsx` and `src/ui/`; draft rules are in `src/domain/`, queue
and processors in `src/processing/`, and the Google gateway in `server/`.

`bun run bench:storage` measures real-browser queue and durable capture latency
with 50/500 synthetic visitors, verifies originals after reopening, and saves local
reports. See [benchmarks/README.md](benchmarks/README.md) for workload, provisional
budgets, CPU-throttled/WebKit runs and the limits of these lab measurements.

Implementation references: [Tesseract worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)
and [Google V2 batch transcription](https://docs.cloud.google.com/speech-to-text/docs/batch-recognize).

## Research and private context

Zello's SDK/sample source investigation informed the capture approach. Zello is
not an app dependency, and production-app/device reverse engineering remains open.
Analysis uses the existing global `rea` CLI, not a project npm/npx installation.
Private source recordings, findings, plans, screenshots, and local agent
instructions remain Git-excluded under `__docs__/` and local configuration paths.

### Automatic-filling verification

After `bun run build:hosted`, run `bun run test:hosted`. Isolated browser profiles
use synthetic Firebase identity state and intercept every external/API request;
no live identity is changed and no fixture reaches Google. The suite exercises
real local OCR, microphone capture, automatic filling without form entry, delayed
visitor association, source checkpoint reuse, reload and optional manual review.
`bun run eval:details` is a separate, opt-in **live company-GCP** check using only
nine committed synthetic texts (English/German, follow-ups and corrections, clear
and ambiguous input, and embedded instructions). It consumes model quota and requires ADC. Passing that
small evaluation is not a general extraction-accuracy claim.

The EU processing endpoint follows Google's
[multi-region location guidance](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations).
