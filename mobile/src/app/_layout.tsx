import { setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth';
import { ContentProvider, useContent } from '@/lib/content';
import { PracticeProvider } from '@/lib/practice';

SplashScreen.preventAutoHideAsync();

// Required once, globally, for a scheduled local notification to actually
// show while the app is in the foreground — see lib/reminders.ts.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function RootNavigator() {
  const { status } = useAuth();
  const { ready } = useContent();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    const onLoginScreen = segments[0] === 'login';
    if (status === 'signedOut' && !onLoginScreen) {
      router.replace('/login');
    } else if (status === 'signedIn' && onLoginScreen) {
      router.replace('/');
    }
  }, [router, segments, status]);

  useEffect(() => {
    if (status !== 'loading' && ready) SplashScreen.hideAsync();
  }, [ready, status]);

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Mukhpath' }} />
      <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="text/[textId]" options={{ title: '' }} />
      <Stack.Screen name="section/[sectionId]" options={{ title: '' }} />
      <Stack.Screen name="verse/[verseId]" options={{ title: '' }} />
      <Stack.Screen name="practice" options={{ title: 'Practice' }} />
      <Stack.Screen name="goals" options={{ title: 'Goals' }} />
      <Stack.Screen name="reminders" options={{ title: 'Reminders' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Recitation should still play when the ringer switch is silenced — kids
  // practise with the phone on silent.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
      // Non-fatal: audio just follows the ringer switch.
    });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <ContentProvider>
          <PracticeProvider>
            <RootNavigator />
          </PracticeProvider>
        </ContentProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
