import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Banner, Button, Card, Centered, Column, Loading } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { disableReminder, enableReminder, getReminderSettings, type ReminderSettings } from '@/lib/reminders';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

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
  const [showIosPicker, setShowIosPicker] = useState(false);
  // Draft time for the inline iOS picker, seeded from the current setting
  // when it's opened; Android has no equivalent draft state since its
  // dialog commits (or is cancelled) atomically.
  const [draftTime, setDraftTime] = useState<Date | null>(null);

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

  const openPicker = () => {
    const seed = new Date();
    seed.setHours(settings.hour, settings.minute, 0, 0);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: seed,
        mode: 'time',
        onChange: (_event, selectedDate) => {
          if (selectedDate) pick(selectedDate.getHours(), selectedDate.getMinutes());
        },
      });
    } else {
      setDraftTime(seed);
      setShowIosPicker(true);
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

            <TimeField
              value={settings.enabled ? `${pad(settings.hour)}:${pad(settings.minute)}` : 'Off'}
              onPress={openPicker}
              disabled={busy}
            />

            {/* Android's picker is its own dialog (DateTimePickerAndroid.open,
                in openPicker); iOS has no such dialog, so it renders inline
                here, committed by the Set button. */}
            {showIosPicker && draftTime ? (
              <>
                <DateTimePicker
                  value={draftTime}
                  mode="time"
                  display="spinner"
                  onChange={(_event, selectedDate) => {
                    if (selectedDate) setDraftTime(selectedDate);
                  }}
                />
                <View style={styles.iosPickerActions}>
                  <Button variant="secondary" label="Cancel" onPress={() => setShowIosPicker(false)} />
                  <Button
                    label="Set reminder"
                    busy={busy}
                    onPress={async () => {
                      await pick(draftTime.getHours(), draftTime.getMinutes());
                      setShowIosPicker(false);
                    }}
                  />
                </View>
              </>
            ) : null}

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

/** Opens the platform time picker; shows the picked time like the rest of
 *  the input surfaces (Field's border/height), but isn't itself editable. */
function TimeField({
  value,
  onPress,
  disabled,
}: {
  value: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.input,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement, opacity: disabled ? 0.6 : 1 },
      ]}>
      <ThemedText type="default">{value}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.three, paddingBottom: Spacing.six },
  body: { gap: Spacing.three },
  retry: { marginTop: Spacing.three },
  iosPickerActions: { flexDirection: 'row', gap: Spacing.two },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
});
