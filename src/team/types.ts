export type Team = { id: string; name: string; members: string[] };
export type TeamCopy = { sourceEditIds?: string[]; rayIds?: string[]; conversationVersion?: 1; id: string; draftId: string; fingerprint: string; revision: number; title: string; company: string; savedAt: string; createdBy?: string; updatedBy?: string; intakeVersion?: 1; lead?: LeadReceipt };
export type TeamLink = { teamId: string; base?: string; fingerprint?: string; author?: string };
export type TeamStatus = { revision?: number; state: 'pending' | 'saving' | 'saved' | 'conflict' | 'error'; message?: string; conflicts?: string[]; comparisons?: Array<{ key: string; local: string; team: string }> };
export type TeamView = { teams: Team[]; links: Record<string, TeamLink>; states: Record<string, TeamStatus>; copies: Array<TeamCopy & { teamId: string }>; available: boolean; error?: string };
export const emptyTeamView: TeamView = { teams: [], links: {}, states: {}, copies: [], available: false };
import type { LeadReceipt } from '../leads/types';
