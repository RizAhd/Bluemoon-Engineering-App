import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { Delete } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { hairline, radius, space, useColors, useMotion } from '@/theme';

const KEY = 64;
const MAX_DIGITS = 6;

/**
 * The PIN dots: filled for each typed digit. With `slots` (the known PIN length) the empty ones show too;
 * while a new PIN is being chosen there is no length yet, so only the typed ones show, up to 6.
 * `shake` (a counter) nudges the row sideways after a wrong PIN.
 */
export function PinDots({ count, slots, shake = 0, error }: { count: number; slots?: number | null; shake?: number; error?: boolean }) {
  const c = useColors();
  const m = useMotion();
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  useEffect(() => {
    if (!shake || m.reduced) return;
    x.set(withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 70 }), withTiming(-6, { duration: 60 }), withTiming(0, { duration: 60 })));
  }, [shake, m.reduced, x]);
  const n = slots ?? Math.max(4, count);
  const fill = error ? c.danger : c.primary;
  return (
    <Animated.View style={[{ flexDirection: 'row', gap: space.md, justifyContent: 'center', minHeight: 20, alignItems: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: n }, (_, i) => (
        <View
          key={i}
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: i < count ? fill : c.borderStrong,
            backgroundColor: i < count ? fill : 'transparent',
          }}
        />
      ))}
    </Animated.View>
  );
}

function Key({ label, icon: Icon, onPress, disabled, a11y }: { label?: string; icon?: LucideIcon; onPress: () => void; disabled?: boolean; a11y: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => ({
        width: KEY,
        height: KEY,
        borderRadius: KEY / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.muted : label ? c.surface2 : 'transparent',
        borderWidth: label ? hairline : 0,
        borderColor: c.border,
      })}>
      {Icon ? <Icon size={26} color={disabled ? c.placeholder : c.text} strokeWidth={2} /> : null}
      {label ? (
        <Txt variant="heading" weight="semibold" numeric color={disabled ? 'placeholder' : 'text'}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  );
}

export interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Most digits accepted (the known PIN length when checking, 6 when choosing). */
  maxLength?: number;
  disabled?: boolean;
  /** Bottom-left key, e.g. the fingerprint. */
  extra?: { icon: LucideIcon; label: string; onPress: () => void };
}

/** A 3 × 4 number pad with 64 dp keys. Numbers only; no system keyboard, so nothing is predicted or remembered. */
export function PinPad({ value, onChange, maxLength = MAX_DIGITS, disabled, extra }: PinPadProps) {
  const t = useT();
  const add = (d: string) => {
    if (value.length < maxLength) onChange(value + d);
  };
  const rows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];
  return (
    <View style={{ gap: space.md, alignItems: 'center' }}>
      {rows.map((row) => (
        <View key={row[0]} style={{ flexDirection: 'row', gap: space.xl }}>
          {row.map((d) => (
            <Key key={d} label={d} a11y={d} onPress={() => add(d)} disabled={disabled} />
          ))}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.xl }}>
        {extra ? <Key icon={extra.icon} a11y={extra.label} onPress={extra.onPress} disabled={disabled} /> : <View style={{ width: KEY, height: KEY, borderRadius: radius.pill }} />}
        <Key label="0" a11y="0" onPress={() => add('0')} disabled={disabled} />
        <Key icon={Delete} a11y={t('pinDeleteDigit')} onPress={() => onChange(value.slice(0, -1))} disabled={disabled || !value} />
      </View>
    </View>
  );
}
