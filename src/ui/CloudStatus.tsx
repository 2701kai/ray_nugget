import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import type { CloudCopy } from '../cloud/saving';
import { Button, ErrorNotice, Txt } from './primitives';
import { colors } from './theme';

export function CloudStatus({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const status = workspace.cloudStates[draft.id];
  const current = status?.revision === draft.revision;
  const message = !workspace.cloudEnabled ? 'Saved on this device' : current && status?.state === 'saved' ? 'Saved to company cloud' : status?.state === 'pending' ? 'Saved here · cloud when online' : status?.state === 'error' ? 'Saved here · cloud retry pending' : 'Saved here · saving to cloud…';
  return <View style={{ gap: 2 }}><Txt accessibilityLiveRegion="polite" style={{ fontSize: 16, lineHeight: 22, color: colors.green }}>{message}</Txt>{status?.state === 'error' && <><Txt style={{ fontSize: 16, lineHeight: 22, color: colors.muted }}>{status.message}</Txt><Button label="Retry cloud saving" kind="quiet" onPress={workspace.retryCloud} style={{ alignSelf: 'flex-start' }} /></>}</View>;
}

export function CloudCopies({ workspace, done, lock }: { workspace: Workspace; done: () => void; lock: (value: boolean) => void }) {
  const [copies, setCopies] = useState<CloudCopy[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => { let live = true; setError(''); workspace.cloudCopies().then(value => { if (live) setCopies(value); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [retry]);
  return <>
    <Txt>Visitors and originals saved automatically to your company account. Open a copy on this device; existing drafts stay intact.</Txt>
    <ErrorNotice message={error} />
    {!!error && <Button label="Reload cloud visitors" kind="quiet" onPress={() => setRetry(value => value + 1)} />}
    {!copies && !error && <Txt>Loading cloud visitors…</Txt>}
    {copies?.length === 0 && <Txt>No cloud visitors yet. Your local captures upload automatically while Pete is open and online.</Txt>}
    {copies?.map(copy => <View key={copy.id} style={{ borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 8, gap: 4 }}><Txt weight="bold">{copy.title}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{copy.company} · {new Date(copy.savedAt).toLocaleString()}</Txt><Button label={busy === copy.id ? 'Opening cloud copy…' : `Open cloud copy of ${copy.title}`} kind="secondary" disabled={!!busy} onPress={async () => {
      if (busy) return; setBusy(copy.id); setError(''); lock(true);
      try { await workspace.restoreCloud(copy.id); done(); } catch (e) { setError(e instanceof Error ? e.message : 'Cloud copy could not be opened.'); } finally { setBusy(undefined); lock(false); }
    }} /></View>)}
  </>;
}
