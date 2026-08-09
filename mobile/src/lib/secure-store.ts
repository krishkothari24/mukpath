import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore has no web implementation. Web is only ever a dev convenience
// here (the pilot ships to iOS/Android), so fall back to localStorage rather
// than crash the dev server.
const isWeb = Platform.OS === 'web';

export async function getSecret(key: string): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
