import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { Button, ErrorNotice, Field } from './primitives';

export function QuickNote({ draft, workspace, done }: { draft: Draft; workspace: Workspace; done: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useRef(Crypto.randomUUID());
  return <>
    <Field label="Notiz" multiline autoFocus value={text} onChangeText={setText} placeholder="Was möchtest Du zu diesem Gespräch festhalten?" />
    <ErrorNotice message={error} />
    <Button label={busy ? 'Notiz wird gespeichert…' : 'Notiz speichern'} icon="check" disabled={busy || !text.trim()} onPress={async () => {
      setBusy(true); setError('');
      try { await workspace.update(draft.id, { type: 'addNote', id: id.current, text }); done(); }
      catch (e) { setError(e instanceof Error ? e.message : 'Deine Notiz konnte nicht gespeichert werden.'); }
      finally { setBusy(false); }
    }} />
  </>;
}
