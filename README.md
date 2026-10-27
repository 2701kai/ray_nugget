# Pete by BEVMAQ

A capture workspace for trade fairs and customer visits. Start with a contact,
business-card photo, voice note, or buyer/seller request, then enrich the same
editable visitor draft in any order.

The intended production address is **https://pete.bevmaq.com**. Hosting, DNS, and
deployment are not configured yet. The repository remains `ray_nugget`; the app
is named Pete.

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
refers to the phone itself. Public hosting is not configured yet.

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
deployment at `pete.bevmaq.com` requires an authenticated server and native access
configuration first.

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
- A dated German WhatsApp introduction preview with salesperson details and
  recipient checks. Correcting contact details marks an existing preview outdated.
  Copying a preview is supported; opening WhatsApp and sending are not connected.
- JSON metadata export, including notes, source text, provenance, and unresolved RFQ fields.
  Original media is **not** included in the export.

CRM writes, Ray matching, and automatic WhatsApp sending remain future integrations.
OCR contact parsing suggests unambiguous email/international phone values and
labelled names/company names; it does not infer missing country codes. Review the
source text and correct OCR/transcription errors before applying details.

Data belongs to this installation/browser origin. There is no sync or backup;
clearing site data or uninstalling the app removes local records. A future move
from localhost to `pete.bevmaq.com` will use a different browser database.
The development preview needs the server to reopen; the production PWA can reopen
offline after its first successful cache installation. Keep recording open until
saving finishes. Automatic structured RFQ extraction is still pending; today the
transcript is reviewable and the request fields are editable manually.

## Verification

```sh
bun run typecheck
bun test
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
