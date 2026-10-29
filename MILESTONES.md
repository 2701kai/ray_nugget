# Pete milestones

## 0.9.0 — Visitor workflow and traceable corrections — October 29, 2026

Pete keeps the salesperson focused on the visitor: capture their need, consult
Ray, save answers, and continue the conversation. This release consolidates the
capture controls, shows new entries first, and keeps details and recovery tools
available on demand.

- Conversation recording starts directly after microphone permission, with prior
  agreement obtained by the salesperson. Memos and conversations remain distinct.
- Ask Ray retains the restored advisory policy and automatic saved-answer follow-up.
  Hidden advice stays hidden during automatic updates; explicit Ask Ray reveals it.
- Transcript corrections preserve original text/audio and reach extraction and Ray.
  Genuine changes to saved facts require a focused choice. Original transcription
  attribution is separate from the detail-extraction engine.
- Team sync and v2 backups preserve correction history. New readers accept v1;
  older clients cannot overwrite cloud corrections. The API is rolled out before
  the frontend. No customer-record rewrite or bulk migration is performed.
- Backup/export lives in Settings. Unfinished CRM and WhatsApp actions are removed
  from the visitor workspace; the existing intake foundation remains.

Release checks cover unit behavior, hosted card/voice filling, interrupted saves,
cloud recovery, two-member sync and conflicts, correction transfer, rejection of
older-client correction loss, Ray continuation/hiding/cancel, and guarded PWA
updates during recording, forms and transcript correction. The release also retains
the earlier synthetic checks of real EU Speech V2, extraction and Ray using 1 mm.
Exact run counts and deployment identities are recorded in the private release log.

The user approved deployment after reviewing the working preview. Physical iPhone
microphone/backgrounding and long-conversation acceptance remain open pilot checks.
This milestone does not claim those checks passed or that recognition errors cannot
recur. The 1.0.0 milestone still requires validation on the team's actual devices.

Checkpoint: `checkpoint/pete-0.8.2-before-0.9.0`. Release tag: `v0.9.0`.
Once corrected v2 records are saved, recovery must retain a v2-capable reader/API;
do not blindly roll the data path back to 0.8.2.
