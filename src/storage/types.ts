import type { Draft, DraftAction, Sender } from '../domain/draft';
import type { ProcessingRepository } from '../processing/jobs';
import type { BackupSnapshot, VerifiedBackup } from '../backup/archive';

export type Preferences = { sender: Sender; event: string };
export const defaultPreferences: Preferences = { sender: { name: '', company: 'BEVMAQ', phone: '' }, event: '' };
export interface DraftRepository extends ProcessingRepository {
  list(): Promise<Draft[]>;
  create(draft: Draft, activate?: boolean): Promise<void>;
  activeDraft(): Promise<string | undefined>;
  activateDraft(id?: string): Promise<void>;
  update(id: string, action: DraftAction, expectedRevision?: number, media?: Uint8Array): Promise<Draft>;
  media(draftId: string, attachmentId: string): Promise<Uint8Array | undefined>;
  snapshot(id: string): Promise<BackupSnapshot>;
  restore(backup: VerifiedBackup): Promise<{ draft: Draft; created: boolean }>;
  preferences(): Promise<Preferences>;
  savePreferences(preferences: Preferences): Promise<void>;
  close(): Promise<void>;
}
