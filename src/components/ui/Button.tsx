import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { hairline, radius, space, touch, touchMin, useColors, type Palette } from '@/theme';

import { Txt } from './Txt';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  full?: boolean;
  /** 48 tall with a body-size label; for inline and secondary actions. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Spoken label when it should say more than the visible text. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * The one button. 56 tall (48 compact), radius 10, 1 dp border always (so nothing
 * shifts between kinds), press = colour change only, focus = a 2 dp ring outside.
 * Disabled never uses opacity: it switches to the disabled tokens instead.
 */
export function Button({ label, onPress, kind = 'primary', icon: Icon, loading, disabled, full, compact, style, accessibilityLabel, testID }: ButtonProps) {
  const c = useColors();
  const [focus, setFocus] = useState(false);
  const off = !!disabled || !!loading;

  const spec = {
    primary: { bg: c.primary, pressed: c.primaryPressed, fg: c.onPrimary, border: 'transparent', offBg: c.surface2, offBorder: 'transparent' },
    secondary: { bg: c.card, pressed: c.muted, fg: c.text, border: c.borderStrong, offBg: c.card, offBorder: c.border },
    ghost: { bg: 'transparent', pressed: c.primarySoft, fg: c.primary, border: 'transparent', offBg: 'transparent', offBorder: 'transparent' },
    danger: { bg: c.card, pressed: c.dangerSoft, fg: c.danger, border: c.danger, offBg: c.card, offBorder: c.border },
  }[kind];
  const fg = disabled ? c.placeholder : spec.fg;

  return (
    <View
      style={[
        {
          alignSelf: full ? 'stretch' : 'auto',
          padding: 2,
          borderRadius: radius.md + 2,
          borderWidth: 2,
          borderColor: focus && !off ? c.focusRing : 'transparent',
          margin: -2,
        },
        style,
      ]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: off, busy: !!loading }}
        disabled={off}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={({ pressed }) => ({
          minHeight: compact ? touchMin : touch,
          paddingHorizontal: compact ? space.lg : 20,
          borderRadius: radius.md,
          borderWidth: hairline,
          borderColor: disabled ? spec.offBorder : spec.border,
          backgroundColor: disabled ? spec.offBg : pressed && !off ? spec.pressed : spec.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
        })}>
        {Icon ? <Icon size={compact ? 20 : 22} color={fg} strokeWidth={2} style={{ opacity: loading ? 0 : 1 }} /> : null}
        <View style={{ flexShrink: 1, opacity: loading ? 0 : 1 }}>
          <Txt weight="semibold" variant={compact ? 'body' : 'bodyLg'} style={{ color: fg }} numberOfLines={2} center>
            {label}
          </Txt>
        </View>
        {loading ? (
          <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={spec.fg} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: this is what a screen reader says. */
  label: string;
  onPress: () => void;
  /** 48 by default; 44 inside headers. */
  size?: number;
  /** Icon colour token. `danger` for the form-header trash; `onHeader` inside TabHeader / native headers. */
  tone?: 'text' | 'textMuted' | 'onHeader' | 'danger' | 'primary';
  /** Pressed background token; `headerDeep` inside headers. */
  pressedBg?: keyof Palette;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Round icon button with a required label for screen readers. 48 × 48 (44 in headers), icon 24. */
export function IconButton({ icon: Icon, label, onPress, size = touchMin, tone = 'text', pressedBg = 'muted', disabled, style }: IconButtonProps) {
  const c = useColors();
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? c[pressedBg] : 'transparent',
          borderWidth: 2,
          borderColor: focus ? c.focusRing : 'transparent',
        },
        style,
      ]}>
      <Icon size={24} color={disabled ? c.placeholder : c[tone]} strokeWidth={2} />
    </Pressable>
  );
}

/** Header icon button (44, `onHeader` icon, `headerDeep` pressed). Kept for existing screens; same as `IconButton size={44}`. */
export function HeaderButton({ icon, label, onPress, tone = 'onHeader' }: { icon: LucideIcon; label: string; onPress: () => void; tone?: IconButtonProps['tone'] }) {
  return <IconButton icon={icon} label={label} onPress={onPress} size={44} tone={tone} pressedBg="headerDeep" />;
}
