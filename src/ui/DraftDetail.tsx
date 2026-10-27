import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { rfqGaps, titleOf, type Attachment, type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { mediaUri, releaseUri } from '../media/files';
import { colors } from './theme';
import { Button, Eyebrow, Txt } from './primitives';
import { Icon } from './Icon';
import { ProcessingStatus } from './ExtractionReview';

function VoicePlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <Button label={status.playing ? 'Pause recording' : 'Play recording'} kind="quiet" icon={status.playing ? 'pause' : 'play'} onPress={async () => {
    if (status.playing) player.pause();
    else { if (status.didJustFinish || status.currentTime >= status.duration) await player.seekTo(0); player.play(); }
  }} style={{ alignSelf: 'flex-start', paddingHorizontal: 0, minHeight: 32 }} />;
}

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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={item.kind === 'card' ? 'card' : 'mic'} size={16} color={colors.green} /><Txt weight="semibold" style={{ fontSize: 12, flex: 1 }} numberOfLines={1}>{item.name}</Txt><Txt style={{ fontSize: 10, color: colors.muted }}>{Math.max(1, Math.round(item.bytes / 1024))} KB</Txt></View>
    {item.kind === 'voice' && !!uri && <VoicePlayer uri={uri} />}
    <Txt style={{ fontSize: 10, color: error ? colors.danger : colors.muted, lineHeight: 15 }}>{error || 'Original saved on this device'}</Txt>
    <ProcessingStatus draft={draft} attachmentId={item.id} workspace={workspace} />
  </View>;
}

export function DraftDetail({ draft, workspace, edit, intro, exportRecord, showMedia = true }: { draft?: Draft; workspace: Workspace; edit: (kind: 'contact' | 'request') => void; intro: () => void; exportRecord: () => void; showMedia?: boolean }) {
  if (!draft) return <View style={{ flex: 1, minHeight: 450, gap: 20, padding: 26, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: 86, height: 86, backgroundColor: colors.pale, borderRadius: 26, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }}><Icon name="folder" size={36} color={colors.green} /></View>
    <Txt weight="bold" style={{ textAlign: 'center', fontSize: 19, lineHeight: 28 }}>One visitor. One place.</Txt>
    <Txt style={{ textAlign: 'center', color: colors.muted, fontSize: 12, lineHeight: 21 }}>Start with a voice note, a card, or a few details. Everything comes together here.</Txt>
    <View style={{ height: 1, backgroundColor: colors.line, width: 60 }} /><Txt style={{ textAlign: 'center', fontSize: 11, color: colors.muted }}>Your drafts stay on this device.</Txt>
  </View>;
  const gaps = rfqGaps(draft.request);
  return <View style={{ gap: 22 }}>
    <View style={{ gap: 7 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Eyebrow>CURRENT VISITOR</Eyebrow><View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}><Icon name="check" size={12} color={colors.green} /><Txt style={{ fontSize: 10, color: colors.green }}>Saved locally</Txt></View></View><Txt weight="bold" style={{ fontSize: 24, lineHeight: 32 }}>{titleOf(draft)}</Txt><Txt style={{ color: colors.muted, fontSize: 12 }}>{draft.contact.company || 'Company not added'}{draft.event ? ` · ${draft.event}` : ''}</Txt></View>
    <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 7 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="bold" style={{ fontSize: 12 }}>Contact details</Txt><Button label="Edit contact" kind="quiet" onPress={() => edit('contact')} style={{ paddingHorizontal: 0, minHeight: 28 }} /></View><Txt style={{ color: draft.contact.phone ? colors.ink : colors.muted, fontSize: 12 }}>{draft.contact.phone || 'Mobile number not added'}</Txt><Txt style={{ color: draft.contact.email ? colors.ink : colors.muted, fontSize: 12 }}>{draft.contact.email || 'Email not added'}</Txt></View>
    <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 10 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="bold" style={{ fontSize: 12 }}>The request</Txt><Button label="Edit request" kind="quiet" onPress={() => edit('request')} style={{ paddingHorizontal: 0, minHeight: 28 }} /></View>{[
      ['Product', draft.request.product], ['Container', draft.request.packaging], ['Throughput', draft.request.throughput ? `${draft.request.throughput} ${draft.request.unit}` : ''],
    ].map(([label, value]) => <View key={label} style={{ flexDirection: 'row', gap: 12 }}><Txt style={{ color: colors.muted, fontSize: 11, width: 80 }}>{label}</Txt><Txt style={{ fontSize: 12, flex: 1 }}>{value || 'Still to ask'}</Txt></View>)}
    <View style={{ backgroundColor: colors.pale, borderRadius: 8, padding: 10 }}><Txt style={{ fontSize: 10, lineHeight: 17, color: colors.green }}>{gaps.length ? `${gaps.length} filling requirement${gaps.length === 1 ? '' : 's'} still to ask` : 'Filling requirements captured'}</Txt></View>
    {!!draft.note && <Txt style={{ fontSize: 12, color: colors.muted }}>{draft.note}</Txt>}</View>
    {showMedia && draft.attachments.length > 0 && <View style={{ gap: 10 }}><Eyebrow>CAPTURED MATERIAL · {draft.attachments.length}</Eyebrow>{draft.attachments.map(item => <MediaItem key={item.id} draft={draft} item={item} workspace={workspace} />)}</View>}
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 18 }}><Button label="WhatsApp introduction" icon="phone" onPress={intro} /><Button label="Export draft metadata" icon="download" kind="quiet" onPress={exportRecord} /><Txt style={{ textAlign: 'center', fontSize: 10, color: colors.muted }}>Preview only. No messages are sent.</Txt></View>
  </View>;
}
