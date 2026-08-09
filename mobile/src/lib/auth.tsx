import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { clearPractice, clearPref, getPref, setPref } from '@/lib/db';
import { deleteSecret, getSecret, setSecret } from '@/lib/secure-store';
import type { User } from '@/lib/types';

const TOKEN_KEY = 'mukhpath.token';
const ME_CACHE_KEY = 'auth.me';

/**
 * One account, one learner — no parent/kid hierarchy. Whoever is signed in
 * is who is practising. Phase 3 keys progress off the JWT's user id, so
 * there is no separate profile to pass along.
 */
type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const cacheUser = useCallback(async (next: User) => {
    setUser(next);
    // Cached so a cold launch with no network still knows who's signed in.
    await setPref(ME_CACHE_KEY, JSON.stringify(next));
  }, []);

  const signOutLocally = useCallback(async () => {
    await deleteSecret(TOKEN_KEY);
    await clearPref(ME_CACHE_KEY);
    // Progress, the review outbox and goals belong to whoever was signed in.
    // Leaving them would hand the next account this one's schedule — and
    // flush its unsent reviews under the wrong user id. Cached *content* is
    // shared and stays.
    await clearPractice();
    setToken(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Restore a session on launch.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await getSecret(TOKEN_KEY);
      if (cancelled) return;

      if (!stored) {
        setStatus('signedOut');
        return;
      }

      setToken(stored);

      // Show the cached identity immediately, then reconcile with the server.
      const cached = await getPref(ME_CACHE_KEY);
      if (cached && !cancelled) {
        try {
          setUser(JSON.parse(cached) as User);
        } catch {
          // Corrupt cache is not worth recovering from; the refresh below wins.
        }
      }
      if (!cancelled) setStatus('signedIn');

      try {
        const me = await api.me(stored);
        if (!cancelled) await cacheUser(me);
      } catch (err) {
        // A rejected or expired token means sign out. Anything else is the
        // network, and an offline launch must stay signed in.
        if (err instanceof ApiError && err.status === 401 && !cancelled) {
          await signOutLocally();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheUser, signOutLocally]);

  const establishSession = useCallback(
    async (newToken: string, newUser: User) => {
      await setSecret(TOKEN_KEY, newToken);
      setToken(newToken);
      await cacheUser(newUser);
      setStatus('signedIn');
    },
    [cacheUser],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { token: newToken, user: newUser } = await api.login(email.trim(), password);
      await establishSession(newToken, newUser);
    },
    [establishSession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const { token: newToken, user: newUser } = await api.register(
        name.trim(),
        email.trim(),
        password,
      );
      await establishSession(newToken, newUser);
    },
    [establishSession],
  );

  const value = useMemo<AuthState>(
    () => ({ status, token, user, login, register, logout: signOutLocally }),
    [login, register, signOutLocally, status, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
