import type { DraftRepository } from '../storage/types';
import { emptyTeamView, type TeamView } from './types';
export function startTeamSync(_repo: DraftRepository, _changed: (view: TeamView) => void, _refresh: () => Promise<void>, _canApply: () => boolean = () => true) {
  return { wake() {}, close() {}, cancelOpen() {}, async assignOwner(_id: string, _email: string, _expectedVersion: number) { throw new Error('Lead ownership is available in the signed-in web app.'); }, async share(_id: string, _teamId: string) { throw new Error('Team workspaces are available in the signed-in web app.'); }, async open(_id: string, _teamId: string) {}, async resolve(_id: string, _choices: Record<string, 'local' | 'team'>) {}, view: emptyTeamView };
}
