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

export function RayAssistant({ draft, workspace, speak, recorderOpen = false }: { draft: Draft; workspace: Workspace; speak: () => void; recorderOpen?: boolean }) {
  const [closed, setClosed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fingerprint, setFingerprint] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreQuestions, setMoreQuestions] = useState(false);
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
  const visibleQuestions = moreQuestions ? questions : questions.slice(0, 1);
  const reviewJob = workspace.jobs.find(j => j.id === reviewJobId && j.draftId === draft.id);
  const conflictJob = workspace.jobs.filter(j => j.draftId === draft.id && j.state === 'complete' && j.reviewedAt === undefined && (reviewChanges(draft, j).some(c => !c.superseded) || j.result?.questions?.length)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const summary = latest?.text.split(/\n\s*\n/).find(p => !p.includes('?')) ?? '';
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
  const seen = new Set(latest?.machines.map(m => m.sku));
  const earlier = history.slice(1).flatMap(a => a.machines.flatMap(m => {
    if (seen.has(m.sku)) return [];
    seen.add(m.sku); return [{ ...m, advice: a }];
  })).slice(0, 3);
  const stop = () => workspace.stopRay(draft.id);
  const run = () => { setClosed(false); setExpanded(false); void workspace.askRay(draft.id); };
  async function select(sku: string, advice = latest) {
    if (!advice || saving) return;
    setSaving(true); setError('');
    try { await workspace.update(draft.id, { type: 'raySelect', consultationId: advice.id, sku, selected: !advice.selectedSkus.includes(sku) }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this choice.'); }
    finally { setSaving(false); }
  }
  const open = (url: string) => { void Linking.openURL(url).catch(() => setError('The listing could not be opened. Try again when online.')); };
  if (closed) return <View testID="ray-closed" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><Txt style={{ fontSize: 16, color: colors.muted }}>Ray closed · saved advice kept</Txt><Button label="Open Ray" kind="quiet" onPress={() => setClosed(false)} /></View>;
  return <View testID="ray-assistant" style={{ backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, gap: 10 }}>
    <View style={{ flexDirection: width < 360 ? 'column' : 'row', alignItems: width < 360 ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flex: width < 360 ? undefined : 1 }}><Txt weight="bold" style={{ fontSize: 18 }}>Ray · Machine search</Txt><Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>{seller ? 'Seller lead saved for the team.' : `For ${titleOf(draft)}`}</Txt></View>
      {!seller && workspace.rayAvailable && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {enabled || state?.busy ? <Button label="Stop Ray" kind="secondary" onPress={stop} /> : <Button label="Find machines" disabled={!hasNeed} kind="secondary" onPress={run} style={{ paddingHorizontal: 10 }} />}
        <Button label="" accessibilityLabel="Close Ray" icon="close" kind="quiet" onPress={() => { stop(); setClosed(true); }} style={{ width: 44, paddingHorizontal: 0 }} />
      </View>}
    </View>
    {!hasNeed && !seller && <Txt style={{ fontSize: 16, color: colors.muted }}>Add the equipment need by voice or note first.</Txt>}
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      {state?.busy && <ActivityIndicator size="small" color={colors.green} />}
      <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, color: colors.green, flex: 1 }}>{state?.busy ? `Checking machines for ${titleOf(draft)}${elapsed ? ` · ${elapsed}s` : '…'}` : enabled ? blocked === 'processing' ? 'Processing your saved answer…' : blocked === 'failed' ? 'Recording saved · retry processing to continue' : blocked === 'review' ? 'One conflicting detail needs checking' : 'Ready · saved answers update the search' : 'Ray is stopped'}</Txt>
    </View>
    <Txt style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{recorderOpen ? 'Voice recorder open below. Save the answer to attach it to this visitor.' : 'Microphone off · Ray uses this visitor’s saved details.'}</Txt>
    {enabled && blocked === 'review' && conflictJob && <Button label="Check this detail" kind="secondary" onPress={() => setReviewJobId(conflictJob.id)} />}
    {reviewJob && <ExtractionReview key={reviewJob.id} job={reviewJob} draft={draft} workspace={workspace} close={() => setReviewJobId(undefined)} />}
    <ErrorNotice message={state?.error || error} />
    {latest && <>
      <Txt accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.muted }}>{stale ? enabled ? 'Earlier advice · new details will update the search' : 'Earlier advice · Find machines to include new details' : `Advice saved · ${new Date(latest.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}</Txt>
      <Txt weight="semibold" style={{ fontSize: 17 }}>{latest.machines.length ? 'Machines in Ray’s assessment' : 'No verified listing in this reply'}</Txt>
      {!latest.machines.length && <Txt style={{ fontSize: 16, lineHeight: 23, color: colors.muted }}>Your request and earlier options are kept. Ray’s assessment below explains the next step.</Txt>}
      {!!latest.machines.length && <Txt style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>Listings may include alternatives Ray ruled out. Read the assessment for suitability and gaps.</Txt>}
      {[...latest.machines.map(m => ({ ...m, advice: latest })), ...earlier].map(m => <View key={m.sku} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, gap: 5 }}>
        {m.advice.id !== latest.id && <Txt style={{ fontSize: 14, color: colors.muted }}>Earlier candidate · not rechecked for the latest details</Txt>}
        <Txt weight="bold" style={{ fontSize: 16, lineHeight: 23 }}>{m.title}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{m.manufacturer} · {m.sku}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="View listing" kind="quiet" onPress={() => open(m.url)} /><Button label={m.advice.selectedSkus.includes(m.sku) ? 'Saved for visitor ✓' : 'Save for visitor'} kind="secondary" disabled={saving} onPress={() => { void select(m.sku, m.advice); }} /></View>
      </View>)}
      {!!visibleQuestions.length && <View style={{ backgroundColor: colors.pale, padding: 12, borderRadius: 8, gap: 8 }}><Txt weight="bold" style={{ fontSize: 16 }}>To refine the match</Txt>{visibleQuestions.map(q => <View key={q} style={{ gap: 6 }}><Txt style={{ fontSize: 18, lineHeight: 26 }}>{q}</Txt><Button label="Not known yet" kind="quiet" disabled={saving} onPress={() => { void decide(q, true); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /></View>)}{questions.length > 1 && <Button label={moreQuestions ? 'Show priority question' : `${questions.length - 1} more question${questions.length > 2 ? 's' : ''}`} kind="quiet" onPress={() => setMoreQuestions(!moreQuestions)} />}</View>}
      {!!summary && <Txt selectable style={{ fontSize: 16, lineHeight: 24 }} numberOfLines={6}>{summary}</Txt>}
      {!seller && <Button label="Answer by voice" icon="mic" kind="secondary" onPress={speak} style={{ alignSelf: 'flex-start' }} />}
      <Button label={expanded ? 'Less advice' : 'Read full advice'} kind="quiet" onPress={() => setExpanded(!expanded)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
      {expanded && <Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{latest.text}</Txt>}
      {!!latest.omitted && <Txt style={{ fontSize: 16, color: colors.muted }}>Ray used selected excerpts; {latest.omitted} longer or additional excerpts stayed in Pete. Add a short summary if something important is missing.</Txt>}
      {!!latest.pending && <Txt style={{ fontSize: 16, color: colors.muted }}>{latest.pending} recording(s) were still awaiting text when you asked.</Txt>}
      {!!deferred.length && <View style={{ gap: 6 }}><Button label={showDeferred ? 'Hide questions for later' : `${deferred.length} question${deferred.length > 1 ? 's' : ''} for later`} kind="quiet" onPress={() => setShowDeferred(!showDeferred)} />{showDeferred && deferred.map(q => <View key={q}><Txt style={{ fontSize: 16 }}>{q}</Txt><Button label="Revisit question" kind="quiet" disabled={saving} onPress={() => { const origin = [...(draft.rayQuestions ?? [])].reverse().find(d => d.question === q); void decide(q, false, origin?.consultationId); }} /></View>)}</View>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{enabled && <Button label="Refresh advice" kind="quiet" disabled={state?.busy} onPress={() => { run(); }} />}<Button label={briefOpen ? 'Hide request sent' : 'Request sent to Ray'} kind="quiet" onPress={() => setBriefOpen(!briefOpen)} />{history.length > 1 && <Button label={historyOpen ? 'Hide earlier advice' : `Earlier advice (${history.length - 1})`} kind="quiet" onPress={() => setHistoryOpen(!historyOpen)} />}</View>
      {briefOpen && <Txt selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{latest.brief}</Txt>}
      {historyOpen && history.slice(1).map(a => <View key={a.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, gap: 5 }}><Txt weight="semibold" style={{ fontSize: 16 }}>Earlier advice · {new Date(a.createdAt).toLocaleString('en-US')}</Txt><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{a.text}</Txt></View>)}
      {selected.filter(m => m.consultation !== latest.id && !earlier.some(e => e.sku === m.sku && e.advice.id === m.consultation)).map(m => <View key={`${m.consultation}/${m.sku}`}><Txt style={{ fontSize: 16 }}>Previously saved: {m.title}</Txt><Button label={`Open ${m.sku}`} kind="quiet" onPress={() => open(m.url)} /></View>)}
    </>}
  </View>;
}
