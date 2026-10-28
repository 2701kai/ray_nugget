import { View } from 'react-native';
import { rfqGaps, type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { MediaItem } from './DraftDetail';
import { Icon } from './Icon';
import { Eyebrow, Txt, useControlsDisabled } from './primitives';
import { colors } from './theme';
import { SourceText } from './SourceText';

export function Conversation({ draft, workspace }: { draft: Draft; workspace: Workspace }) {
  const capturing = useControlsDisabled();
  const entries = [
    ...draft.attachments.map(item => ({ kind: 'media' as const, id: item.id, at: item.capturedAt, item })),
    ...(draft.entries ?? []).map(item => ({ kind: 'note' as const, id: item.id, at: item.createdAt, item })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return <View style={{ gap: 18 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="clock" size={13} color={colors.muted} /><Txt style={{ fontSize: 16, color: colors.muted }}>Started {new Date(draft.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</Txt></View>
    {!!workspace.teamView.links[draft.id]?.author && <Txt style={{ fontSize: 16, color: colors.muted }}>Last updated by: {workspace.teamView.links[draft.id].author}</Txt>}
    {!entries.length && <View style={{ paddingVertical: 42, gap: 14, alignItems: 'flex-start' }}>
      <View style={{ backgroundColor: colors.sage, padding: 16, borderRadius: 20 }}><Icon name="mic" size={32} color={colors.green} /></View>
      <Txt weight="bold" style={{ fontSize: 25, lineHeight: 33, letterSpacing: -0.8 }}>Their story starts here.</Txt>
      <Txt style={{ color: colors.muted, maxWidth: 380, lineHeight: 24 }}>Say who you met and what they need, or photograph their card. Pete fills the details here. No typing needed.</Txt>
    </View>}
    {!!entries.length && !!rfqGaps(draft.request).length && <Txt style={{ fontSize: 16, lineHeight: 23, color: colors.muted }}>Still needed: {rfqGaps(draft.request).join(' · ')}. Add it in a voice note.</Txt>}
    {entries.map(entry => <View key={entry.id} style={{ gap: 7 }}>
      <Eyebrow>{entry.kind === 'note' ? 'NOTE' : entry.item.kind === 'card' ? 'BUSINESS CARD' : entry.item.voiceMode === 'conversation' ? 'CONVERSATION' : 'VOICE NOTE'} · {new Date(entry.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</Eyebrow>
      {entry.kind === 'media' ? <>
        <MediaItem draft={draft} item={entry.item} workspace={workspace} />
        <SourceText draft={draft} attachment={entry.item} job={workspace.jobs.find(job => job.attachmentId === entry.id && job.draftId === draft.id)} />
      </> : <View style={{ padding: 17, borderRadius: 14, borderTopLeftRadius: 3, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line }}><Txt selectable style={{ fontSize: 18, lineHeight: 24 }}>{entry.item.text}</Txt></View>}
    </View>)}
    {!capturing && <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 12 }}><Icon name="check" size={13} color={colors.green} /><Txt style={{ fontSize: 16, color: colors.muted }}>{workspace.cloudEnabled ? 'Originals save here and upload automatically to company cloud.' : 'Originals saved locally. You can keep capturing while processing runs.'}</Txt></View>}
  </View>;
}
