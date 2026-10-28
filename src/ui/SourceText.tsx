import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { titleOf, type Attachment, type Draft } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import { Button, ErrorNotice, Field, Sheet, Txt } from './primitives';
import { colors } from './theme';
import type { Workspace } from '../useWorkspace';
import { sourceText, sourceAttribution } from '../processing/source';
import { useUpdateGuard } from '../pwa/updateGuard';

/** Reading a source never marks an extraction reviewed or changes draft fields. */
export function SourceText({ draft, attachment, job, workspace }: { draft: Draft; attachment: Attachment; job?: ProcessingJob; workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState('');
  const [revision, setRevision] = useState(draft.revision);
  const [busy, setBusy] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  useUpdateGuard(editing || busy);
  useEffect(() => {
    const key = `source:${draft.id}/${attachment.id}`;
    if (editing) workspace.holdTeamUpdates(true, key);
    return () => { if (editing) workspace.holdTeamUpdates(false, key); };
  }, [editing, draft.id, attachment.id]);
  // Keep the source bound to both the visitor and attachment, including while
  // extraction is paused but the transcript has already been saved.
  const text = job?.draftId === draft.id && job.attachmentId === attachment.id ? sourceText(job.result) : undefined;
  if (!text) return null;
  const card = attachment.kind === 'card';
  const title = card ? 'Card text' : 'Transcript';
  const context = [titleOf(draft), draft.contact.company, draft.event].filter(Boolean).join(' · ');
  return <View style={{ gap: 2 }}>
    {editing ? <View style={{ gap: 10, padding: 14, backgroundColor: colors.pale, borderRadius: 10 }}>
      <Field label="Correct transcript" multiline value={edited} onChangeText={setEdited} autoFocus />
      <Txt style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>Correct the words Pete heard. The original transcript and recording are kept.</Txt>
      <ErrorNotice message={error} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label={busy ? 'Saving…' : 'Save correction'} disabled={busy || !edited.trim() || edited.trim() === text} onPress={async () => {
          if (!job || busy) return;
          setBusy(true); setError('');
          try { await workspace.correctTranscript(job.id, edited, revision); setEditing(false); }
          catch (e) { setError(e instanceof Error ? e.message : 'Could not save correction.'); }
          finally { setBusy(false); }
        }} />
        <Button label="Cancel correction" kind="quiet" disabled={busy} onPress={() => setEditing(false)} />
      </View>
    </View> : <>
    {!!job?.result?.activeEditId && <Txt style={{ fontSize: 14, color: colors.green }}>Corrected transcript</Txt>}
    <View style={{ borderLeftWidth: 2, borderColor: colors.accent, paddingLeft: 12 }}>
      <Txt numberOfLines={4} selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{text}</Txt>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      <Button label={card ? 'Read card text' : 'Read transcript'} kind="quiet" style={{ alignSelf: 'flex-start' }} onPress={() => { setCopied(false); setError(''); setOpen(true); }} />
      {!card && <Button label="Correct transcript" kind="quiet" disabled={job?.state === 'running' || job?.state === 'queued'} onPress={() => { setEdited(text); setRevision(draft.revision); setError(''); setEditing(true); }} />}
    </View>
    </>}
    {open && <Sheet title={title} subtitle={context} onClose={() => setOpen(false)}>
      <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{card ? 'Business card' : attachment.voiceMode === 'conversation' ? 'Conversation recording' : 'Voice note'} · {new Date(attachment.capturedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</Txt>
      <Button label={copied ? 'Text copied' : 'Copy text'} icon="copy" kind="quiet" style={{ alignSelf: 'flex-start' }} onPress={async () => {
        try { await Clipboard.setStringAsync(text); setCopied(true); setError(''); }
        catch { setError('Could not copy the text. You can still select and copy it below.'); }
      }} />
      <ErrorNotice message={error} />
      <Txt selectable testID="source-reader-text">{text}</Txt>
      <Txt style={{ fontSize: 14, color: colors.muted }}>{sourceAttribution(job?.result)}</Txt>
      {!!job?.result?.sourceEngine && job.result.engine !== job.result.sourceEngine && <Txt style={{ fontSize: 14, color: colors.muted }}>Details: {job.result.engine}</Txt>}
      {!!job?.result?.activeEditId && <>
        <Button label={originalOpen ? 'Hide original transcript' : 'Original transcript'} kind="quiet" onPress={() => setOriginalOpen(!originalOpen)} />
        {originalOpen && <Txt selectable>{job.result.text}</Txt>}
      </>}
    </Sheet>}
  </View>;
}
