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
browser permission. There is no account, server, or seeded customer data.

For a phone preview, run `bun run start` and open the project in a compatible
Expo Go app on the same network. `bun run android` starts an available Android
device/emulator; `bun run ios` requires macOS and an iOS simulator. Actual phone
camera, microphone, interruption, and SQLite persistence checks are still pending.

## Available in this prototype

- Four capture entry points, explicit new visitors, editable contact/event details,
  searchable drafts, and buyer/seller requests.
- RFQ completeness checks for product, container, and throughput with units.
- Original card photos and voice recordings saved with the selected draft;
  audio playback, attachment hashes, and duplicate protection. Voice notes are
  limited to three minutes; files to 15 MiB. Conversation recording requires
  confirming the other person's consent.
- Draft metadata and media stored together in SQLite on native platforms and
  IndexedDB in browsers. Saved browser drafts and media survive reloads.
- A dated German WhatsApp introduction preview with salesperson details and
  recipient checks. Correcting contact details marks an existing preview outdated.
  Copying a preview is supported; opening WhatsApp and sending are not connected.
- JSON metadata export, including provenance and unresolved RFQ fields.
  Original media is **not** included in the export.

OCR, transcription, a processing queue, CRM writes, Ray matching, and automatic
WhatsApp sending are future integrations. The domain layer already handles
idempotent extraction results and preserves manual corrections, but no extraction
service runs yet.

Data belongs to this installation/browser origin. There is no sync or backup;
clearing site data or uninstalling the app removes local records. A future move
from localhost to `pete.bevmaq.com` will use a different browser database. The web
preview has no offline app-shell cache; it needs the server to load the app.
Keep recording open until saving finishes.

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
```

The browser suite starts or reuses the local server and uses synthetic contacts,
images, and a simulated microphone. It covers capture/reload/playback, separate
visitors, RFQs, export, follow-up corrections, narrow screens, and permission denial.
Unit tests cover draft rules and transactional IndexedDB persistence/revisions.
These checks do not replace physical-device testing. An Android JavaScript/Hermes
export can be checked with:

```sh
bun expo export --platform android --output-dir .tmp/android-export
```

The application uses Expo/React Native with platform-specific storage and media
adapters. UI is in `App.tsx` and `src/ui/`; draft rules are in `src/domain/`.

## Research and private context

Zello's SDK/sample source investigation informed the capture approach. Zello is
not an app dependency, and production-app/device reverse engineering remains open.
Analysis uses the existing global `rea` CLI, not a project npm/npx installation.
Private source recordings, findings, plans, screenshots, and local agent
instructions remain Git-excluded under `__docs__/` and local configuration paths.
