# Pete visitor workflow preview

This is an unpublished 0.9.0 candidate, based on the 0.8.2 pilot. Pete captures a
visitor and their need while a salesperson is talking with them. Ray advises on
equipment using those captured facts. Recording and saving must work independently
of Ray's availability.

## Review the workflow

```sh
bun install
bun run build:workflow-preview
bun run preview:workflow
```

Open `http://localhost:8086`. This separate origin has its own local visitors. It
does not sign in to Firebase, share with the team, or change pilot records. Google
Speech-to-Text V2 (chirp_3, EU), EU detail extraction and Ray are real services;
the developer gateway uses the existing authorized company credentials. It binds
only to loopback. Keep the established development origin on port 8081 unchanged.

1. Start a visitor with a card, a memo, a request, or a conversation.
2. Record conversation starts immediately after microphone permission. Agreement
   has already been obtained; recordings remain distinguished from personal memos.
3. Ask Ray once. Saved answers update the advice after processing. Pause suspends
   later automatic updates; a completed reply does not need stopping. The restored
   0.7.1 advisory policy and existing Ray service are unchanged.
4. New captures appear above older captures. Advice occupies its place in the same
   timeline. Details and manual editing open on demand. Capture controls persist.
5. Correct a misheard transcript beside its recording. The original audio and
   transcript remain available. Corrections are saved before re-extraction; Ray
   waits for processing and any actual field conflict to resolve.
6. Find recovery/export in Settings. Unfinished CRM/WhatsApp actions are absent
   from the visitor screen.

## Validation and limits

- `bun run typecheck` and `bun test ./tests` cover the model/storage changes,
  backup round trips, concurrent correction choices, and old-client protection.
- `bun run test:workflow --project=chromium` covers one-tap conversation recording,
  newest-first order, responsive layout, correction-to-Ray continuation, separate
  transcription attribution, slow replies, failure recovery and visitor binding.
  Browser tests intercept all model endpoints and use synthetic captures.
- The WebKit project exercises notes, navigation and Ray failure at mobile width.
  It requires the host's WebKit runtime dependencies. It does not validate an
  actual iPhone microphone, Safari backgrounding or a long conversation.
- Separate synthetic service checks verified EU STT returning “1 mm”, EU
  extraction preserving that value, and live Ray using it while asking about
  remaining cap specifications. This single example is not a model quality
  benchmark or a claim that recognition errors cannot recur.
- Existing misclassified pilot fields are not silently rewritten. Corrected
  conflicting values still require a focused field choice. Original transcripts
  with lost engine metadata are labeled unknown rather than guessed.
- Corrections require backup format v2; the new reader still opens v1. See
  `src/backup/README.md`. Deploy server readers/protection before any eventual
  frontend rollout and validate mixed-version team sync with the complete hosted
  suite. The preview does not certify production rollout.

Next acceptance step: use this workflow during a realistic conversation, then
validate recording and interruption recovery on a physical iPhone before choosing
to publish. Preview code and public pilot remain separate.
