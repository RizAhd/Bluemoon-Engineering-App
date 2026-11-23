import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { hairline, radius, space, touch, touchMin, useColors, useElevation, type Palette } from '@/theme';

import { usePressScale } from './PressScale';
import { Txt } from './Txt';

/**
 * primary = blue fill · navy = ink fill (Export PDF) · secondary = white outline · soft = blue-50 fill with blue words ·
 * ghost = words only · danger = red outline · hero / heroSoft = the white and the glass button on the blue hero.
 */
export type ButtonKind = 'primary' | 'navy' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'hero' | 'heroSoft';

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
  const press = usePressScale();
  const lift = useElevation('field');
  const [focus, setFocus] = useState(false);
  const off = !!disabled || !!loading;

  const spec = {
    // a disabled primary is a pale blue block with white words, as in the design (never opacity)
    primary: { bg: c.fill, pressed: c.fillPressed, fg: c.onFill, border: 'transparent', offBg: c.primarySoft2, offBorder: 'transparent', offFg: c.onFill },
    navy: { bg: c.slate, pressed: c.slatePressed, fg: c.onSlate, border: 'transparent', offBg: c.surface2, offBorder: 'transparent', offFg: c.placeholder },
    secondary: { bg: c.card, pressed: c.muted, fg: c.text, border: c.borderStrong, offBg: c.card, offBorder: c.border, offFg: c.placeholder },
    soft: { bg: c.primarySoft, pressed: c.primarySoft2, fg: c.primary, border: 'transparent', offBg: c.surface2, offBorder: 'transparent', offFg: c.placeholder },
    ghost: { bg: 'transparent', pressed: c.primarySoft, fg: c.primary, border: 'transparent', offBg: 'transparent', offBorder: 'transparent', offFg: c.placeholder },
    danger: { bg: c.card, pressed: c.dangerSoft, fg: c.danger, border: c.danger, offBg: c.card, offBorder: c.border, offFg: c.placeholder },
    // the hero is blue in both schemes, so its white button keeps the light colours in dark mode too
    hero: { bg: c.heroWhite, pressed: c.heroWhitePressed, fg: c.onHeroWhite, border: 'transparent', offBg: c.headerSoft, offBorder: 'transparent', offFg: c.onHeaderMuted },
    heroSoft: { bg: c.headerSoft, pressed: c.headerDeep, fg: c.onHeader, border: c.headerLine, offBg: c.headerSoft, offBorder: 'transparent', offFg: c.onHeaderMuted },
  }[kind];
  const fg = disabled ? spec.offFg : spec.fg;
  // solid and outlined buttons sit on a soft shadow in light mode; words-only and glass buttons do not
  const shadow = kind === 'ghost' || kind === 'heroSoft' || kind === 'soft' || disabled ? null : lift;

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
          // A ghost button reads as text: pull it out by its own padding so its words line up with
          // the text around it instead of sitting indented inside cards.
          ...(kind === 'ghost' && !full ? { marginHorizontal: -((compact ? space.lg : 20) + 2) } : null),
        },
        style,
      ]}>
      <Animated.View style={press.style}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled: off, busy: !!loading }}
          disabled={off}
          {...press.handlers}
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
            ...shadow,
          })}>
          {Icon ? <Icon size={compact ? 18 : 20} color={fg} strokeWidth={2.2} style={{ opacity: loading ? 0 : 1 }} /> : null}
          <View style={{ flexShrink: 1, opacity: loading ? 0 : 1 }}>
            <Txt weight="bold" variant={compact ? 'body' : 'bodyLg'} style={{ color: fg }} numberOfLines={2} center>
              {label}
            </Txt>
          </View>
          {loading ? (
            <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={spec.fg} />
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
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
  /** Icon colour token. `danger` for the form-header trash; `onHeader` on the blue hero. */
  tone?: 'text' | 'textMuted' | 'onHeader' | 'danger' | 'primary';
  /** Pressed background token; `headerDeep` on the hero. */
  pressedBg?: keyof Palette;
  /**
   * round = no box (default) · glass = a translucent rounded square on the blue hero ·
   * boxed = a white rounded square with a hairline edge (back button and actions on white screens).
   */
  shape?: 'round' | 'glass' | 'boxed';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Icon button with a required label for screen readers. 48 × 48 (44 in headers), icon 22. */
export function IconButton({ icon: Icon, label, onPress, size = touchMin, tone = 'text', pressedBg = 'muted', shape = 'round', disabled, style }: IconButtonProps) {
  const c = useColors();
  const square = shape !== 'round';
  const rest = shape === 'glass' ? c.headerSoft : shape === 'boxed' ? c.card : 'transparent';
  const edge = shape === 'glass' ? c.headerLine : shape === 'boxed' ? c.border : null;
  const press = usePressScale();
  const [focus, setFocus] = useState(false);
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        hitSlop={4}
        {...press.handlers}
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
            borderRadius: square ? radius.md : size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? c[pressedBg] : rest,
            borderWidth: square ? hairline : 2,
            borderColor: focus ? c.focusRing : (edge ?? 'transparent'),
          },
          style,
        ]}>
        <Icon size={square ? 20 : 22} color={disabled ? c.placeholder : c[tone]} strokeWidth={2} />
      </Pressable>
    </Animated.View>
  );
}

/** Action in a white stack header (44, boxed, `text` icon). On the blue hero use `IconButton shape="glass" tone="onHeader"`. */
export function HeaderButton({ icon, label, onPress, tone = 'text' }: { icon: LucideIcon; label: string; onPress: () => void; tone?: IconButtonProps['tone'] }) {
  return <IconButton icon={icon} label={label} onPress={onPress} size={44} tone={tone} shape="boxed" />;
}
