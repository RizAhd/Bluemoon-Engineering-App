import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BrandMark, BrandWordmark } from '@/components/Brand';
import { palette, space, useMotion } from '@/theme';

/** Must match the expo-splash-screen backgrounds in app.json, or the hand-over flashes. */
export const SPLASH_BG = { light: '#FFFFFF', dark: '#0B1120' } as const;

/** The splash sequence in ms. `minVisible` counts from the overlay's first frame. */
export const SPLASH_TIMING = { enter: 400, wordmarkDelay: 120, minVisible: 900, exit: 250, reducedFade: 200, loaderSweep: 700 } as const;

const MARK_HEIGHT = 72;
const WORDMARK_WIDTH = 144;
const TRACK = { width: 120, height: 3, bar: 40 } as const;

const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
const onScreen = Easing.bezier(0.77, 0, 0.175, 1);

export interface AnimatedSplashProps {
  /** Fonts and database are ready: the overlay may leave once it has been up for `minVisible`. */
  ready: boolean;
  /** Called when the fade-out has finished; the parent then unmounts the overlay. */
  onDone: () => void;
}

/**
 * The in-app continuation of the native splash: same background, the Bluemoon mark fading and
 * scaling in, the company name 120 ms later, and a slim sliding loader. It hides the native splash
 * on its own first layout (so there is no blank frame between the two), stays at least 900 ms,
 * then fades out in 250 ms without catching touches. Follows the system scheme, like the native
 * splash. Reduced motion: plain fades and a system spinner instead of the sliding bar.
 */
export function AnimatedSplash({ ready, onDone }: AnimatedSplashProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const c = palette[scheme];
  // Reanimated's value is known on the first frame; the app's hook also follows later changes.
  const systemReduced = useReducedMotion();
  const appReduced = useMotion().reduced;
  const reduced = systemReduced || appReduced;
  const [shown, setShown] = useState(false);
  const [minDone, setMinDone] = useState(false);
  const leaving = ready && minDone;

  const mark = useSharedValue(0);
  const word = useSharedValue(0);
  const bar = useSharedValue(0);
  const fade = useSharedValue(1);

  const started = useRef(false);
  // The parent's callback may change identity on every render; the fade-out timer must not restart.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  const onFirstLayout = () => {
    if (started.current) return;
    started.current = true;
    setShown(true);
    SplashScreen.hideAsync().catch(() => {});
    const enter = reduced ? SPLASH_TIMING.reducedFade : SPLASH_TIMING.enter;
    mark.set(withTiming(1, { duration: enter, easing: easeOut }));
    word.set(withDelay(SPLASH_TIMING.wordmarkDelay, withTiming(1, { duration: enter, easing: easeOut })));
    if (!reduced) bar.set(withRepeat(withTiming(1, { duration: SPLASH_TIMING.loaderSweep, easing: onScreen }), -1, true));
  };

  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setMinDone(true), SPLASH_TIMING.minVisible);
    return () => clearTimeout(id);
  }, [shown]);

  useEffect(() => {
    if (!leaving) return;
    fade.set(withTiming(0, { duration: SPLASH_TIMING.exit, easing: easeOut }));
    const id = setTimeout(() => {
      cancelAnimation(bar);
      done.current();
    }, SPLASH_TIMING.exit);
    return () => clearTimeout(id);
  }, [leaving, fade, bar]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: mark.get(),
    transform: [{ scale: reduced ? 1 : 0.94 + 0.06 * mark.get() }],
  }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.get() }));
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateX: bar.get() * (TRACK.width - TRACK.bar) }] }));

  return (
    <Animated.View
      testID="animated-splash"
      onLayout={onFirstLayout}
      pointerEvents={leaving ? 'none' : 'auto'}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Bluemoon Engineering"
      accessibilityState={{ busy: !leaving }}
      style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG[scheme], alignItems: 'center', justifyContent: 'center' }, overlayStyle]}>
      <Animated.View style={markStyle}>
        <BrandMark size={MARK_HEIGHT} scheme={scheme} />
      </Animated.View>
      <Animated.View style={[{ marginTop: space.lg }, wordStyle]}>
        <BrandWordmark width={WORDMARK_WIDTH} scheme={scheme} />
      </Animated.View>
      <Animated.View style={[{ marginTop: space.xl, height: 20, justifyContent: 'center' }, wordStyle]}>
        {reduced ? (
          <ActivityIndicator testID="splash-spinner" size="small" color={c.primary} />
        ) : (
          <View
            testID="splash-loader"
            style={{ width: TRACK.width, height: TRACK.height, borderRadius: TRACK.height / 2, backgroundColor: c.primarySoft, overflow: 'hidden' }}>
            <Animated.View style={[{ width: TRACK.bar, height: TRACK.height, borderRadius: TRACK.height / 2, backgroundColor: c.primary }, barStyle]} />
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}
