import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { motion, radius, space, touch, useColors } from '@/theme';

import { Txt } from './Txt';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress: () => void;
  kind?: Kind;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, onPress, kind = 'primary', icon: Icon, loading, disabled, full, compact, style }: Props) {
  const c = useColors();
  const colors = {
    primary: { bg: c.primary, pressed: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.card, pressed: c.muted, fg: c.text, border: c.borderStrong },
    ghost: { bg: 'transparent', pressed: c.muted, fg: c.primary, border: 'transparent' },
    danger: { bg: c.card, pressed: c.dangerSoft, fg: c.danger, border: c.danger },
  }[kind];
  const off = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        {
          minHeight: compact ? 44 : touch,
          paddingHorizontal: compact ? space.md : space.lg,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.pressed : colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
          opacity: disabled ? 0.45 : 1,
          alignSelf: full ? 'stretch' : 'auto',
          transform: [{ scale: pressed && !off ? motion.pressScale : 1 }],
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <>
          {Icon ? <Icon size={compact ? 18 : 22} color={colors.fg} strokeWidth={2.2} /> : null}
          <View style={{ flexShrink: 1 }}>
            <Txt weight="semibold" variant={compact ? 'body' : 'bodyLg'} style={{ color: colors.fg }} numberOfLines={2}>
              {label}
            </Txt>
          </View>
        </>
      )}
    </Pressable>
  );
}

/** Round icon button with a required label for screen readers. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  size = 48,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  size?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.muted : 'transparent',
      })}>
      <Icon size={24} color={c.text} strokeWidth={2} />
    </Pressable>
  );
}

/** White icon button for the blue screen headers. */
export function HeaderButton({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.headerSoft : 'transparent',
      })}>
      <Icon size={22} color={c.onHeader} strokeWidth={2.2} />
    </Pressable>
  );
}
