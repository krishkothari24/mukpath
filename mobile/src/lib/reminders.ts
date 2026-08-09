import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getPref, setPref } from '@/lib/db';

// A daily practice reminder, scheduled entirely on-device.
//
// This is a *local* notification, not a remote push: the phone already
// knows what time it is where the learner is (see scheduler.ts
// `localToday`), so there is nothing a server round trip would add, and no
// push token to register, store, or leak. It also means the reminder still
// fires from a phone that has never had a network connection since install.
//
// expo-notifications needs a handler registered before any notification can
// be shown while the app is foregrounded; see RootLayout in app/_layout.tsx.

const ENABLED_KEY = 'reminder.enabled';
const HOUR_KEY = 'reminder.hour';
const MINUTE_KEY = 'reminder.minute';

// A single well-known identifier: scheduling always cancels-then-recreates,
// so there is never more than one reminder queued, even if the learner
// changes the time five times in a row.
const NOTIFICATION_ID = 'daily-practice-reminder';

export const DEFAULT_HOUR = 17; // 5pm — after school, before dinner.
export const DEFAULT_MINUTE = 0;

export type ReminderSettings = { enabled: boolean; hour: number; minute: number };

export async function getReminderSettings(): Promise<ReminderSettings> {
  const [enabled, hour, minute] = await Promise.all([
    getPref(ENABLED_KEY),
    getPref(HOUR_KEY),
    getPref(MINUTE_KEY),
  ]);
  return {
    enabled: enabled === '1',
    hour: hour ? Number(hour) : DEFAULT_HOUR,
    minute: minute ? Number(minute) : DEFAULT_MINUTE,
  };
}

/**
 * Turn the reminder on at a given time, requesting permission first.
 *
 * Returns false without scheduling anything if permission is denied — the
 * caller is expected to tell the learner/parent to enable notifications in
 * system settings rather than silently doing nothing.
 */
export async function enableReminder(hour: number, minute: number): Promise<boolean> {
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return false;

  if (Platform.OS === 'android') {
    // Android needs a channel before a scheduled notification will show;
    // iOS has no equivalent concept.
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Practice reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID).catch(() => {
    // Nothing scheduled yet on a first-ever enable; fine.
  });
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'Time to practise',
      body: "Today's mukhpath is waiting — a few minutes keeps the streak alive.",
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });

  await Promise.all([setPref(ENABLED_KEY, '1'), setPref(HOUR_KEY, String(hour)), setPref(MINUTE_KEY, String(minute))]);
  return true;
}

export async function disableReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID).catch(() => {
    // Already off, or never scheduled — either way there's nothing to cancel.
  });
  await setPref(ENABLED_KEY, '0');
}
