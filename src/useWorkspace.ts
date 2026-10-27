import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { createDraft, MAX_MEDIA_BYTES, type Attachment, type CaptureKind, type Draft, type DraftAction } from './domain/draft';
import { openRepository } from './storage/repository';
import { defaultPreferences, type DraftRepository, type Preferences } from './storage/types';
import { readUri } from './media/files';

export function useWorkspace() {
  const repo = useRef<DraftRepository | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let alive = true;
    let current: DraftRepository | undefined;
    setLoading(true); setError('');
    openRepository().then(async repository => {
      current = repository;
      const [records, prefs] = await Promise.all([repository.list(), repository.preferences()]);
      if (!alive) return repository.close();
      repo.current = repository; setDrafts(records); setPreferences(prefs); setLoading(false);
    }).catch(error => { if (alive) { setError(error instanceof Error ? error.message : 'Local storage is unavailable.'); setLoading(false); } });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && repo.current) repo.current.list().then(records => { if (alive) setDrafts(records); }).catch(() => { if (alive) setError('Could not refresh local drafts.'); });
    });
    return () => { alive = false; subscription.remove(); repo.current = null; void current?.close(); };
  }, [generation]);

  const repository = () => { if (!repo.current) throw new Error('Local storage is not ready.'); return repo.current; };
  const merge = useCallback((next: Draft) => setDrafts(records => {
    const current = records.find(d => d.id === next.id);
    if (current && current.revision > next.revision) return records;
    return [next, ...records.filter(d => d.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }), []);
  async function create(entry: CaptureKind) {
    const draft = createDraft(Crypto.randomUUID(), entry, preferences.event, new Date().toISOString());
    await repository().create(draft); merge(draft); return draft;
  }
  async function update(id: string, action: DraftAction, revision?: number) {
    const draft = await repository().update(id, action, revision); merge(draft); return draft;
  }
  async function attach(id: string, uri: string, details: Omit<Attachment, 'id' | 'bytes' | 'sha256' | 'capturedAt'>) {
    const { bytes, mimeType } = await readUri(uri);
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('Choose a non-empty file smaller than 15 MB.');
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const attachment: Attachment = { ...details, mimeType: mimeType || details.mimeType, id: Crypto.randomUUID(), bytes: bytes.byteLength, sha256, capturedAt: new Date().toISOString() };
    const draft = await repository().update(id, { type: 'attach', attachment }, undefined, bytes); merge(draft); return draft;
  }
  async function savePreferences(value: Preferences) { await repository().savePreferences(value); setPreferences(value); }
  async function getMedia(draftId: string, attachmentId: string) { return repository().media(draftId, attachmentId); }
  return { drafts, preferences, loading, error, retry: () => setGeneration(g => g + 1), create, update, attach, savePreferences, getMedia };
}
export type Workspace = ReturnType<typeof useWorkspace>;
