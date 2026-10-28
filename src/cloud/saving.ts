import type { DraftRepository } from '../storage/types';
import type { VerifiedBackup } from '../backup/archive';
export type CloudCopy = { id: string; draftId: string; fingerprint: string; revision: number; title: string; company: string; savedAt: string };
export type CloudStatus = { state: 'pending' | 'saving' | 'saved' | 'error'; revision: number; message?: string };
export function startCloudSaving(_repo: DraftRepository, _changed: (states: Record<string, CloudStatus>) => void) {
  return { enabled: false, wake() {}, close() {}, async list(): Promise<CloudCopy[]> { return []; }, async restore(_id: string): Promise<VerifiedBackup> { throw new Error('Company cloud storage is available in the hosted app.'); } };
}
