import Constants from 'expo-constants';

// Where the Fastify backend lives.
//
// Phase 2 runs the backend locally (`npm run dev` in ../backend, port 3000).
// Expo Go on a physical phone can't resolve `localhost` — that would be the
// phone itself — so we default to the LAN address Metro is already serving
// from, which is by definition reachable from the device. Set
// EXPO_PUBLIC_API_URL in mobile/.env to point somewhere else (a Railway
// deploy, a tunnel) without touching code.
const DEFAULT_PORT = 3000;

function lanHostFromMetro(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Legacy field, still populated in some Expo Go builds.
    Constants.expoGoConfig?.debuggerHost ??
    null;
  if (!hostUri) return null;

  const host = String(hostUri).split(':')[0];
  if (!host) return null;
  return `http://${host}:${DEFAULT_PORT}`;
}

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? lanHostFromMetro() ?? `http://localhost:${DEFAULT_PORT}`;

// Requests are all small JSON reads against a machine on the same Wi-Fi;
// if one hangs past this the network is the problem, not the payload.
export const REQUEST_TIMEOUT_MS = 10_000;
