import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { getPref, setPref } from '@/lib/db';

const PREFERENCE_KEY = 'theme.preference';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

type ThemePreferenceState = {
  /** What the user picked. 'system' (the default) follows the OS setting. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => Promise<void>;
  /** 'system' resolved against the current OS setting — what screens should render with. */
  scheme: ResolvedScheme;
};

const ThemePreferenceContext = createContext<ThemePreferenceState | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    getPref(PREFERENCE_KEY).then((stored) => {
      if (!cancelled && (stored === 'light' || stored === 'dark' || stored === 'system')) {
        setPreferenceState(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback(async (next: ThemePreference) => {
    setPreferenceState(next);
    await setPref(PREFERENCE_KEY, next);
  }, []);

  const scheme: ResolvedScheme = preference === 'system' ? (systemScheme ?? 'light') : preference;

  const value = useMemo<ThemePreferenceState>(
    () => ({ preference, setPreference, scheme }),
    [preference, scheme, setPreference],
  );

  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

export function useThemePreference(): ThemePreferenceState {
  const context = useContext(ThemePreferenceContext);
  if (!context) throw new Error('useThemePreference must be used inside <ThemePreferenceProvider>');
  return context;
}
