import { View } from 'react-native';
import { type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { MediaItem } from './DraftDetail';
import { Icon } from './Icon';
import { Eyebrow, Txt } from './primitives';
import { colors } from './theme';
import { SourceText } from './SourceText';
import type { ReactNode } from 'react';

export function Conversation({ draft, workspace, ray, rayAt }: { draft: Draft; workspace: Workspace; ray?: ReactNode; rayAt?: string }) {
  const entries = [
    ...draft.attachments.map(item => ({ kind: 'media' as const, id: item.id, at: item.capturedAt, item })),
    ...(draft.entries ?? []).map(item => ({ kind: 'note' as const, id: item.id, at: item.createdAt, item })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const timeline = [...entries.map(entry => ({ at: entry.at, id: entry.id, entry })),
    ...(ray && rayAt ? [{ at: rayAt, id: 'ray', entry: undefined }] : [])].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return <View testID="conversation-feed" style={{ gap: 18 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Txt weight="bold" style={{ fontSize: 18 }}>Conversation</Txt><Txt style={{ fontSize: 14, color: colors.muted }}>Newest first</Txt></View>
    {!!workspace.teamView.links[draft.id]?.author && <Txt style={{ fontSize: 16, color: colors.muted }}>Last updated by: {workspace.teamView.links[draft.id].author}</Txt>}
    {!entries.length && <View style={{ paddingVertical: 42, gap: 14, alignItems: 'flex-start' }}>
      <View style={{ backgroundColor: colors.sage, padding: 16, borderRadius: 20 }}><Icon name="mic" size={32} color={colors.green} /></View>
      <Txt weight="bold" style={{ fontSize: 25, lineHeight: 33, letterSpacing: -0.8 }}>Their story starts here.</Txt>
      <Txt style={{ color: colors.muted, maxWidth: 380, lineHeight: 24 }}>Say who you met and what they need, or photograph their card. Pete fills the details here. No typing needed.</Txt>
    </View>}
    {timeline.map(({ entry, id }) => entry ? <View key={id} testID="capture-entry" style={{ gap: 7, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.line }}>
      <Eyebrow>{entry.kind === 'note' ? 'NOTE' : entry.item.kind === 'card' ? 'BUSINESS CARD' : entry.item.voiceMode === 'conversation' ? 'CONVERSATION' : 'VOICE NOTE'} · {new Date(entry.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</Eyebrow>
      {entry.kind === 'media' ? <>
        <MediaItem draft={draft} item={entry.item} workspace={workspace} />
        <SourceText draft={draft} attachment={entry.item} workspace={workspace} job={workspace.jobs.find(job => job.attachmentId === entry.id && job.draftId === draft.id)} />
      </> : <View style={{ padding: 17, borderRadius: 14, borderTopLeftRadius: 3, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line }}><Txt selectable style={{ fontSize: 18, lineHeight: 24 }}>{entry.item.text}</Txt></View>}
    </View> : <View key={id}>{ray}</View>)}
  </View>;
}
