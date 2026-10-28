import { useState } from 'react';
import { View } from 'react-native';
import type { Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { useUpdateGuard } from '../pwa/updateGuard';
import { Button, ErrorNotice, Txt } from './primitives';
import { colors } from './theme';

export function LeadHandoff({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const [choosing, setChoosing] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useUpdateGuard(choosing !== undefined || busy);
  const link = workspace.teamView.links[draft.id];
  const team = workspace.teamView.teams.find(t => t.id === link?.teamId);
  const copy = workspace.teamView.copies.find(c => c.draftId === draft.id && c.teamId === link?.teamId);
  const lead = copy?.lead;
  if (!team) return null;
  const sync = workspace.teamView.states[draft.id];
  const current = lead && sync?.state === 'saved' && sync.revision === draft.revision && lead.sourceFingerprint === copy.fingerprint && link.fingerprint === copy.fingerprint;
  async function assign(email: string) {
    if (choosing === undefined || busy) return;
    setBusy(true); setError('');
    try { await workspace.assignLeadOwner(draft.id, email, choosing); setChoosing(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : 'The lead owner could not be changed.'); setChoosing(undefined); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 8, paddingTop: 16, borderTopWidth: 1, borderColor: colors.line }}>
    <Txt weight="bold" style={{ fontSize: 16 }}>Lead handoff</Txt>
    <Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, color: colors.green }}>{current ? 'Received by Pete' : lead ? 'Latest changes waiting to sync' : 'Captured details will be received automatically'}</Txt>
    <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>CRM transfer is not connected yet.</Txt>
    {lead && <>
      <Txt selectable style={{ fontSize: 16 }}>Lead owner: {lead.ownerEmail}</Txt>
      <Txt style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>Last received {new Date(lead.receivedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</Txt>
      {choosing === undefined ? <Button label="Change lead owner" kind="quiet" style={{ alignSelf: 'flex-start' }} disabled={busy} onPress={() => { setError(''); setChoosing(lead.ownerVersion); }} /> : <View style={{ gap: 4 }}>
        {team.members.map(email => <Button key={email} label={email} accessibilityLabel={`Assign lead to ${email}`} kind={email === lead.ownerEmail ? 'secondary' : 'quiet'} disabled={busy} onPress={() => { void assign(email); }} />)}
        <Button label={busy ? 'Saving owner…' : 'Cancel owner change'} kind="quiet" disabled={busy} onPress={() => setChoosing(undefined)} />
      </View>}
      <ErrorNotice message={error} />
    </>}
  </View>;
}
