import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
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

import { space, useMotion } from '@/theme';

const LOGO = require('../../assets/images/splash-logo-white.png') as number;

/**
 * One brand background in both schemes, the same as the native splash in app.json. The native splash is drawn
 * before the app knows the user's Light / Dark choice, so a scheme-following splash would flash the wrong
 * colour for half the users. It is the Blueprint hero blue, so it fades straight into the blue lock screen or
 * the blue header of Today with no change of colour.
 */
export const SPLASH_BG = { light: '#1E4CDC', dark: '#1E4CDC' } as const;

/** The loader on the blue: a faint white track with a white bar. */
export const SPLASH_LOADER = { track: 'rgba(255,255,255,0.28)', bar: '#FFFFFF' } as const;

/** The splash sequence in ms. `minVisible` counts from the overlay's first frame. */
export const SPLASH_TIMING = { loaderDelay: 300, loaderIn: 300, minVisible: 900, exit: 280, reducedFade: 200, loaderSweep: 700 } as const;

/** The native splash logo: app.json `imageWidth` 120 dp, the PNG's own 1000 × 1009 shape. */
export const SPLASH_LOGO = { width: 120, height: 121 } as const;
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
 * The in-app continuation of the native splash. Its first frame is the native splash exactly — the same navy,
 * the same logo image at the same size in the same place — so hiding the native one on that frame shows no
 * change at all: nothing blinks, jumps or fades in twice. Then a slim loader appears under the logo, and once
 * the app is ready (at least 900 ms) the logo eases up a touch while the whole overlay fades into the app,
 * without catching touches. Reduced motion: a system spinner and a plain fade.
 */
export function AnimatedSplash({ ready, onDone }: AnimatedSplashProps) {
  // Reanimated's value is known on the first frame; the app's hook also follows later changes.
  const systemReduced = useReducedMotion();
  const appReduced = useMotion().reduced;
  const reduced = systemReduced || appReduced;
  const [shown, setShown] = useState(false);
  const [minDone, setMinDone] = useState(false);
  const leaving = ready && minDone;

  const loader = useSharedValue(0);
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
    loader.set(withDelay(SPLASH_TIMING.loaderDelay, withTiming(1, { duration: reduced ? SPLASH_TIMING.reducedFade : SPLASH_TIMING.loaderIn, easing: easeOut })));
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
  // the logo rises 1.04× as the overlay fades: the app seems to come forward out of the brand
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : 1 + 0.04 * (1 - fade.get()) }] }));
  const loaderStyle = useAnimatedStyle(() => ({ opacity: loader.get() }));
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
      style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG.dark, alignItems: 'center', justifyContent: 'center' }, overlayStyle]}>
      <Animated.View style={logoStyle}>
        <Image source={LOGO} style={SPLASH_LOGO} resizeMode="contain" fadeDuration={0} accessibilityLabel="Bluemoon Engineering (Pvt) Ltd" />
      </Animated.View>
      {/* Under the logo without moving it: the logo stays exactly where the native splash put it. */}
      <Animated.View
        style={[{ position: 'absolute', top: '50%', marginTop: SPLASH_LOGO.height / 2 + space.xl, height: 20, justifyContent: 'center' }, loaderStyle]}>
        {reduced ? (
          <ActivityIndicator testID="splash-spinner" size="small" color={SPLASH_LOADER.bar} />
        ) : (
          <View testID="splash-loader" style={{ width: TRACK.width, height: TRACK.height, borderRadius: TRACK.height / 2, backgroundColor: SPLASH_LOADER.track, overflow: 'hidden' }}>
            <Animated.View style={[{ width: TRACK.bar, height: TRACK.height, borderRadius: TRACK.height / 2, backgroundColor: SPLASH_LOADER.bar }, barStyle]} />
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}
