import { useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { titleOf, type Attachment, type Draft } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import { Button, ErrorNotice, Sheet, Txt } from './primitives';
import { colors } from './theme';

/** Reading a source never marks an extraction reviewed or changes draft fields. */
export function SourceText({ draft, attachment, job }: { draft: Draft; attachment: Attachment; job?: ProcessingJob }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  // Keep the source bound to both the visitor and attachment, including while
  // extraction is paused but the transcript has already been saved.
  const text = job?.draftId === draft.id && job.attachmentId === attachment.id ? job.result?.text : undefined;
  if (!text) return null;
  const card = attachment.kind === 'card';
  const title = card ? 'Card text' : 'Transcript';
  const context = [titleOf(draft), draft.contact.company, draft.event].filter(Boolean).join(' · ');
  return <View style={{ gap: 2 }}>
    <View style={{ borderLeftWidth: 2, borderColor: colors.accent, paddingLeft: 12 }}>
      <Txt numberOfLines={4} selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{text}</Txt>
    </View>
    <Button label={card ? 'Read card text' : 'Read transcript'} kind="quiet" icon="request" style={{ alignSelf: 'flex-start' }} onPress={() => { setCopied(false); setError(''); setOpen(true); }} />
    {open && <Sheet title={title} subtitle={context} onClose={() => setOpen(false)}>
      <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{card ? 'Business card' : attachment.voiceMode === 'conversation' ? 'Conversation recording' : 'Voice note'} · {new Date(attachment.capturedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</Txt>
      <Button label={copied ? 'Text copied' : 'Copy text'} icon="copy" kind="quiet" style={{ alignSelf: 'flex-start' }} onPress={async () => {
        try { await Clipboard.setStringAsync(text); setCopied(true); setError(''); }
        catch { setError('Could not copy the text. You can still select and copy it below.'); }
      }} />
      <ErrorNotice message={error} />
      <Txt selectable testID="source-reader-text">{text}</Txt>
    </Sheet>}
  </View>;
}
