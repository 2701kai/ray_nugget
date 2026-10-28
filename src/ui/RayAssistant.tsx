import { useEffect, useState } from 'react';
import { Linking, View, useWindowDimensions } from 'react-native';
import type { Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { raySource } from '../ray/brief';
import { digest } from '../backup/digest';
import { Button, ErrorNotice, Txt } from './primitives';
import { colors } from './theme';
import { useUpdateGuard } from '../pwa/updateGuard';

export function RayAssistant({ draft, workspace, speak }: { draft: Draft; workspace: Workspace; speak: () => void }) {
  const [fingerprint, setFingerprint] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { width } = useWindowDimensions();
  useUpdateGuard(saving);
  const source = raySource(draft, workspace.jobs);
  useEffect(() => { let alive = true; setFingerprint(''); void digest(new TextEncoder().encode(source)).then(value => { if (alive) setFingerprint(value); }).catch(() => {}); return () => { alive = false; }; }, [source]);
  const history = [...(draft.ray ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = history[0];
  const state = workspace.rayStates[draft.id];
  const stale = !!latest && fingerprint !== latest.sourceFingerprint;
  if (!workspace.rayAvailable && !latest) return null;
  const seller = draft.request.intent === 'sell';
  const hasNeed = !!(draft.request.product || draft.request.packaging || draft.request.throughput || draft.note || draft.entries?.length || draft.attachments.some(a => a.kind === 'voice'));
  const selected = history.flatMap(a => a.machines.filter(m => a.selectedSkus.includes(m.sku)).map(m => ({ ...m, consultation: a.id })));
  async function select(sku: string) {
    if (!latest || saving) return;
    setSaving(true); setError('');
    try { await workspace.update(draft.id, { type: 'raySelect', consultationId: latest.id, sku, selected: !latest.selectedSkus.includes(sku) }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save this choice.'); }
    finally { setSaving(false); }
  }
  const open = (url: string) => { void Linking.openURL(url).catch(() => setError('The listing could not be opened. Try again when online.')); };
  return <View testID="ray-assistant" style={{ backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, gap: 10 }}>
    <View style={{ flexDirection: width < 360 ? 'column' : 'row', alignItems: width < 360 ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 8 }}>
      <View style={{ flex: width < 360 ? undefined : 1 }}><Txt weight="bold" style={{ fontSize: 18 }}>Ray · Equipment help</Txt><Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>{seller ? 'Seller lead saved for the team.' : 'Use what you’ve captured. No retyping.'}</Txt></View>
      {!seller && workspace.rayAvailable && <Button label={state?.busy ? 'Asking…' : latest ? 'Ask Ray again' : 'Ask Ray'} disabled={state?.busy || !hasNeed} kind="secondary" onPress={() => { setExpanded(false); void workspace.askRay(draft.id); }} style={{ paddingHorizontal: 10 }} />}
    </View>
    {!hasNeed && !seller && <Txt style={{ fontSize: 16, color: colors.muted }}>Add the equipment need by voice or note first.</Txt>}
    {state?.busy && <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, color: colors.green }}>Ray is checking the request. You can keep capturing or open another visitor.</Txt>}
    <ErrorNotice message={state?.error || error} />
    {latest && <>
      <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, color: stale ? colors.danger : colors.muted }}>{stale ? 'New details added · ask Ray again to update this advice.' : `Advice saved · ${new Date(latest.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}</Txt>
      {!!latest.questions.length && <View style={{ backgroundColor: colors.pale, padding: 10, borderRadius: 8, gap: 5 }}><Txt weight="bold" style={{ fontSize: 16 }}>Ask next</Txt>{latest.questions.map((q, i) => <Txt key={i} style={{ fontSize: 16, lineHeight: 24 }}>{q}</Txt>)}</View>}
      <Txt selectable style={{ fontSize: 16, lineHeight: 24 }} numberOfLines={expanded ? undefined : 8}>{latest.text}</Txt>
      {latest.text.length > 350 && <Button label={expanded ? 'Less advice' : 'Read full advice'} kind="quiet" onPress={() => setExpanded(!expanded)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
      {!seller && <Button label="Answer by voice" icon="mic" kind="quiet" onPress={speak} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
      {!!latest.machines.length && <Txt weight="semibold" style={{ fontSize: 16 }}>Possible machines · fit and availability to confirm</Txt>}
      {latest.machines.map(m => <View key={m.sku} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, gap: 5 }}>
        <Txt weight="bold" style={{ fontSize: 16, lineHeight: 23 }}>{m.title}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{m.manufacturer} · {m.sku}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label="View listing" kind="quiet" onPress={() => open(m.url)} /><Button label={latest.selectedSkus.includes(m.sku) ? 'Saved for visitor ✓' : 'Save for visitor'} kind="secondary" disabled={saving} onPress={() => { void select(m.sku); }} /></View>
      </View>)}
      {!!latest.omitted && <Txt style={{ fontSize: 16, color: colors.muted }}>Ray used selected excerpts; {latest.omitted} longer or additional excerpts stayed in Pete. Add a short summary if something important is missing.</Txt>}
      {!!latest.pending && <Txt style={{ fontSize: 16, color: colors.muted }}>{latest.pending} recording(s) were still awaiting text when you asked.</Txt>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button label={briefOpen ? 'Hide request sent' : 'Request sent to Ray'} kind="quiet" onPress={() => setBriefOpen(!briefOpen)} />{history.length > 1 && <Button label={historyOpen ? 'Hide earlier advice' : `Earlier advice (${history.length - 1})`} kind="quiet" onPress={() => setHistoryOpen(!historyOpen)} />}</View>
      {briefOpen && <Txt selectable style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{latest.brief}</Txt>}
      {historyOpen && history.slice(1).map(a => <View key={a.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, gap: 5 }}><Txt weight="semibold" style={{ fontSize: 16 }}>Earlier advice · {new Date(a.createdAt).toLocaleString('en-US')}</Txt><Txt selectable style={{ fontSize: 16, lineHeight: 24 }}>{a.text}</Txt></View>)}
      {selected.filter(m => m.consultation !== latest.id).map(m => <View key={`${m.consultation}/${m.sku}`}><Txt style={{ fontSize: 16 }}>Previously saved: {m.title}</Txt><Button label={`Open ${m.sku}`} kind="quiet" onPress={() => open(m.url)} /></View>)}
    </>}
  </View>;
}
