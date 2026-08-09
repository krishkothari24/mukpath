import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function clockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Reference recitation for a verse.
 *
 * Streamed straight from bkymukhpath.nahq.baps.dev — Phase 2 has no offline
 * audio, which is why the caller should only render this when online or
 * accept that playback fails. Downloading tracks for offline use is Phase 5,
 * as is recording the kid against them.
 *
 * Mount this with `key={url}`: the player is created from its initial source,
 * and remounting is the honest way to swap tracks when the language changes.
 */
export function AudioBar({ url, label }: { url: string; label: string }) {
  const theme = useTheme();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const duration = status.duration ?? 0;
  const position = status.currentTime ?? 0;
  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Replaying after the track ended needs an explicit rewind.
    if (duration > 0 && position >= duration - 0.25) player.seekTo(0);
    player.play();
  };

  return (
    <View style={[styles.bar, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {status.isLoaded ? `${clockTime(position)} / ${clockTime(duration)}` : 'Loading…'}
        </ThemedText>
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          onPress={togglePlayback}
          style={[styles.playButton, { backgroundColor: theme.tint }]}>
          <ThemedText style={{ color: theme.tintText, fontWeight: '700' }}>
            {status.playing ? '❚❚' : '▶'}
          </ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back 5 seconds"
          onPress={() => player.seekTo(Math.max(position - 5, 0))}
          style={[styles.secondaryButton, { borderColor: theme.border }]}>
          <ThemedText type="small">-5s</ThemedText>
        </Pressable>

        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[styles.trackFill, { backgroundColor: theme.tint, width: `${progress * 100}%` }]}
          />
        </View>
      </View>

      {status.error ? (
        <ThemedText type="small" themeColor="danger">
          Couldn&apos;t load this recording.
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 3 },
});
