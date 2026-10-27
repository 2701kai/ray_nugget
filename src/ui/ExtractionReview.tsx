import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Contact, Draft } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import type { Workspace } from '../useWorkspace';
import { Button, ErrorNotice, Field, Sheet, Txt } from './primitives';
import { Icon } from './Icon';
import { colors } from './theme';

const labels: Record<keyof Contact, string> = { name: 'Full name', company: 'Company', email: 'Email', phone: 'Mobile number' };

export function ExtractionReview({ job, draft, workspace, close }: { job: ProcessingJob; draft: Draft; workspace: Workspace; close: () => void }) {
  const [revision] = useState(draft.revision);
  const [values, setValues] = useState<Contact>({ ...draft.contact, ...job.result?.fields });
  const [selected, setSelected] = useState<Partial<Record<keyof Contact, boolean>>>(() => Object.fromEntries(
    (Object.keys(labels) as Array<keyof Contact>).map(field => [field, !!job.result?.fields[field] && !draft.contact[field] && !draft.provenance[`contact.${field}`]]),
  ));
  const [append, setAppend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function finish(apply: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const fields = apply ? Object.fromEntries((Object.keys(labels) as Array<keyof Contact>).filter(field => selected[field]).map(field => [field, values[field]])) : {};
      await workspace.reviewJob(job.id, fields, revision, apply && append); close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the review.'); }
    finally { setBusy(false); }
  }
  return <Sheet title={job.kind === 'card' ? 'Read. Check. Keep.' : 'Review the conversation.'} subtitle="The original stays attached to this visitor" locked={busy} onClose={close}>
    <Txt style={{ color: colors.muted, fontSize: 12 }}>Check the source text before using a suggestion. Existing details are left unselected; select a field explicitly to replace it.</Txt>
    <View style={{ backgroundColor: colors.pale, padding: 16, borderRadius: 12, gap: 8 }}>
      <Txt weight="semibold" style={{ fontSize: 12 }}>{job.kind === 'card' ? 'Text read from the card' : 'Transcript'}</Txt>
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled><Txt selectable style={{ fontSize: 12, lineHeight: 20 }}>{job.result?.text || 'No readable text found. Keep the original and add the details manually.'}</Txt></ScrollView>
      {(job.result?.text.length ?? 0) > 600 && <Txt style={{ fontSize: 10, color: colors.muted }}>Scroll the source text to read more.</Txt>}
      <Txt style={{ color: colors.muted, fontSize: 10 }}>{job.result?.engine}</Txt>
    </View>
    {!!job.result?.text && <Button kind="quiet" label={copied ? 'Source text copied' : 'Copy source text'} icon="copy" onPress={async () => { try { await Clipboard.setStringAsync(job.result!.text); setCopied(true); } catch { setError('Could not copy the text.'); } }} />}
    {job.reviewedAt !== undefined ? <Txt style={{ color: colors.green }}>Reviewed. The source text remains available here.</Txt> : <>
      {(Object.keys(labels) as Array<keyof Contact>).map(field => <View key={field} style={{ gap: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 12 }}>
        <Check label={`Use ${labels[field].toLowerCase()}`} checked={!!selected[field]} onPress={() => setSelected({ ...selected, [field]: !selected[field] })} />
        <Field label={labels[field]} value={values[field]} onChangeText={value => { setValues({ ...values, [field]: value }); setSelected({ ...selected, [field]: true }); }} helper={draft.contact[field] ? `Currently: ${draft.contact[field]}` : undefined} />
      </View>)}
      {job.kind === 'voice' && !!job.result?.text && <Check label="Append transcript to conversation notes" checked={append} onPress={() => setAppend(!append)} />}
      <ErrorNotice message={error} />
      <Button label={busy ? 'Saving review…' : 'Apply selected details'} disabled={busy || (!append && !Object.values(selected).some(Boolean))} icon="check" onPress={() => finish(true)} />
      <Button label="Keep existing details" disabled={busy} kind="quiet" onPress={() => finish(false)} />
    </>}
  </Sheet>;
}

function Check({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} onPress={onPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 36 }}>
    <View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: checked ? colors.green : colors.paper }}>{checked && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 12 }}>{label}</Txt>
  </Pressable>;
}

export function ProcessingStatus({ draft, attachmentId, workspace }: { draft: Draft; attachmentId: string; workspace: Workspace }) {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const job = workspace.jobs.find(task => task.draftId === draft.id && task.attachmentId === attachmentId);
  if (!job) return null;
  const available = workspace.supportedKinds.includes(job.kind);
  const label = job.state === 'complete' ? job.reviewedAt !== undefined ? 'Reviewed · source text kept' : 'Text ready to review'
    : !available ? job.kind === 'voice' ? 'Transcription connection needed' : 'Card reading available in the browser preview'
    : job.state === 'running' ? job.kind === 'voice' ? 'Transcribing with Google · original is safe' : 'Reading the business card…'
    : job.state === 'failed' ? 'Processing paused · retry when ready'
    : job.error ? 'Will retry shortly · original is safe' : 'Waiting to read · original is safe';
  return <View style={{ gap: 6 }}>
    <Txt accessibilityLiveRegion="polite" style={{ fontSize: 11, lineHeight: 18, color: job.state === 'failed' ? colors.danger : colors.green }}>{label}</Txt>
    {!!job.error && <Txt style={{ fontSize: 10, color: colors.muted }}>{job.error}</Txt>}
    <ErrorNotice message={error} />
    {job.state === 'complete' && <Button label={job.reviewedAt !== undefined ? 'View source text' : 'Review extracted text'} kind="secondary" onPress={() => setReviewing(true)} />}
    {job.state === 'failed' && available && <Button label="Retry processing" kind="secondary" onPress={async () => { try { await workspace.retryJob(job.id); } catch { setError('Could not queue the retry.'); } }} />}
    {reviewing && <ExtractionReview key={job.id} job={job} draft={draft} workspace={workspace} close={() => setReviewing(false)} />}
  </View>;
}
