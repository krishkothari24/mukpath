import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Centered, Column, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { disableReminder, enableReminder, getReminderSettings, type ReminderSettings } from '@/lib/reminders';

// Presets rather than a free time picker: a small pilot doesn't need one,
// and it's one fewer native dependency (no date/time picker library) for a
// choice that's really "morning, after school, or evening".
const PRESETS: { label: string; hour: number; minute: number }[] = [
  { label: 'Morning · 8:00', hour: 8, minute: 0 },
  { label: 'After school · 16:30', hour: 16, minute: 30 },
  { label: 'Evening · 19:00', hour: 19, minute: 0 },
];

/**
 * One daily local reminder — see lib/reminders.ts for why it's local rather
 * than a server-sent push.
 */
export default function RemindersScreen() {
  const theme = useTheme();
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getReminderSettings()
      .then((loaded) => {
        if (!cancelled) {
          setSettings(loaded);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load reminder settings');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (loadError) {
    return (
      <Centered>
        <Banner tone="error">{loadError}</Banner>
        <View style={styles.retry}>
          <Button label="Try again" onPress={() => setAttempt((count) => count + 1)} />
        </View>
      </Centered>
    );
  }

  if (!settings) return <Loading />;

  const pick = async (hour: number, minute: number) => {
    setBusy(true);
    setError(null);
    try {
      const granted = await enableReminder(hour, minute);
      if (!granted) {
        setError('Notifications are turned off for this app in system settings.');
        return;
      }
      setSettings({ enabled: true, hour, minute });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disableReminder();
      setSettings({ ...settings, enabled: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Reminders' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Column style={styles.body}>
          <ThemedText type="small" themeColor="textSecondary">
            A once-a-day nudge to practise, at whatever time fits. It&apos;s scheduled on this
            device — it works even if the phone has never been online since it was set.
          </ThemedText>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <Card>
            <ThemedText type="smallBold">Remind me</ThemedText>
            <View style={styles.presets}>
              {PRESETS.map((preset) => {
                const selected =
                  settings.enabled && settings.hour === preset.hour && settings.minute === preset.minute;
                return (
                  <Pressable
                    key={preset.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    onPress={() => pick(preset.hour, preset.minute)}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? theme.tint : theme.border,
                        backgroundColor: selected ? theme.tint : 'transparent',
                        opacity: busy ? 0.6 : 1,
                      },
                    ]}>
                    <ThemedText type="small" style={{ color: selected ? theme.tintText : theme.text }}>
                      {preset.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {settings.enabled ? (
              <Button variant="secondary" label="Turn off reminders" onPress={turnOff} busy={busy} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Off — pick a time above to turn it on.
              </ThemedText>
            )}
          </Card>
        </Column>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.three, paddingBottom: Spacing.six },
  body: { gap: Spacing.three },
  retry: { marginTop: Spacing.three },
  presets: { gap: Spacing.two },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
