import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { decodeBackup, MAX_BACKUP_BYTES, type VerifiedBackup } from '../backup/archive';
import { digest } from '../backup/digest';
import { titleOf, type Draft } from '../domain/draft';
import { pickBackup, saveBackup } from '../media/files';
import type { Workspace } from '../useWorkspace';
import { Button, ErrorNotice, Txt } from './primitives';
import { colors } from './theme';

function Contents({ draft }: { draft: Draft }) {
  const cards = draft.attachments.filter(a => a.kind === 'card').length;
  const recordings = draft.attachments.filter(a => a.kind === 'voice').length;
  const size = draft.attachments.reduce((sum, a) => sum + a.bytes, 0) / 1024 / 1024;
  return <View style={{ padding: 16, backgroundColor: colors.pale, borderRadius: 12, gap: 6 }}>
    <Txt weight="bold">{titleOf(draft)}</Txt>
    {!!draft.event && <Txt style={{ color: colors.muted, fontSize: 16 }}>{draft.event}</Txt>}
    <Txt style={{ fontSize: 16 }}>Card photos: {cards} · Recordings: {recordings} · {size < 0.1 ? '< 0.1' : size.toFixed(1)} MiB of originals</Txt>
    <Txt style={{ fontSize: 16, color: colors.muted }}>Includes contact details, request, notes, transcripts, and original files.</Txt>
  </View>;
}

export function SaveBackup({ draft, workspace, lock }: { draft: Draft; workspace: Workspace; lock: (locked: boolean) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const running = useRef(false);
  async function save() {
    if (running.current) return;
    running.current = true; setBusy(true); lock(true); setError(''); setSaved(false);
    try {
      await saveBackup(`pete-backup-${draft.id.slice(0, 12)}.pete`, await workspace.backup(draft.id));
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not create the backup.'); }
    finally { running.current = false; setBusy(false); lock(false); }
  }
  return <>
    <Contents draft={draft} />
    <Txt style={{ color: colors.muted, fontSize: 16 }}>Save this backup in your company’s file storage. It contains customer details and recordings and is not encrypted. This optional file is separate from automatic cloud saving.</Txt>
    <Txt style={{ color: colors.muted, fontSize: 16 }}>To recover it on another device, sign in to Pete and choose Restore a backup. Up to 128 MiB per draft.</Txt>
    <ErrorNotice message={error} />
    <Button label={busy ? 'Preparing backup…' : 'Save backup file'} icon="download" disabled={busy} onPress={() => { void save(); }} />
    {saved && <Txt accessibilityLiveRegion="polite" style={{ color: colors.green, fontSize: 16 }}>Backup file prepared. Check that it was saved in your chosen location.</Txt>}
  </>;
}

export function RestoreBackup({ workspace, lock, done }: { workspace: Workspace; lock: (locked: boolean) => void; done: (created: boolean) => void }) {
  const [backup, setBackup] = useState<VerifiedBackup>();
  const [phase, setPhase] = useState<'idle' | 'checking' | 'restoring'>('idle');
  const [error, setError] = useState(''); const running = useRef(false); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function choose() {
    if (running.current) return;
    running.current = true; setError('');
    try {
      const bytes = await pickBackup(MAX_BACKUP_BYTES);
      if (!bytes || !alive.current) return;
      setPhase('checking'); lock(true); setBackup(undefined);
      const parsed = await decodeBackup(bytes, digest);
      if (alive.current) setBackup(parsed);
    } catch (error) { if (alive.current) { setBackup(undefined); setError(error instanceof Error ? error.message : 'Could not read this backup.'); } }
    finally { running.current = false; if (alive.current) { setPhase('idle'); lock(false); } }
  }
  async function restore() {
    if (!backup || running.current) return;
    running.current = true; setPhase('restoring'); lock(true); setError('');
    try { const result = await workspace.restore(backup); done(result.created); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not restore this draft. Free some device storage and try again.'); }
    finally { running.current = false; setPhase('idle'); lock(false); }
  }
  return <>
    <Txt style={{ color: colors.muted, fontSize: 16 }}>Choose a .pete backup to recover its draft and original files on this device. Existing drafts stay as they are. Importing the same file again opens its restored copy, keeping any edits.</Txt>
    <Button label={phase === 'checking' ? 'Checking backup…' : backup ? 'Choose another backup' : 'Choose backup file'} kind="secondary" disabled={phase !== 'idle'} onPress={() => { void choose(); }} />
    {backup && <><Contents draft={backup.draft} /><Txt style={{ color: colors.muted, fontSize: 16 }}>Unfinished transcription and card reading stay paused until you choose Retry processing. Restore creates a separate draft.</Txt><Button label={phase === 'restoring' ? 'Restoring…' : 'Restore draft'} disabled={phase !== 'idle'} icon="check" onPress={() => { void restore(); }} /></>}
    <ErrorNotice message={error} />
  </>;
}
