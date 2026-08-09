import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const subscribe = () => () => {};
const hasHydrated = () => true;
const isServer = () => false;

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 *
 * useSyncExternalStore gives us "am I on the client yet" without a setState in
 * an effect, which triggers a cascading render.
 */
export function useColorScheme() {
  const hydrated = useSyncExternalStore(subscribe, hasHydrated, isServer);
  const colorScheme = useRNColorScheme();

  return hydrated ? colorScheme : 'light';
}
