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

const MARK_ASPECT = 640 / 653;
const LOCKUP_ASPECT = 1200 / 1211;

/** The building mark alone, e.g. next to a screen title. `size` is the height in dp. */
export function BrandMark({ size = 32, style }: { size?: number; style?: StyleProp<ImageStyle> }) {
  const scheme = useScheme();
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
