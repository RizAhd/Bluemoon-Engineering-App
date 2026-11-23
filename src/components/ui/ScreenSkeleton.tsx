import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { radius, sizes, space, useColors, useElevation, useLayout, useMotion, useScheme } from '@/theme';

/**
 * The shape of a screen, drawn while the screen slides in: then the real page fades in over it.
 * `hero` = the blue Blueprint header with a card over its edge (tab and detail screens); `plain` = cards only.
 * The bones pulse softly; with reduced motion they stay still.
 */
export function ScreenSkeleton({ variant }: { variant: 'hero' | 'plain' }) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const scheme = useScheme();
  const { gutter, column } = useLayout();
  const lift = useElevation('card');
  const m = useMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (m.reduced) return;
    pulse.set(withRepeat(withTiming(0.55, { duration: 700, easing: Easing.bezier(0.45, 0, 0.55, 1) }), -1, true));
  }, [m.reduced, pulse]);

  // white status-bar icons over the blue, as the hero itself does; the hero takes over when it appears
  useEffect(() => {
    if (variant !== 'hero') return;
    setStatusBarStyle('light');
    return () => setStatusBarStyle(scheme === 'dark' ? 'light' : 'dark');
  }, [variant, scheme]);

  const onHero = 'rgba(255,255,255,0.2)';
  const card = (key: number, lines: DimensionValue[]) => (
    <View key={key} style={[{ backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, flexDirection: 'row', gap: space.md, alignItems: 'center' }, lift]}>
      <Bone pulse={pulse} color={c.surface2} w={sizes.iconSlot} h={sizes.iconSlot} r={radius.md} />
      <View style={{ flex: 1, gap: space.sm }}>
        {lines.map((w, i) => (
          <Bone key={i} pulse={pulse} color={c.surface2} w={w} h={i === 0 ? 16 : 12} />
        ))}
      </View>
    </View>
  );

  return (
    <View
      testID="screen-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('loading')}
      accessibilityState={{ busy: true }}
      style={{ flex: 1, backgroundColor: c.bg }}>
      {variant === 'hero' ? (
        <View style={{ paddingTop: insets.top + space.md, paddingBottom: space.xxxl + space.xl, paddingHorizontal: gutter, borderBottomLeftRadius: radius.xl + 4, borderBottomRightRadius: radius.xl + 4, overflow: 'hidden', backgroundColor: c.header }}>
          <LinearGradient colors={[c.header, c.headerEnd]} start={{ x: 0.1, y: 1 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={[column, { gap: space.lg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: sizes.headerButton }}>
              <Bone pulse={pulse} color={onHero} w="45%" h={26} />
              <View style={{ flex: 1 }} />
              <Bone pulse={pulse} color={onHero} w={sizes.headerButton} h={sizes.headerButton} r={radius.md} />
            </View>
            <Bone pulse={pulse} color={onHero} w="100%" h={52} r={radius.md} />
            <Bone pulse={pulse} color={onHero} w="30%" h={14} />
            <Bone pulse={pulse} color={onHero} w="60%" h={40} />
          </View>
        </View>
      ) : null}
      <View style={[column, { paddingHorizontal: gutter, gap: space.lg, marginTop: variant === 'hero' ? -space.xxxl : space.lg }]}>
        <View style={[{ backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.md }, lift]}>
          <Bone pulse={pulse} color={c.surface2} w="40%" h={16} />
          <Bone pulse={pulse} color={c.surface2} w="100%" h={10} r={radius.pill} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Bone pulse={pulse} color={c.surface2} w="30%" h={30} />
            <Bone pulse={pulse} color={c.surface2} w="30%" h={30} />
            <Bone pulse={pulse} color={c.surface2} w="30%" h={30} />
          </View>
        </View>
        {card(1, ['70%', '45%'])}
        {card(2, ['60%', '35%'])}
        {card(3, ['75%', '40%'])}
      </View>
    </View>
  );
}

function Bone({ pulse, color, w, h, r = radius.sm }: { pulse: SharedValue<number>; color: string; w: DimensionValue; h: number; r?: number }) {
  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: color }, style]} />;
}
