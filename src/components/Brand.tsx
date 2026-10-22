import { Image } from 'expo-image';
import { type StyleProp, type ImageStyle } from 'react-native';

import { useScheme } from '@/theme';

/**
 * The Bluemoon logo. Navy artwork on light screens, white on dark ones, so it is always
 * readable. Both files are transparent PNGs cut from the owner's logo
 * (assets/brand/bluemoon-logo-source.jpg; regenerate with the brand asset script).
 */
const MARK = {
  light: require('../../assets/images/logo-mark.png'),
  dark: require('../../assets/images/logo-mark-white.png'),
} as const;

const LOCKUP = {
  light: require('../../assets/images/logo.png'),
  dark: require('../../assets/images/logo-white.png'),
} as const;

/** "BLUEMOON / ENGINEERING (PVT) LTD" cut from the lockup (the splash shows it under the mark). */
const WORDMARK = {
  light: require('../../assets/images/splash-wordmark.png'),
  dark: require('../../assets/images/splash-wordmark-white.png'),
} as const;

const MARK_ASPECT = 640 / 653;
const LOCKUP_ASPECT = 1200 / 1211;
const WORDMARK_ASPECT = 600 / 156;

type Scheme = 'light' | 'dark';

/**
 * The building mark alone, e.g. next to a screen title. `size` is the height in dp.
 * `scheme` overrides the app theme (the splash follows the system, like the native splash).
 */
export function BrandMark({ size = 32, style, scheme: forced }: { size?: number; style?: StyleProp<ImageStyle>; scheme?: Scheme }) {
  const appScheme = useScheme();
  const scheme = forced ?? appScheme;
  return (
    <Image
      source={MARK[scheme]}
      contentFit="contain"
      accessibilityRole="image"
      accessibilityLabel="Bluemoon Engineering"
      style={[{ height: size, width: size * MARK_ASPECT }, style]}
    />
  );
}

/** The full logo (building + "BLUEMOON ENGINEERING (PVT) LTD"). `width` is in dp. */
export function BrandLogo({ width = 200, style }: { width?: number; style?: StyleProp<ImageStyle> }) {
  const scheme = useScheme();
  return (
    <Image
      source={LOCKUP[scheme]}
      contentFit="contain"
      accessibilityRole="image"
      accessibilityLabel="Bluemoon Engineering (Pvt) Ltd"
      style={[{ width, height: width / LOCKUP_ASPECT }, style]}
    />
  );
}

/** The company name alone, as drawn in the logo. `width` is in dp; `scheme` as for BrandMark. */
export function BrandWordmark({ width = 144, scheme, style }: { width?: number; scheme: Scheme; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={WORDMARK[scheme]}
      contentFit="contain"
      accessibilityRole="image"
      accessibilityLabel="Bluemoon Engineering (Pvt) Ltd"
      style={[{ width, height: width / WORDMARK_ASPECT }, style]}
    />
  );
}
