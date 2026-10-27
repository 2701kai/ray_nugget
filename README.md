# Pete by BEVMAQ

A capture workspace for trade fairs and customer visits. Start with a contact,
business-card photo, voice note, or buyer/seller request, then enrich the same
editable visitor draft in any order.

The Firebase pilot is at **https://bevmaq-platform.web.app**. The dedicated address
**https://pete.bevmaq.com** is configured; initial DNS and certificate propagation
may still be in progress. The repository remains `ray_nugget`; the app is named Pete.

## Hosted pilot

Use **Continue with Google** and select your `@bevmaq.com` work account.
Only verified company accounts can open the workspace or use transcription.
Sign out in Settings. The Google account picker hints at the company domain;
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

Drafts, notes, photos, and original recordings still live **on this device**.
There is no automatic cross-device draft sync or cloud backup. Localhost, the
Firebase address, and the custom domain each have separate browser storage.
Use a `.pete` draft backup to transfer originals and source text between them.
Use the final custom domain consistently once HTTPS is ready.
Pilot transcription is capped at 40 new attempts per account and 200 total per UTC
day, with 60 MiB per recording. Processing needs Pete open and connected to submit
or collect results; Google's accepted operation can continue while Pete is closed.
Hosting, storage, compute, and speech use the existing company GCP billing account.

Release targets and non-secret runtime settings are in `deploy/`. Build/release
the frontend using company Application Default Credentials:

```sh
bun run build:hosted
bun run deploy:hosting
```

The hosted build uses `dist-hosted/`, leaving the localhost build and its data
alone. Only Firebase's public browser configuration enters the bundle. The release
script checks the site's associated app before publishing, and sends only static
assets. Reserved Firebase `/__/` handlers and `/api/` bypass the service worker.

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
delete/recreate accounts to switch providers. After an update, close and reopen
existing Pete tabs to activate the waiting service worker without clearing data.

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
drafts stay in IndexedDB. Updates wait until existing Pete tabs are closed, so an
update cannot reload an ongoing recording. Development/HMR does not install a
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
- Draft metadata and media stored together in SQLite on native platforms and
  IndexedDB in browsers. Saved browser drafts and media survive reloads.
- Capture also commits a persistent processing job. Separate card/audio workers,
  leases, bounded retries, and explicit retry controls keep slow processing separate
  from capture. Older local databases migrate their existing attachments into jobs.
- Browser card OCR uses English/German Tesseract in a Web Worker, with engine and
  model files served from Pete's own origin. Card photos are not uploaded for OCR.
- Source text and suggested contact fields stay separate until reviewed. Existing
  or manually cleared details are unselected by default; applying a review checks
  the draft revision. Transcripts can be copied or explicitly appended to notes.
- Voice review also suggests RFQ product, container, and throughput with its unit.
  Each suggestion shows its source phrase and can be corrected or deselected.
  A local English/German parser recognizes labelled fields, common beverage and
  packaging terms, and explicit hourly rates. Conflicting matches, recognized
  negations, estimates, and ranges remain in the transcript for manual review.
  It does not infer buyer/seller intent, missing units, or convert per-minute rates.
  Previously saved, unreviewed transcripts work without another cloud request.
- A dated German WhatsApp introduction preview with salesperson details and
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

Data belongs to this installation/browser origin. There is no automatic sync or
cloud backup; clearing site data or uninstalling the app removes local records.
Save backup files separately before moving devices or clearing storage. A move
from localhost to `pete.bevmaq.com` uses a different browser database.
The development preview needs the server to reopen; the production PWA can reopen
offline after its first successful cache installation. Keep recording open until
saving finishes. RFQ suggestions use limited text patterns, not a general language
model; unrecognized phrasing and transcription errors still require manual review.
Selecting throughput always applies its amount and unit together.

## Back up and recover a visitor

In **Details & request**, choose **Save draft backup → Save backup file**. Keep the
`.pete` file in company file storage and check that the download/share completed.
It includes customer details and original recordings and is not encrypted. Pete
does not upload it automatically. This is a snapshot of one visitor; make a new
backup after adding more information. Account credentials and personal settings
are not included. The older JSON export remains a metadata-only handoff.

On the destination device/origin, sign in and choose **Restore a backup** from the
draft list or Your details. Select the file, check the visitor and original-file
counts, then choose **Restore draft**. This works offline once Pete is cached and
the account is signed in. Existing drafts are never overwritten. Importing the
same file again opens its restored copy and preserves any edits to that copy.
Different snapshots create separate copies; Pete does not merge them.

Completed source text and review state travel with the originals. Unfinished
processing stays paused after restore until **Retry processing** is selected;
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
Production tests use port 8082 and additionally cover offline reopen/recording,
reconnection, source association after switching visitors, and static-only caching.
Unit tests cover draft rules, database migration, transaction rollback, queue leases,
retry/recovery, manual-edit protection, and Google operation persistence/cleanup.

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
object-store cursor on the affected connection; it does not reset the database.
These checks do not replace physical-device testing. An Android JavaScript/Hermes
export can be checked with:

```sh
bun expo export --platform android --output-dir .tmp/android-export
```

The application uses Expo/React Native with platform-specific storage and media
adapters. UI is in `App.tsx` and `src/ui/`; draft rules are in `src/domain/`, queue
and processors in `src/processing/`, and the Google gateway in `server/`.

Implementation references: [Tesseract worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)
and [Google V2 batch transcription](https://docs.cloud.google.com/speech-to-text/docs/batch-recognize).

## Research and private context

Zello's SDK/sample source investigation informed the capture approach. Zello is
not an app dependency, and production-app/device reverse engineering remains open.
Analysis uses the existing global `rea` CLI, not a project npm/npx installation.
Private source recordings, findings, plans, screenshots, and local agent
instructions remain Git-excluded under `__docs__/` and local configuration paths.
