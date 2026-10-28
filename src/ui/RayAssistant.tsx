import { deferredQuestions } from '../domain/requirements';
import { continuationBlock } from '../ray/continuation';
import { reviewChanges } from '../processing/review';
import { ExtractionReview } from './ExtractionReview';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, View, useWindowDimensions } from 'react-native';
import { titleOf, type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { raySource } from '../ray/brief';
import { digest } from '../backup/digest';
import { Button, ErrorNotice, Txt } from './primitives';
import { colors } from './theme';
import { useUpdateGuard } from '../pwa/updateGuard';

export function RayAssistant({ draft, workspace, speak, recorderMode }: { draft: Draft; workspace: Workspace; speak: (questions: string[]) => void; recorderMode?: 'memo' | 'conversation' }) {
  const [closed, setClosed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fingerprint, setFingerprint] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreQuestions, setMoreQuestions] = useState(false);
  const [chosenQuestion, setChosenQuestion] = useState<{ adviceId: string; question: string }>();
  const [showDeferred, setShowDeferred] = useState(false);
  const [reviewJobId, setReviewJobId] = useState<string>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { width } = useWindowDimensions();
  useUpdateGuard(saving);
  const source = raySource(draft, workspace.jobs);
  useEffect(() => { let alive = true; setFingerprint(''); void digest(new TextEncoder().encode(source)).then(value => { if (alive) setFingerprint(value); }).catch(() => {}); return () => { alive = false; }; }, [source]);
  const history = [...(draft.ray ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = history[0];
  const state = workspace.rayStates[draft.id];
  useEffect(() => {
    setElapsed(0);
    if (state?.busy) setClosed(false);
    if (!state?.busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state?.busy]);
  const stale = !!latest && !!fingerprint && fingerprint !== latest.sourceFingerprint;
  const enabled = !!workspace.rayEnabled[draft.id];
  const blocked = continuationBlock(draft, workspace.jobs);
  const deferred = deferredQuestions(draft.rayQuestions);
  const questions = latest?.questions.filter(q => !deferred.includes(q)) ?? [];
  const question = chosenQuestion && chosenQuestion.adviceId === latest?.id && questions.includes(chosenQuestion.question) ? chosenQuestion.question : questions[0];
  const reviewJob = workspace.jobs.find(j => j.id === reviewJobId && j.draftId === draft.id);
  const conflictJob = workspace.jobs.filter(j => j.draftId === draft.id && j.state === 'complete' && j.reviewedAt === undefined && (reviewChanges(draft, j).some(c => !c.superseded) || j.result?.questions?.length)).sort((a, b) => b.createdAt - a.createdAt)[0];
  async function decide(question: string, deferred: boolean, consultationId = latest?.id) {
    if (!consultationId || saving) return;
    setSaving(true); setError('');
    try { await workspace.decideRayQuestion(draft.id, consultationId, question, deferred); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this choice.'); }
    finally { setSaving(false); }
  }
  if (!workspace.rayAvailable && !latest) return null;
  const seller = draft.request.intent === 'sell';
  const hasNeed = !!(draft.request.product || draft.request.packaging || draft.request.throughput || draft.note || draft.entries?.length || draft.attachments.some(a => a.kind === 'voice'));
  const selected = history.flatMap(a => a.machines.filter(m => a.selectedSkus.includes(m.sku)).map(m => ({ ...m, consultation: a.id })));
  async function select(sku: string, advice = latest) {
    if (!advice || saving) return;
    setSaving(true); setError('');
    try { await workspace.update(draft.id, { type: 'raySelect', consultationId: advice.id, sku, selected: !advice.selectedSkus.includes(sku) }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this choice.'); }
    finally { setSaving(false); }
  }
  const open = (url: string) => { void Linking.openURL(url).catch(() => setError('The listing could not be opened. Try again when online.')); };
  const activity = state?.busy ? `Asking Ray for ${titleOf(draft)}${elapsed ? ` · ${elapsed}s` : '…'}`
    : state?.canceled ? 'Request canceled · your visitor stays saved'
    : enabled && blocked === 'processing' ? 'Processing saved recording…'
    : enabled && blocked === 'failed' ? 'Recording saved · retry processing to update advice'
    : enabled && blocked === 'review' ? 'A captured detail needs checking'
    : latest ? stale ? enabled ? 'Earlier advice · new details will update it automatically' : 'Earlier advice · Ask Ray to include new details'
    : `Advice saved · ${new Date(latest.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : '';
  const automatic = enabled ? 'Automatic updates on' : 'Automatic updates paused';
  const machineCards = (advice: NonNullable<typeof latest>) => advice.machines.map(m => <View key={m.sku} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, gap: 5 }}>
    <Txt weight="bold" style={{ fontSize: 16, lineHeight: 23 }}>{m.title}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{m.manufacturer} · {m.sku}</Txt>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="View listing" kind="quiet" onPress={() => open(m.url)} /><Button label={advice.selectedSkus.includes(m.sku) ? 'Saved for visitor ✓' : 'Save for visitor'} kind="secondary" disabled={saving} onPress={() => { void select(m.sku, advice); }} /></View>
  </View>);
  if (closed) return <View testID="ray-closed" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><View style={{ flex: 1 }}><Txt style={{ fontSize: 16 }}>Ray’s advice</Txt>{!!activity && <Txt style={{ fontSize: 14, color: colors.muted }}>{activity}</Txt>}{(enabled || latest) && <Txt style={{ fontSize: 14, color: colors.muted }}>{automatic}</Txt>}</View><Button label="Show Ray" kind="quiet" onPress={() => setClosed(false)} /></View>;
  return <View testID="ray-assistant" style={{ backgroundColor: colors.pale, borderLeftWidth: 3, borderColor: colors.green, borderRadius: 8, padding: 18, gap: 10 }}>
    <View style={{ flexDirection: width < 360 ? 'column' : 'row', alignItems: width < 360 ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flex: width < 360 ? undefined : 1 }}><Txt weight="bold" style={{ fontSize: 18 }}>Ray’s advice</Txt>{seller && <Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>Seller lead saved for the team.</Txt>}</View>
      {!seller && workspace.rayAvailable && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>

        <Button label="" accessibilityLabel="Hide Ray" icon="close" kind="quiet" onPress={() => setClosed(true)} style={{ width: 44, paddingHorizontal: 0 }} />
      </View>}
    </View>
    {!hasNeed && !seller && <Txt style={{ fontSize: 16, color: colors.muted }}>Add the equipment need by voice or note first.</Txt>}
    {!!activity && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      {state?.busy && <ActivityIndicator size="small" color={colors.green} />}
      <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, color: colors.green, flex: 1 }}>{activity}</Txt>
      {state?.busy && <Button label="Cancel request" kind="quiet" onPress={() => workspace.stopRay(draft.id)} />}
    </View>}
    {recorderMode && <Txt style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{recorderMode === 'conversation' ? 'Conversation recorder open below. Ray uses the recording after you save it.' : 'Voice recorder open below. Ray uses the recording after you save it.'}</Txt>}
    {(enabled || latest) && !seller && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}><Txt style={{ fontSize: 14, color: colors.muted }}>{automatic}</Txt>{enabled && <Button label="Pause" accessibilityLabel="Pause automatic updates" kind="quiet" onPress={() => workspace.pauseRay(draft.id)} />}</View>}
    {enabled && blocked === 'review' && conflictJob && <Button label="Check this detail" kind="secondary" onPress={() => setReviewJobId(conflictJob.id)} />}
    {reviewJob && <ExtractionReview key={reviewJob.id} job={reviewJob} draft={draft} workspace={workspace} close={() => setReviewJobId(undefined)} />}
    <ErrorNotice message={state?.error || error} />
    {latest && <>
      <Txt testID="ray-advice-text" selectable style={{ fontSize: 16, lineHeight: 24 }}>{latest.text}</Txt>
      {!!question && <View style={{ backgroundColor: colors.pale, padding: 12, borderRadius: 8, gap: 8 }}>{!latest.text.includes(question) && <><Txt weight="bold" style={{ fontSize: 16 }}>Next question</Txt><Txt style={{ fontSize: 18, lineHeight: 26 }}>{question}</Txt></>}<Button label="Not known yet" kind="quiet" disabled={saving} onPress={() => { void decide(question, true); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />{questions.length > 1 && <Button label={moreQuestions ? 'Hide other questions' : `${questions.length - 1} more question${questions.length > 2 ? 's' : ''}`} kind="quiet" onPress={() => setMoreQuestions(!moreQuestions)} />}{moreQuestions && questions.filter(q => q !== question).map(q => <Button key={q} label={q} kind="quiet" onPress={() => { setChosenQuestion({ adviceId: latest.id, question: q }); setMoreQuestions(false); }} />)}</View>}
      {!seller && <Button label="Answer by voice" disabled={workspace.sourceEditing} icon="mic" kind="secondary" onPress={() => speak(question ? [question] : [])} style={{ alignSelf: 'flex-start' }} />}
      {!!latest.machines.length && <><Txt weight="semibold" style={{ fontSize: 16 }}>Listings referenced in this advice</Txt><Txt style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>Ray’s assessment above explains suitability and may rule out a listing.</Txt>{machineCards(latest)}</>}
      {!!latest.omitted && <Txt style={{ fontSize: 16, color: colors.muted }}>Ray used selected excerpts; {latest.omitted} longer or additional excerpts stayed in Pete. Add a short summary if something important is missing.</Txt>}
      {!!latest.pending && <Txt style={{ fontSize: 16, color: colors.muted }}>{latest.pending} recording(s) were still awaiting text when you asked.</Txt>}
      {!!deferred.length && <View style={{ gap: 6 }}><Button label={showDeferred ? 'Hide questions for later' : `${deferred.length} question${deferred.length > 1 ? 's' : ''} for later`} kind="quiet" onPress={() => setShowDeferred(!showDeferred)} />{showDeferred && deferred.map(q => <View key={q}><Txt style={{ fontSize: 16 }}>{q}</Txt><Button label="Revisit question" kind="quiet" disabled={saving} onPress={() => { const origin = [...(draft.rayQuestions ?? [])].reverse().find(d => d.question === q); void decide(q, false, origin?.consultationId); }} /></View>)}</View>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label={briefOpen ? 'Hide request sent' : 'Request sent to Ray'} kind="quiet" onPress={() => setBriefOpen(!briefOpen)} />{history.length > 1 && <Button label={historyOpen ? 'Hide earlier advice' : `Earlier advice (${history.length - 1})`} kind="quiet" onPress={() => setHistoryOpen(!historyOpen)} />}</View>
      {briefOpen && <Txt selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{latest.brief}</Txt>}
      {historyOpen && history.slice(1).map(a => <View key={a.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, gap: 5 }}><Txt weight="semibold" style={{ fontSize: 16 }}>Earlier advice · {new Date(a.createdAt).toLocaleString('en-US')}</Txt><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{a.text}</Txt>{!!a.machines.length && <Txt style={{ fontSize: 14, color: colors.muted }}>Listings referenced in this earlier advice · review against the latest requirements.</Txt>}{machineCards(a)}</View>)}
      {!historyOpen && selected.filter(m => m.consultation !== latest.id).map(m => <View key={`${m.consultation}/${m.sku}`}><Txt style={{ fontSize: 16 }}>Previously saved: {m.title}</Txt><Txt style={{ fontSize: 14, color: colors.muted }}>Saved with earlier advice · review against the latest requirements.</Txt><Button label={`Open ${m.sku}`} kind="quiet" onPress={() => open(m.url)} /></View>)}
    </>}
  </View>;
}
