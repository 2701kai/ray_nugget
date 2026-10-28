import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useUpdateGuard } from '../pwa/updateGuard';
import { Button, ErrorNotice, Txt, useControlsDisabled } from './primitives';
import { colors } from './theme';

const clock = (value: number) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export function VoicePlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const disabled = useControlsDisabled();
  const [error, setError] = useState('');
  useUpdateGuard(status.playing);
  useEffect(() => { if (disabled && status.playing) player.pause(); }, [disabled, status.playing, player]);
  const duration = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0;
  const position = Number.isFinite(status.currentTime) ? Math.max(0, status.currentTime) : 0;
  async function run(action: () => void | Promise<void>) {
    if (disabled) return;
    try { setError(''); await action(); }
    catch { setError('Could not play this recording. Try again.'); }
  }
  return <View style={{ gap: 7 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
      <Button label={status.playing ? 'Pause' : 'Play'} accessibilityLabel={status.playing ? 'Pause recording' : 'Play recording'} kind="secondary" icon={status.playing ? 'pause' : 'play'} onPress={() => { void run(async () => {
        if (status.playing) player.pause();
        else { if (status.didJustFinish || (duration && position >= duration)) await player.seekTo(0); player.play(); }
      }); }} />
      <Button label="−10s" accessibilityLabel="Skip back 10 seconds" kind="quiet" disabled={!status.isLoaded || position <= 0} onPress={() => { void run(() => player.seekTo(Math.max(0, position - 10))); }} style={{ minWidth: 44, paddingHorizontal: 6 }} />
      <Button label="+10s" accessibilityLabel="Skip forward 10 seconds" kind="quiet" disabled={!status.isLoaded || !duration || position >= duration} onPress={() => { void run(() => player.seekTo(Math.min(duration, position + 10))); }} style={{ minWidth: 44, paddingHorizontal: 6 }} />
      <Txt accessibilityLabel="Playback time" style={{ flexGrow: 1, fontSize: 16, color: colors.muted, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{clock(position)}{duration ? ` / ${clock(duration)}` : ''}</Txt>
    </View>
    {!!duration && <View accessibilityRole="progressbar" accessibilityLabel="Recording playback" accessibilityValue={{ min: 0, max: Math.ceil(duration), now: Math.min(Math.floor(position), Math.ceil(duration)) }} aria-valuemin={0} aria-valuemax={Math.ceil(duration)} aria-valuenow={Math.min(Math.floor(position), Math.ceil(duration))} style={{ height: 4, backgroundColor: colors.sage, borderRadius: 2, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, position / duration * 100)}%`, height: 4, backgroundColor: colors.green }} /></View>}
    <ErrorNotice message={error} />
  </View>;
}
