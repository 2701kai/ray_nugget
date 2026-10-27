import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Contact, Draft, RequestReview } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import { requestCandidates } from '../processing/request';
import type { Workspace } from '../useWorkspace';
import { Button, Choice, ErrorNotice, Field, Sheet, Txt } from './primitives';
import { Icon } from './Icon';
import { colors } from './theme';

const labels: Record<keyof Contact, string> = { name: 'Full name', company: 'Company', email: 'Email', phone: 'Mobile number' };

export function ExtractionReview({ job, draft, workspace, close }: { job: ProcessingJob; draft: Draft; workspace: Workspace; close: () => void }) {
  const [revision] = useState(draft.revision);
  const [values, setValues] = useState<Contact>({ ...draft.contact, ...job.result?.fields });
  const [selected, setSelected] = useState<Partial<Record<keyof Contact, boolean>>>(() => Object.fromEntries(
    (Object.keys(labels) as Array<keyof Contact>).map(field => [field, !!job.result?.fields[field] && !draft.contact[field] && !draft.provenance[`contact.${field}`]]),
  ));
  const [candidates] = useState(() => job.kind === 'voice' ? requestCandidates(job.result?.text ?? '') : {});
  const [request, setRequest] = useState(() => ({ ...draft.request,
    product: candidates.product?.value ?? draft.request.product,
    packaging: candidates.packaging?.value ?? draft.request.packaging,
    ...(candidates.capacity?.value ?? {}),
  }));
  const [requestSelected, setRequestSelected] = useState<Record<'product' | 'packaging' | 'capacity', boolean>>(() => {
    const untouched = (field: 'product' | 'packaging' | 'throughput' | 'unit') => !draft.request[field] && !draft.provenance[`request.${field}`];
    return { product: !!candidates.product && untouched('product'), packaging: !!candidates.packaging && untouched('packaging'), capacity: !!candidates.capacity && untouched('throughput') && untouched('unit') };
  });
  const [append, setAppend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function finish(apply: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const fields = apply ? Object.fromEntries((Object.keys(labels) as Array<keyof Contact>).filter(field => selected[field]).map(field => [field, values[field]])) : {};
      const reviewedRequest: RequestReview = {};
      if (apply && job.kind === 'voice') {
        if (requestSelected.product) reviewedRequest.product = request.product;
        if (requestSelected.packaging) reviewedRequest.packaging = request.packaging;
        if (requestSelected.capacity) reviewedRequest.capacity = { throughput: request.throughput, unit: request.unit };
      }
      await workspace.reviewJob(job.id, fields, revision, { appendTranscript: apply && append, request: Object.keys(reviewedRequest).length ? reviewedRequest : undefined }); close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the review.'); }
    finally { setBusy(false); }
  }
  return <Sheet title={job.kind === 'card' ? 'Read. Check. Keep.' : 'Review the conversation.'} subtitle="The original stays attached to this visitor" locked={busy} onClose={close}>
    <Txt style={{ color: colors.muted, fontSize: 16 }}>Check the source text before using a suggestion. Existing details are left unselected; select a field explicitly to replace it.</Txt>
    <View style={{ backgroundColor: colors.pale, padding: 16, borderRadius: 12, gap: 8 }}>
      <Txt weight="semibold" style={{ fontSize: 16 }}>{job.kind === 'card' ? 'Text read from the card' : 'Transcript'}</Txt>
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{job.result?.text || 'No readable text found. Keep the original and add the details manually.'}</Txt></ScrollView>
      {(job.result?.text.length ?? 0) > 600 && <Txt style={{ fontSize: 16, color: colors.muted }}>Scroll the source text to read more.</Txt>}
      <Txt style={{ color: colors.muted, fontSize: 16 }}>{job.result?.engine}</Txt>
    </View>
    {!!job.result?.text && <Button kind="quiet" label={copied ? 'Source text copied' : 'Copy source text'} icon="copy" onPress={async () => { try { await Clipboard.setStringAsync(job.result!.text); setCopied(true); } catch { setError('Could not copy the text.'); } }} />}
    {job.reviewedAt !== undefined ? <Txt style={{ color: colors.green }}>Reviewed. The source text remains available here.</Txt> : <>
      {(Object.keys(labels) as Array<keyof Contact>).map(field => <View key={field} style={{ gap: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 12 }}>
        <Check label={`Use ${labels[field].toLowerCase()}`} checked={!!selected[field]} onPress={() => setSelected({ ...selected, [field]: !selected[field] })} />
        <Field label={labels[field]} value={values[field]} onChangeText={value => { setValues({ ...values, [field]: value }); setSelected({ ...selected, [field]: true }); }} helper={draft.contact[field] ? `Currently: ${draft.contact[field]}` : undefined} />
      </View>)}
      {job.kind === 'voice' && <View style={{ gap: 18, borderTopWidth: 1, borderColor: colors.line, paddingTop: 16 }}>
        <View style={{ gap: 4 }}><Txt weight="bold">Filling request</Txt><Txt style={{ color: colors.muted, fontSize: 16 }}>Check these details against the conversation. Missing or unclear information can be added manually.</Txt></View>
        {(['product', 'packaging'] as const).map(field => <View key={field} style={{ gap: 8 }}>
          <Check label={field === 'product' ? 'Use product' : 'Use container / packaging'} checked={requestSelected[field]} onPress={() => setRequestSelected({ ...requestSelected, [field]: !requestSelected[field] })} />
          <Field label={field === 'product' ? 'Product to fill' : 'Container / packaging'} value={request[field]} onChangeText={value => { setRequest({ ...request, [field]: value }); setRequestSelected({ ...requestSelected, [field]: true }); }} helper={draft.request[field] ? `Currently: ${draft.request[field]}` : draft.provenance[`request.${field}`] ? 'Previously cleared. Select explicitly to replace.' : undefined} />
          <Evidence text={candidates[field]?.evidence} />
        </View>)}
        <View style={{ gap: 8 }}>
          <Check label="Use throughput and unit" checked={requestSelected.capacity} onPress={() => setRequestSelected({ ...requestSelected, capacity: !requestSelected.capacity })} />
          <Field label="Required throughput" value={request.throughput} keyboardType="decimal-pad" onChangeText={throughput => { setRequest({ ...request, throughput }); setRequestSelected({ ...requestSelected, capacity: true }); }} helper={draft.request.throughput || draft.request.unit ? `Currently: ${draft.request.throughput || '—'} ${draft.request.unit}` : draft.provenance['request.throughput'] || draft.provenance['request.unit'] ? 'Previously cleared. Select explicitly to replace.' : undefined} />
          <Choice label="Throughput unit" value={request.unit} options={[{ value: '', label: 'Choose unit' }, { value: 'bottles/h', label: 'Bottles / hour' }, { value: 'units/h', label: 'Units / hour' }, { value: 'L/h', label: 'Litres / hour' }]} onChange={unit => { setRequest({ ...request, unit }); setRequestSelected({ ...requestSelected, capacity: true }); }} />
          <Evidence text={candidates.capacity?.evidence} />
        </View>
      </View>}
      {job.kind === 'voice' && !!job.result?.text && <Check label="Append transcript to conversation notes" checked={append} onPress={() => setAppend(!append)} />}
      <ErrorNotice message={error} />
      <Button label={busy ? 'Saving review…' : 'Apply selected details'} disabled={busy || (!append && !Object.values(selected).some(Boolean) && !Object.values(requestSelected).some(Boolean))} icon="check" onPress={() => finish(true)} />
      <Button label="Keep existing details" disabled={busy} kind="quiet" onPress={() => finish(false)} />
    </>}
  </Sheet>;
}

function Evidence({ text }: { text?: string }) {
  return <Txt selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{text ? `From transcript: “${text}”` : 'No clear suggestion. Check the transcript.'}</Txt>;
}

function Check({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} aria-checked={checked} onPress={onPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 36 }}>
    <View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: checked ? colors.green : colors.paper }}>{checked && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 16 }}>{label}</Txt>
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
    <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 24, color: job.state === 'failed' ? colors.danger : colors.green }}>{label}</Txt>
    {!!job.error && <Txt style={{ fontSize: 16, color: colors.muted }}>{job.error}</Txt>}
    <ErrorNotice message={error} />
    {job.state === 'complete' && <Button label={job.reviewedAt !== undefined ? 'View source text' : 'Review extracted text'} kind="secondary" onPress={() => setReviewing(true)} />}
    {job.state === 'failed' && available && <Button label="Retry processing" kind="secondary" onPress={async () => { try { await workspace.retryJob(job.id); } catch { setError('Could not queue the retry.'); } }} />}
    {reviewing && <ExtractionReview key={job.id} job={job} draft={draft} workspace={workspace} close={() => setReviewing(false)} />}
  </View>;
}
