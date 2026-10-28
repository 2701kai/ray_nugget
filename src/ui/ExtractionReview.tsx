import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Contact, Draft, RequestReview } from '../domain/draft';
import type { ProcessingJob } from '../processing/jobs';
import { changedDetails, reviewChanges } from '../processing/review';
import { requestCandidates } from '../processing/request';
import type { Workspace } from '../useWorkspace';
import { Button, Choice, ErrorNotice, Field, Sheet, Txt } from './primitives';
import { Icon } from './Icon';
import { colors } from './theme';

const labels: Record<keyof Contact, string> = { name: 'Name', company: 'Firma', email: 'E-Mail', phone: 'Mobilnummer' };

export function ExtractionReview({ job, draft, workspace, close }: { job: ProcessingJob; draft: Draft; workspace: Workspace; close: () => void }) {
  const [revision] = useState(draft.revision);
  const [changes] = useState(() => reviewChanges(draft, job).filter(change => !change.superseded));
  const [detailed, setDetailed] = useState(!changes.length);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Contact>({ ...draft.contact, ...job.result?.fields });
  const [selected, setSelected] = useState<Partial<Record<keyof Contact, boolean>>>(() => Object.fromEntries(
    (Object.keys(labels) as Array<keyof Contact>).map(field => [field, !!job.result?.fields[field] && ((!draft.contact[field] && !draft.provenance[`contact.${field}`]) || draft.provenance[`contact.${field}`]?.jobId === job.id)]),
  ));
  const [candidates] = useState(() => {
    if (job.kind !== 'voice') return {};
    if (!job.result?.request) return job.result?.evidence ? {} : requestCandidates(job.result?.text ?? '');
    const result = job.result;
    return {
      product: result.request?.product ? { value: result.request.product, evidence: result.evidence?.['request.product'] || '' } : undefined,
      packaging: result.request?.packaging ? { value: result.request.packaging, evidence: result.evidence?.['request.packaging'] || '' } : undefined,
      capacity: result.request?.capacity ? { value: result.request.capacity, evidence: result.evidence?.['request.throughput'] || '' } : undefined,
    };
  });
  const [intent, setIntent] = useState(job.result?.request?.intent ?? draft.request.intent);
  const [useIntent, setUseIntent] = useState(!!job.result?.request?.intent && (draft.request.intent === 'unspecified' && !draft.provenance['request.intent'] || draft.provenance['request.intent']?.jobId === job.id));
  const [request, setRequest] = useState(() => ({ ...draft.request,
    product: candidates.product?.value ?? draft.request.product,
    packaging: candidates.packaging?.value ?? draft.request.packaging,
    ...(candidates.capacity?.value ?? {}),
  }));
  const [requestSelected, setRequestSelected] = useState<Record<'product' | 'packaging' | 'capacity', boolean>>(() => {
    const untouched = (field: 'product' | 'packaging' | 'throughput' | 'unit') => (!draft.request[field] && !draft.provenance[`request.${field}`]) || draft.provenance[`request.${field}`]?.jobId === job.id;
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
        if (useIntent) reviewedRequest.intent = intent;
        if (requestSelected.product) reviewedRequest.product = request.product;
        if (requestSelected.packaging) reviewedRequest.packaging = request.packaging;
        if (requestSelected.capacity) reviewedRequest.capacity = { throughput: request.throughput, unit: request.unit };
      }
      await workspace.reviewJob(job.id, fields, revision, { appendTranscript: apply && append, request: Object.keys(reviewedRequest).length ? reviewedRequest : undefined }); close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Die Prüfung konnte nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  async function acceptChanges() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const patch = changedDetails(changes);
      await workspace.reviewJob(job.id, patch.fields, revision, { request: patch.request });
      close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Die Änderungen konnten nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  return <Sheet title={!detailed ? 'Änderungen prüfen' : job.kind === 'card' ? 'Kartenangaben prüfen' : 'Gespräch prüfen'} subtitle="Das Original bleibt diesem Besucher zugeordnet" locked={busy} onClose={close}>
    {!detailed ? <>
      <Txt>Deine Angaben bleiben erhalten, bis Du Änderungen bestätigst.</Txt>
      {changes.map(change => <View key={change.key} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, gap: 10 }}>
        <Txt weight="bold">{change.label}</Txt>
        <View style={{ gap: 3 }}><Txt style={{ fontSize: 16, color: colors.muted }}>Gespeichert</Txt><Txt selectable>{change.saved}</Txt></View>
        <View style={{ gap: 3 }}><Txt style={{ fontSize: 16, color: colors.green }}>Aus dieser Quelle: {job.kind === 'voice' ? 'Aufnahme' : 'Karte'}</Txt><Txt selectable weight="bold" style={{ fontSize: 20 }}>{change.proposed}</Txt></View>
        {!!change.evidence && <Txt selectable style={{ fontSize: 16, color: colors.muted }}>“{change.evidence}”</Txt>}
      </View>)}
      {!!job.result?.questions?.length && <View style={{ gap: 8 }}><Txt weight="semibold">Noch unklar</Txt>{job.result.questions.map((question, i) => <Txt key={i}>{question}</Txt>)}<Txt style={{ color: colors.muted }}>Du kannst anschließend eine weitere Sprachnotiz ergänzen.</Txt></View>}
      <ErrorNotice message={error} />
      <Button label={busy ? 'Änderungen werden gespeichert…' : changes.length === 1 ? 'Änderung übernehmen' : 'Änderungen übernehmen'} disabled={busy} icon="check" onPress={acceptChanges} />
      <Button label="Gespeicherte Angaben behalten" kind="secondary" disabled={busy} onPress={() => finish(false)} />
      <Button label="Quelle und Feldauswahl öffnen" kind="quiet" disabled={busy} onPress={() => setDetailed(true)} />
    </> : <>
    <Txt style={{ color: colors.muted, fontSize: 16 }}>Eindeutige Angaben sind bereits ergänzt. Hier kannst Du Abweichungen prüfen. Deine Korrekturen bleiben erhalten, bis Du etwas anderes auswählst.</Txt>
    <View style={{ backgroundColor: colors.pale, padding: 16, borderRadius: 12, gap: 8 }}>
      <Txt weight="semibold" style={{ fontSize: 16 }}>{job.kind === 'card' ? 'Text read from the card' : 'Transcript'}</Txt>
      <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{job.result?.text || 'Kein lesbarer Text gefunden. Nimm ein schärferes Foto auf oder sprich die Angaben ein.'}</Txt></ScrollView>
      {(job.result?.text.length ?? 0) > 600 && <Txt style={{ fontSize: 16, color: colors.muted }}>Scrolle im Quelltext, um weiterzulesen.</Txt>}
      <Txt style={{ color: colors.muted, fontSize: 16 }}>{job.result?.engine}</Txt>
    </View>
    {!!job.result?.text && <Button kind="quiet" label={copied ? 'Quelltext kopiert' : 'Quelltext kopieren'} icon="copy" onPress={async () => { try { await Clipboard.setStringAsync(job.result!.text); setCopied(true); } catch { setError('Der Text konnte nicht kopiert werden.'); } }} />}
    {job.reviewedAt !== undefined ? <Txt style={{ color: colors.green }}>Geprüft. Der Quelltext bleibt hier verfügbar.</Txt> : <>
      <Button label={editing ? 'Eingabefelder ausblenden' : 'Angaben manuell bearbeiten'} kind="quiet" onPress={() => setEditing(!editing)} />
      {!!job.result?.questions?.length && <View style={{ gap: 8 }}><Txt weight="semibold">Noch eine Rückfrage</Txt>{job.result.questions.map((question, i) => <Txt key={i}>{question}</Txt>)}<Txt style={{ color: colors.muted }}>Schließe diese Ansicht und ergänze eine Sprachnotiz. Tippen bleibt optional.</Txt></View>}
      {(Object.keys(labels) as Array<keyof Contact>).filter(field => editing || !!job.result?.fields[field]).map(field => <View key={field} style={{ gap: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 12 }}>
        <Check label={`${labels[field]} übernehmen`} checked={!!selected[field]} onPress={() => setSelected({ ...selected, [field]: !selected[field] })} />
        {!editing && <><Txt selectable style={{ fontSize: 20 }}>{job.result?.fields[field]}</Txt>{!!draft.provenance[`contact.${field}`] && draft.provenance[`contact.${field}`]?.jobId !== job.id && draft.contact[field] !== job.result?.fields[field] && <Txt style={{ color: colors.muted }}>Behalten: {draft.contact[field] || 'bewusst leer gelassen'}</Txt>}</>}
        {editing && <Field label={labels[field]} value={values[field]} onChangeText={value => { setValues({ ...values, [field]: value }); setSelected({ ...selected, [field]: true }); }} helper={draft.contact[field] ? `Aktuell: ${draft.contact[field]}` : undefined} />}
      </View>)}
      {job.kind === 'voice' && <View style={{ gap: 18, borderTopWidth: 1, borderColor: colors.line, paddingTop: 16 }}>
        <View style={{ gap: 4 }}><Txt weight="bold">Abfüllbedarf</Txt><Txt style={{ color: colors.muted, fontSize: 16 }}>Prüfe die Angaben am Gespräch. Ergänze Fehlendes per Sprachnotiz oder wähle hier einen anderen Wert.</Txt></View>
        {(editing || !!job.result?.request?.intent) && <View style={{ gap: 8 }}><Check label="Kauf- oder Verkaufsabsicht übernehmen" checked={useIntent} onPress={() => setUseIntent(!useIntent)} />{editing ? <Choice label="Kaufen oder verkaufen" value={intent} options={[{ value: 'buy', label: 'Kaufen' }, { value: 'sell', label: 'Verkaufen' }, { value: 'unspecified', label: 'Noch offen' }]} onChange={value => { setIntent(value); setUseIntent(true); }} /> : <Txt>{intent === 'buy' ? 'Kaufen' : intent === 'sell' ? 'Verkaufen' : 'Noch offen'}</Txt>}</View>}
        {(['product', 'packaging'] as const).filter(field => editing || !!candidates[field]).map(field => <View key={field} style={{ gap: 8 }}>
          <Check label={field === 'product' ? 'Produkt übernehmen' : 'Behälter / Verpackung übernehmen'} checked={requestSelected[field]} onPress={() => setRequestSelected({ ...requestSelected, [field]: !requestSelected[field] })} />
          {!editing && <Txt selectable style={{ fontSize: 20 }}>{request[field]}{draft.request[field] && draft.request[field] !== request[field] ? ` · Behalten: ${draft.request[field]}` : ''}</Txt>}
          {editing && <Field label={field === 'product' ? 'Abzufüllendes Produkt' : 'Behälter / Verpackung'} value={request[field]} onChangeText={value => { setRequest({ ...request, [field]: value }); setRequestSelected({ ...requestSelected, [field]: true }); }} helper={draft.request[field] ? `Aktuell: ${draft.request[field]}` : draft.provenance[`request.${field}`] ? 'Zuvor bewusst geleert. Wähle das Feld zum Ersetzen aus.' : undefined} />}
          <Evidence text={candidates[field]?.evidence} />
        </View>)}
        {(editing || !!candidates.capacity) && <View style={{ gap: 8 }}>
          <Check label="Durchsatz und Einheit übernehmen" checked={requestSelected.capacity} onPress={() => setRequestSelected({ ...requestSelected, capacity: !requestSelected.capacity })} />
          {!editing && <Txt selectable style={{ fontSize: 20 }}>{request.throughput} {request.unit}{draft.request.throughput && (draft.request.throughput !== request.throughput || draft.request.unit !== request.unit) ? ` · Behalten: ${draft.request.throughput} ${draft.request.unit}` : ''}</Txt>}
          {editing && <Field label="Benötigter Durchsatz" value={request.throughput} keyboardType="decimal-pad" onChangeText={throughput => { setRequest({ ...request, throughput }); setRequestSelected({ ...requestSelected, capacity: true }); }} helper={draft.request.throughput || draft.request.unit ? `Aktuell: ${draft.request.throughput || '—'} ${draft.request.unit}` : draft.provenance['request.throughput'] || draft.provenance['request.unit'] ? 'Zuvor bewusst geleert. Wähle das Feld zum Ersetzen aus.' : undefined} />}
          {editing && <Choice label="Einheit" value={request.unit} options={[{ value: '', label: 'Einheit wählen' }, { value: 'bottles/h', label: 'Flaschen / Stunde' }, { value: 'units/h', label: 'Einheiten / Stunde' }, { value: 'L/h', label: 'Liter / Stunde' }]} onChange={unit => { setRequest({ ...request, unit }); setRequestSelected({ ...requestSelected, capacity: true }); }} />}
          <Evidence text={candidates.capacity?.evidence} />
        </View>}
      </View>}
      {job.kind === 'voice' && !!job.result?.text && <Check label="Transkript zu den Gesprächsnotizen hinzufügen" checked={append} onPress={() => setAppend(!append)} />}
      <ErrorNotice message={error} />
      <Button label={busy ? 'Prüfung wird gespeichert…' : 'Ausgewählte Angaben übernehmen'} disabled={busy || (!append && !useIntent && !Object.values(selected).some(Boolean) && !Object.values(requestSelected).some(Boolean))} icon="check" onPress={() => finish(true)} />
      <Button label="Bisherige Angaben behalten" disabled={busy} kind="quiet" onPress={() => finish(false)} />
    </>}
    </>}
  </Sheet>;
}

function Evidence({ text }: { text?: string }) {
  return <Txt selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{text ? `Aus dem Transkript: “${text}”` : 'Kein eindeutiger Vorschlag. Prüfe das Transkript.'}</Txt>;
}

function Check({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} aria-checked={checked} onPress={onPress} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48 }}>
    <View style={{ width: 22, height: 22, borderWidth: 1, borderColor: colors.green, borderRadius: 5, backgroundColor: checked ? colors.green : colors.paper }}>{checked && <Icon name="check" size={20} color={colors.paper} />}</View><Txt style={{ flex: 1, fontSize: 16 }}>{label}</Txt>
  </Pressable>;
}

export function ProcessingStatus({ draft, attachmentId, workspace }: { draft: Draft; attachmentId: string; workspace: Workspace }) {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const job = workspace.jobs.find(task => task.draftId === draft.id && task.attachmentId === attachmentId);
  if (!job) return null;
  const available = workspace.supportedKinds.includes(job.kind);
  const changes = reviewChanges(draft, job);
  const conflicts = changes.some(change => !change.superseded);
  const superseded = changes.some(change => change.superseded);
  const filled = Object.values(draft.provenance).some(origin => origin.jobId === job.id);
  const label = job.state === 'complete' ? job.reviewedAt !== undefined ? 'Geprüft · Quelltext bleibt erhalten' : conflicts || job.result?.questions?.length ? 'Eine Angabe ist unklar · Deine Angaben bleiben erhalten' : superseded ? 'Frühere Angaben · neuerer Stand bleibt erhalten' : filled ? 'Angaben automatisch ergänzt' : 'Quelle gesichert · ergänze Details per Sprache'
    : !available ? job.kind === 'voice' ? 'Transkriptionsverbindung fehlt' : 'Kartenlesen ist in der Web-App verfügbar'
    : job.state === 'running' ? job.kind === 'voice' ? 'Sprache wird verarbeitet · Original gesichert' : 'Karte wird gelesen und ergänzt…'
    : job.state === 'failed' ? 'Verarbeitung pausiert · Du kannst sie erneut starten'
    : job.error ? 'Neuer Versuch folgt · Original gesichert' : 'Wartet auf Verarbeitung · Original gesichert';
  return <View style={{ gap: 6 }}>
    <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 24, color: job.state === 'failed' ? colors.danger : colors.green }}>{label}</Txt>
    {!!job.error && <Txt style={{ fontSize: 16, color: colors.muted }}>{job.error}</Txt>}
    <ErrorNotice message={error} />
    {job.state === 'complete' && <Button label={job.reviewedAt !== undefined ? 'Quelltext ansehen' : conflicts ? 'Änderungsvorschläge prüfen' : 'Erkannten Text prüfen'} kind={conflicts ? 'secondary' : 'quiet'} style={{ alignSelf: 'flex-start' }} onPress={() => setReviewing(true)} />}
    {job.state === 'failed' && available && <Button label="Verarbeitung wiederholen" kind="secondary" onPress={async () => { try { await workspace.retryJob(job.id); } catch { setError('Der neue Versuch konnte nicht gestartet werden.'); } }} />}
    {reviewing && <ExtractionReview key={job.id} job={job} draft={draft} workspace={workspace} close={() => setReviewing(false)} />}
  </View>;
}
