import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import type { CloudCopy } from '../cloud/saving';
import { Button, ErrorNotice, Txt } from './primitives';
import { colors } from './theme';

export function CloudStatus({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const team = workspace.teamView.links[draft.id];
  const shared = workspace.teamView.states[draft.id];
  if (team) return <View style={{ gap: 2 }}><Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, color: colors.green }}>{shared?.state === 'saved' && shared.revision === draft.revision ? 'Im Team gesichert' : shared?.state === 'conflict' ? 'Änderungen abstimmen' : shared?.state === 'error' ? 'Hier gesichert · Team-Sicherung wartet' : 'Hier gesichert · Teilen folgt'}</Txt>{shared?.state === 'error' && <Txt style={{ fontSize: 16, color: colors.muted }}>{shared.message}</Txt>}</View>;
  const status = workspace.cloudStates[draft.id];
  const current = status?.revision === draft.revision;
  const message = !workspace.cloudEnabled ? 'Auf diesem Gerät gesichert' : current && status?.state === 'saved' ? 'In Company Cloud gesichert' : status?.state === 'pending' ? 'Hier gesichert · Cloud folgt bei Verbindung' : status?.state === 'error' ? 'Hier gesichert · Cloud-Sicherung wartet' : 'Hier gesichert · Cloud-Sicherung läuft…';
  return <View style={{ gap: 2 }}><Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, color: colors.green }}>{message}</Txt>{status?.state === 'error' && <><Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>{status.message}</Txt><Button label="Cloud-Sicherung wiederholen" kind="quiet" onPress={workspace.retryCloud} style={{ alignSelf: 'flex-start' }} /></>}</View>;
}

export function CloudCopies({ workspace, done, lock }: { workspace: Workspace; done: () => void; lock: (value: boolean) => void }) {
  const [copies, setCopies] = useState<CloudCopy[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => { let live = true; setError(''); workspace.cloudCopies().then(value => { if (live) setCopies(value); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [retry]);
  return <>
    <Txt>Deine persönlichen Sicherungen mit Originalen. Beim Öffnen entsteht eine lokale Kopie. Gemeinsame Besucher findest Du direkt im Team-Bereich.</Txt>
    <ErrorNotice message={error} />
    {!!error && <Button label="Sicherungen neu laden" kind="quiet" onPress={() => setRetry(value => value + 1)} />}
    {!copies && !error && <Txt>Cloud-Sicherungen werden geladen…</Txt>}
    {copies?.length === 0 && <Txt>Noch keine persönlichen Sicherungen. Pete lädt automatisch hoch, solange es offen und online ist.</Txt>}
    {copies?.map(copy => <View key={copy.id} style={{ borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 8, gap: 4 }}><Txt weight="bold">{copy.title}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{copy.company} · {new Date(copy.savedAt).toLocaleString()}</Txt><Button label={busy === copy.id ? 'Cloud-Kopie wird geöffnet…' : `Cloud-Kopie öffnen: ${copy.title}`} kind="secondary" disabled={!!busy} onPress={async () => {
      if (busy) return; setBusy(copy.id); setError(''); lock(true);
      try { await workspace.restoreCloud(copy.id); done(); } catch (e) { setError(e instanceof Error ? e.message : 'Die Cloud-Kopie konnte nicht geöffnet werden.'); } finally { setBusy(undefined); lock(false); }
    }} /></View>)}
  </>;
}
