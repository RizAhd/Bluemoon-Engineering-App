import { LinearGradient } from 'expo-linear-gradient';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/theme';

/**
 * While a screen with the blue hero is in front, the status-bar icons are white. When its page scrolls, white cards
 * would slide under those icons and hide the clock and battery, so a blue strip stays behind the status bar.
 * `Hero` turns it on while focused; the root layout draws it above every screen.
 */
let heroCount = 0;
const listeners = new Set<() => void>();

export function setHeroFocused(on: boolean) {
  heroCount = Math.max(0, heroCount + (on ? 1 : -1));
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function HeroStatusStrip() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const on = useSyncExternalStore(subscribe, () => heroCount > 0);
  if (!on || insets.top <= 0) return null;
  // the hero's own gradient runs from the bottom-left to the top-right: along its top edge it goes from the middle blue to the light one
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top }}>
      <LinearGradient colors={[c.header, c.headerEnd]} start={{ x: -0.7, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
    </View>
  );
}
