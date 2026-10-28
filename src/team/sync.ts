import type { DraftRepository } from '../storage/types';
import { emptyTeamView, type TeamView } from './types';
export function startTeamSync(_repo: DraftRepository, _changed: (view: TeamView) => void, _refresh: () => Promise<void>, _canApply: () => boolean = () => true) {
  return { wake() {}, close() {}, cancelOpen() {}, async share(_id: string, _teamId: string) { throw new Error('Team-Bereiche stehen in der angemeldeten Web-App bereit.'); }, async open(_id: string, _teamId: string) {}, async resolve(_id: string, _choices: Record<string, 'local' | 'team'>) {}, view: emptyTeamView };
}
