import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getPref, listTexts, setPref } from '@/lib/db';
import { lastSyncedAt, syncContent } from '@/lib/sync';
import type { Language } from '@/lib/types';

const LANGUAGE_KEY = 'reader.language';
const DEFAULT_LANGUAGE: Language = 'transliteration';

type ContentState = {
  /** SQLite is open and has been checked for content. Screens can query. */
  ready: boolean;
  /** True while a network pull is in flight; screens stay usable throughout. */
  syncing: boolean;
  /** Last sync failure, kept visible rather than swallowed. */
  error: string | null;
  hasContent: boolean;
  lastSync: Date | null;
  resync: () => Promise<void>;
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  /** Bumped after every successful sync so list screens re-query. */
  revision: number;
};

const ContentContext = createContext<ContentState | null>(null);

export function ContentProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasContent, setHasContent] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [revision, setRevision] = useState(0);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncContent();
      setHasContent(result.verses > 0);
      setLastSync(new Date(result.syncedAt));
      setRevision((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      throw err;
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [texts, storedLanguage, syncedAt] = await Promise.all([
        listTexts(),
        getPref(LANGUAGE_KEY),
        lastSyncedAt(),
      ]);
      if (cancelled) return;

      if (storedLanguage) setLanguageState(storedLanguage as Language);
      setHasContent(texts.length > 0);
      setLastSync(syncedAt);
      setReady(true);

      // Refresh on every launch. With a warm cache this is invisible; with a
      // cold one it's the only way the app has content at all. Either way a
      // failure here is not fatal — the cache is the source of truth for reads.
      try {
        await runSync();
      } catch {
        // Surfaced through `error`, not thrown at the render tree.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runSync]);

  const setLanguage = useCallback(async (next: Language) => {
    setLanguageState(next);
    await setPref(LANGUAGE_KEY, next);
  }, []);

  const resync = useCallback(async () => {
    try {
      await runSync();
    } catch {
      // Already recorded in `error`.
    }
  }, [runSync]);

  const value = useMemo<ContentState>(
    () => ({
      ready,
      syncing,
      error,
      hasContent,
      lastSync,
      resync,
      language,
      setLanguage,
      revision,
    }),
    [error, hasContent, language, lastSync, ready, resync, revision, setLanguage, syncing],
  );

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContent(): ContentState {
  const context = useContext(ContentContext);
  if (!context) throw new Error('useContent must be used inside <ContentProvider>');
  return context;
}
