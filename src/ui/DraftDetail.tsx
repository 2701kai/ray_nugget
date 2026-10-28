import { qualificationKeys, requestLabels } from '../domain/requirements';
import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { rfqGaps, titleOf, type Attachment, type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { mediaUri, releaseUri } from '../media/files';
import { colors } from './theme';
import { Button, Eyebrow, Txt } from './primitives';
import { Icon } from './Icon';
import { CloudStatus } from './CloudStatus';
import { ProcessingStatus } from './ExtractionReview';
import { VoicePlayer } from './VoicePlayer';
import { LeadHandoff } from './LeadHandoff';


export function MediaItem({ draft, item, workspace }: { draft: Draft; item: Attachment; workspace: Workspace }) {
  const draftId = draft.id;
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true; let objectUri = '';
    workspace.getMedia(draftId, item.id).then(async bytes => {
      if (!bytes) throw new Error('Original file could not be loaded.');
      objectUri = await mediaUri(bytes, item.mimeType, item.id);
      if (live) setUri(objectUri); else releaseUri(objectUri);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load file.'); });
    return () => { live = false; if (objectUri) releaseUri(objectUri); };
  }, [draftId, item.id]);
  return <View style={{ padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 12, gap: 8 }}>
    {item.kind === 'card' && !!uri && <Image source={{ uri }} accessibilityLabel={item.name} resizeMode="contain" style={{ width: '100%', height: 110, backgroundColor: colors.background, borderRadius: 8 }} />}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={item.kind === 'card' ? 'card' : 'mic'} size={16} color={colors.green} /><Txt weight="semibold" style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{item.name}</Txt>{item.kind === 'card' && <Txt style={{ fontSize: 16, color: colors.muted }}>{Math.max(1, Math.round(item.bytes / 1024))} KB</Txt>}</View>
    {item.kind === 'voice' && !!uri && <VoicePlayer uri={uri} />}
    {(error || !workspace.cloudEnabled) && <Txt style={{ fontSize: 16, color: error ? colors.danger : colors.muted, lineHeight: 24 }}>{error || 'Original saved on this device'}</Txt>}
    <ProcessingStatus draft={draft} attachmentId={item.id} workspace={workspace} />
  </View>;
}

export function DraftDetail({ draft, workspace, edit, intro, backup, exportRecord, showMedia = true }: { draft?: Draft; workspace: Workspace; edit: (kind: 'contact' | 'request') => void; intro: () => void; backup: () => void; exportRecord: () => void; showMedia?: boolean }) {
  const [shareError, setShareError] = useState('');
  if (!draft) return <View style={{ flex: 1, minHeight: 450, gap: 20, padding: 26, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: 86, height: 86, backgroundColor: colors.pale, borderRadius: 26, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }}><Icon name="folder" size={36} color={colors.green} /></View>
    <Txt weight="bold" style={{ textAlign: 'center', fontSize: 19, lineHeight: 28 }}>One visitor. Everything together.</Txt>
    <Txt style={{ textAlign: 'center', color: colors.muted, fontSize: 16, lineHeight: 24 }}>Start with a voice note or a card. Pete brings the details together here.</Txt>
    <View style={{ height: 1, backgroundColor: colors.line, width: 60 }} /><Txt style={{ textAlign: 'center', fontSize: 16, color: colors.muted }}>Your drafts stay on this device.</Txt>
  </View>;
  const gaps = rfqGaps(draft.request);
  return <View style={{ gap: 22 }}>
    <View style={{ gap: 7 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Eyebrow>CURRENT VISITOR</Eyebrow></View><CloudStatus draft={draft} workspace={workspace} /><Txt weight="bold" style={{ fontSize: 22, lineHeight: 30 }}>{titleOf(draft)}</Txt><Txt style={{ color: colors.muted, fontSize: 16 }}>{draft.contact.company || 'Company not added'}{draft.event ? ` · ${draft.event}` : ''}</Txt></View>
    <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 7 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="bold" style={{ fontSize: 16 }}>Contact details</Txt><Button label="Edit contact" kind="quiet" onPress={() => edit('contact')} style={{ paddingHorizontal: 0, minHeight: 28 }} /></View><Txt style={{ color: draft.contact.phone ? colors.ink : colors.muted, fontSize: 16 }}>{draft.contact.phone || 'Mobile number not added'}</Txt><Txt style={{ color: draft.contact.email ? colors.ink : colors.muted, fontSize: 16 }}>{draft.contact.email || 'Email not added'}</Txt></View>
    <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 10 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="bold" style={{ fontSize: 16 }}>The request</Txt><Button label="Edit request" kind="quiet" onPress={() => edit('request')} style={{ paddingHorizontal: 0, minHeight: 28 }} /></View>{[
      ['Intent', draft.request.intent === 'unspecified' ? '' : draft.request.intent === 'buy' ? 'Buying' : 'Selling'], ['Product', draft.request.product], ['Container', draft.request.packaging], ['Throughput', draft.request.throughput ? `${draft.request.throughput} ${draft.request.unit}` : ''],
      ...qualificationKeys.filter(k => draft.request[k]).map(k => [requestLabels[k], draft.request[k] ?? '']),
    ].map(([label, value]) => <View key={label} style={{ flexDirection: 'row', gap: 12 }}><Txt style={{ color: colors.muted, fontSize: 16, width: 80 }}>{label}</Txt><Txt style={{ fontSize: 16, flex: 1 }}>{value || 'Still needed'}</Txt></View>)}
    <View style={{ backgroundColor: colors.pale, borderRadius: 8, padding: 10 }}><Txt style={{ fontSize: 16, lineHeight: 24, color: colors.green }}>{gaps.length ? `${gaps.length} key details still needed` : 'Filling requirements captured'}</Txt></View>
    {!!draft.note && <Txt style={{ fontSize: 16, color: colors.muted }}>{draft.note}</Txt>}</View>
    {showMedia && draft.attachments.length > 0 && <View style={{ gap: 10 }}><Eyebrow>SOURCES · {draft.attachments.length}</Eyebrow>{draft.attachments.map(item => <MediaItem key={item.id} draft={draft} item={item} workspace={workspace} />)}</View>}
    <LeadHandoff key={draft.id} draft={draft} workspace={workspace} />
    {!!shareError && <Txt style={{ color: colors.danger }}>{shareError}</Txt>}
    {!workspace.teamView.links[draft.id] && workspace.teamView.teams.map(team => <Button key={team.id} label={`Share with the ${team.name} team`} kind="secondary" icon="folder" onPress={() => { setShareError(''); void workspace.shareTeam(draft.id, team.id).catch(error => setShareError(error.message)); }} />)}
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 18 }}><Button label="WhatsApp introduction" icon="phone" onPress={intro} /><Txt style={{ textAlign: 'center', fontSize: 16, color: colors.muted }}>Preview only. No messages are sent.</Txt><Button label="Download backup file" icon="download" kind="secondary" onPress={backup} /><Button label="Export draft metadata" kind="quiet" onPress={exportRecord} /></View>
  </View>;
}
