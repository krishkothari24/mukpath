import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteRecording, recordingUri, saveRecording } from '@/lib/recordings';

/**
 * Record yourself reciting this verse, then play it back next to the
 * reference audio above. Local only — see lib/recordings.ts.
 *
 * One take per verse: recording again replaces the last one rather than
 * piling up files nobody will ever compare, matching the app's "practise
 * the current material" framing rather than a portfolio of past attempts.
 *
 * Mount this with `key={verseId}`, same reason as `AudioBar`'s `key={url}`:
 * moving to a sibling verse needs fresh local state (any existing take,
 * whether a recording is mid-flight), and a remount is the honest way to
 * reset it rather than an effect syncing state to a prop.
 */
export function RecordingBar({ verseId }: { verseId: string }) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [savedUri, setSavedUri] = useState<string | null>(() => recordingUri(verseId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startRecording = async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone access is off for this app in system settings.');
      return;
    }
    try {
      // Silenced by default so recitation audio doesn't fight the mic; see
      // RootLayout for why playback itself stays audible on silent mode.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setError("Couldn't start recording.");
    }
  };

  const stopRecording = async () => {
    setBusy(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (recorder.uri) setSavedUri(await saveRecording(verseId, recorder.uri));
    } catch {
      setError("Couldn't save that recording.");
    } finally {
      setBusy(false);
    }
  };

  const removeRecording = () => {
    deleteRecording(verseId);
    setSavedUri(null);
  };

  return (
    <View style={[styles.bar, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Your recording
      </ThemedText>

      {recorderState.isRecording ? (
        <View style={styles.row}>
          <ThemedText type="small" themeColor="danger" style={styles.recordingLabel}>
            ● Recording… {Math.round(recorderState.durationMillis / 1000)}s
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
            onPress={stopRecording}
            style={[styles.button, { backgroundColor: theme.tint }]}>
            <ThemedText style={{ color: theme.tintText, fontWeight: '700' }}>Stop</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          {savedUri ? (
            <>
              {/* Remounted per take — see saveRecording's note on why the
                  filename (and therefore this key) changes every time. */}
              <PlaybackButton key={savedUri} uri={savedUri} />
              <Pressable
                accessibilityRole="button"
                onPress={startRecording}
                disabled={busy}
                style={[styles.secondaryButton, { borderColor: theme.border, opacity: busy ? 0.5 : 1 }]}>
                <ThemedText type="small">Re-record</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={removeRecording}
                disabled={busy}
                style={[styles.secondaryButton, { borderColor: theme.border, opacity: busy ? 0.5 : 1 }]}>
                <ThemedText type="small">Delete</ThemedText>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record yourself"
              onPress={startRecording}
              disabled={busy}
              style={[styles.button, { backgroundColor: theme.tint, opacity: busy ? 0.5 : 1 }]}>
              <ThemedText style={{ color: theme.tintText, fontWeight: '700' }}>● Record yourself</ThemedText>
            </Pressable>
          )}
        </View>
      )}

      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

function PlaybackButton({ uri }: { uri: string }) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    const duration = status.duration ?? 0;
    if (duration > 0 && status.currentTime >= duration - 0.25) player.seekTo(0);
    player.play();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Pause your recording' : 'Play your recording'}
      onPress={toggle}
      style={[styles.button, { backgroundColor: theme.tint }]}>
      <ThemedText style={{ color: theme.tintText, fontWeight: '700' }}>
        {status.playing ? '❚❚ Playing' : '▶ Play back'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  recordingLabel: { flexGrow: 1 },
  button: {
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
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
});
