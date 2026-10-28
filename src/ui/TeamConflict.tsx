import { useState } from 'react';
import { View } from 'react-native';
import type { Workspace } from '../useWorkspace';
import { Button, Txt } from './primitives';
import { colors } from './theme';
import { useUpdateGuard } from '../pwa/updateGuard';
const labels: Record<string, string> = { 'contact.name': 'Name', 'contact.company': 'Company', 'contact.phone': 'Phone', 'contact.email': 'Email', 'request.intent': 'Buying / selling', 'request.product': 'Product', 'request.packaging': 'Container', 'request.throughput': 'Throughput and unit', note: 'Note', event: 'Event' };
export function TeamConflict({ id, workspace }: { id: string; workspace: Workspace }) {
  const state = workspace.teamView.states[id];
  useUpdateGuard(state?.state === 'conflict');
  const [choices, setChoices] = useState<Record<string, 'local' | 'team'>>({});
  if (state?.state !== 'conflict') return null;
  return <View style={{ padding: 14, backgroundColor: colors.pale, borderRadius: 12, gap: 12 }}>
    <Txt weight="bold">Review shared changes</Txt><Txt style={{ fontSize: 16 }}>{state.message}</Txt>
    {state.comparisons?.map(c => <View key={c.key} style={{ gap: 6 }}><Txt weight="bold" style={{ fontSize: 16 }}>{labels[c.key] || 'Source content'}</Txt><Txt style={{ fontSize: 16 }}>On your device: {c.local}</Txt><Txt style={{ fontSize: 16 }}>In the team: {c.team}</Txt><View style={{ flexDirection: 'row', gap: 8 }}><Button label="My version" kind={choices[c.key] === 'local' ? 'primary' : 'secondary'} onPress={() => setChoices(v => ({ ...v, [c.key]: 'local' }))} /><Button label="Team version" kind={choices[c.key] === 'team' ? 'primary' : 'secondary'} onPress={() => setChoices(v => ({ ...v, [c.key]: 'team' }))} /></View></View>)}
    <Button label="Merge selected details" disabled={!state.conflicts?.every(key => choices[key])} onPress={() => { void workspace.resolveTeam(id, choices); setChoices({}); }} />
  </View>;
}
