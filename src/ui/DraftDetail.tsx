import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useUpdateGuard } from '../pwa/updateGuard';
import { rfqGaps, titleOf, type Attachment, type Draft } from '../domain/draft';
import type { Workspace } from '../useWorkspace';
import { mediaUri, releaseUri } from '../media/files';
import { colors } from './theme';
import { Button, Eyebrow, Txt } from './primitives';
import { Icon } from './Icon';
import { CloudStatus } from './CloudStatus';
import { ProcessingStatus } from './ExtractionReview';

function VoicePlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  useUpdateGuard(status.playing);
  return <Button label={status.playing ? 'Aufnahme pausieren' : 'Aufnahme abspielen'} kind="quiet" icon={status.playing ? 'pause' : 'play'} onPress={async () => {
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
      if (!bytes) throw new Error('Das Original konnte nicht geladen werden.');
      objectUri = await mediaUri(bytes, item.mimeType, item.id);
      if (live) setUri(objectUri); else releaseUri(objectUri);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Die Datei konnte nicht geladen werden.'); });
    return () => { live = false; if (objectUri) releaseUri(objectUri); };
  }, [draftId, item.id]);
  return <View style={{ padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 12, gap: 8 }}>
    {item.kind === 'card' && !!uri && <Image source={{ uri }} accessibilityLabel={item.name} resizeMode="contain" style={{ width: '100%', height: 110, backgroundColor: colors.background, borderRadius: 8 }} />}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={item.kind === 'card' ? 'card' : 'mic'} size={16} color={colors.green} /><Txt weight="semibold" style={{ fontSize: 16, flex: 1 }} numberOfLines={1}>{item.name}</Txt><Txt style={{ fontSize: 16, color: colors.muted }}>{Math.max(1, Math.round(item.bytes / 1024))} KB</Txt></View>
    {item.kind === 'voice' && !!uri && <VoicePlayer uri={uri} />}
    {(error || !workspace.cloudEnabled) && <Txt style={{ fontSize: 16, color: error ? colors.danger : colors.muted, lineHeight: 24 }}>{error || 'Original auf diesem Gerät gesichert'}</Txt>}
    <ProcessingStatus draft={draft} attachmentId={item.id} workspace={workspace} />
  </View>;
}

export function DraftDetail({ draft, workspace, edit, intro, backup, exportRecord, showMedia = true }: { draft?: Draft; workspace: Workspace; edit: (kind: 'contact' | 'request') => void; intro: () => void; backup: () => void; exportRecord: () => void; showMedia?: boolean }) {
  const [shareError, setShareError] = useState('');
  if (!draft) return <View style={{ flex: 1, minHeight: 450, gap: 20, padding: 26, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: 86, height: 86, backgroundColor: colors.pale, borderRadius: 26, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }}><Icon name="folder" size={36} color={colors.green} /></View>
    <Txt weight="bold" style={{ textAlign: 'center', fontSize: 19, lineHeight: 28 }}>Ein Besucher. Alles zusammen.</Txt>
    <Txt style={{ textAlign: 'center', color: colors.muted, fontSize: 16, lineHeight: 24 }}>Beginne mit einer Sprachnotiz oder einer Karte. Pete führt die Angaben hier zusammen.</Txt>
    <View style={{ height: 1, backgroundColor: colors.line, width: 60 }} /><Txt style={{ textAlign: 'center', fontSize: 16, color: colors.muted }}>Deine Besucher bleiben auf diesem Gerät verfügbar.</Txt>
  </View>;
  const gaps = rfqGaps(draft.request);
  return <View style={{ gap: 22 }}>
    <View style={{ gap: 7 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Eyebrow>Aktueller Besucher</Eyebrow></View><CloudStatus draft={draft} workspace={workspace} /><Txt weight="bold" style={{ fontSize: 22, lineHeight: 30 }}>{titleOf(draft)}</Txt><Txt style={{ color: colors.muted, fontSize: 16 }}>{draft.contact.company || 'Firma noch offen'}{draft.event ? ` · ${draft.event}` : ''}</Txt></View>
    <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 7 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="bold" style={{ fontSize: 16 }}>Kontaktdaten</Txt><Button label="Kontakt bearbeiten" kind="quiet" onPress={() => edit('contact')} style={{ paddingHorizontal: 0, minHeight: 28 }} /></View><Txt style={{ color: draft.contact.phone ? colors.ink : colors.muted, fontSize: 16 }}>{draft.contact.phone || 'Mobilnummer noch offen'}</Txt><Txt style={{ color: draft.contact.email ? colors.ink : colors.muted, fontSize: 16 }}>{draft.contact.email || 'E-Mail noch offen'}</Txt></View>
    <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 18, gap: 10 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt weight="bold" style={{ fontSize: 16 }}>Bedarf</Txt><Button label="Bedarf bearbeiten" kind="quiet" onPress={() => edit('request')} style={{ paddingHorizontal: 0, minHeight: 28 }} /></View>{[
      ['Absicht', draft.request.intent === 'unspecified' ? '' : draft.request.intent === 'buy' ? 'Kaufen' : 'Verkaufen'], ['Produkt', draft.request.product], ['Behälter', draft.request.packaging], ['Durchsatz', draft.request.throughput ? `${draft.request.throughput} ${draft.request.unit}` : ''],
    ].map(([label, value]) => <View key={label} style={{ flexDirection: 'row', gap: 12 }}><Txt style={{ color: colors.muted, fontSize: 16, width: 80 }}>{label}</Txt><Txt style={{ fontSize: 16, flex: 1 }}>{value || 'Noch offen'}</Txt></View>)}
    <View style={{ backgroundColor: colors.pale, borderRadius: 8, padding: 10 }}><Txt style={{ fontSize: 16, lineHeight: 24, color: colors.green }}>{gaps.length ? `${gaps.length} Kernangaben noch offen` : 'Kernbedarf erfasst'}</Txt></View>
    {!!draft.note && <Txt style={{ fontSize: 16, color: colors.muted }}>{draft.note}</Txt>}</View>
    {showMedia && draft.attachments.length > 0 && <View style={{ gap: 10 }}><Eyebrow>QUELLEN · {draft.attachments.length}</Eyebrow>{draft.attachments.map(item => <MediaItem key={item.id} draft={draft} item={item} workspace={workspace} />)}</View>}
    {!!shareError && <Txt style={{ color: colors.danger }}>{shareError}</Txt>}
    {!workspace.teamView.links[draft.id] && workspace.teamView.teams.map(team => <Button key={team.id} label={`In ${team.name} mit dem Team teilen`} kind="secondary" icon="folder" onPress={() => { setShareError(''); void workspace.shareTeam(draft.id, team.id).catch(error => setShareError(error.message)); }} />)}
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 18 }}><Button label="Kontaktvorlage" icon="phone" onPress={intro} /><Txt style={{ textAlign: 'center', fontSize: 16, color: colors.muted }}>Nur Vorschau. Es wird nichts versendet.</Txt><Button label="Besucher als .pete-Datei exportieren" icon="download" kind="secondary" onPress={backup} /><Button label="Daten als JSON exportieren" kind="quiet" onPress={exportRecord} /></View>
  </View>;
}
