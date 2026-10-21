import type { LucideIcon } from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, useColors, type Palette } from '@/theme';

import { Txt } from './Txt';

/** Scrolling page with safe padding and room for the keyboard. */
export function Screen({
  children,
  scroll = true,
  footer,
  padTop = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  padTop?: boolean;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, paddingTop: padTop ? space.lg : 0, gap: space.lg, paddingBottom: space.xxl * 2 }}>
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
      {footer ? (
        <View
          style={{
            padding: space.lg,
            paddingBottom: Math.max(insets.bottom, space.lg),
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.card,
            gap: space.sm,
          }}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: keyof Palette }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: tone ? c[tone] : c.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          padding: space.lg,
          gap: space.md,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
      <Txt variant="title" weight="bold" accessibilityRole="header">
        {title}
      </Txt>
      {action}
    </View>
  );
}

/** Tappable list row: icon, title + subtitle, value on the right. */
export function ListRow({
  icon: Icon,
  iconTone = 'slate',
  title,
  subtitle,
  value,
  valueTone = 'text',
  badge,
  onPress,
}: {
  icon?: LucideIcon;
  iconTone?: keyof Palette;
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: keyof Palette;
  badge?: ReactNode;
  onPress?: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: 64,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? c.muted : c.card,
      })}>
      {Icon ? (
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.md,
            backgroundColor: c.muted,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon size={22} color={c[iconTone]} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="semibold" numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
        {badge}
      </View>
      {value ? (
        <Txt weight="bold" numeric color={valueTone}>
          {value}
        </Txt>
      ) : null}
      {onPress && !value ? <ChevronRight size={20} color={c.textMuted} /> : null}
    </Pressable>
  );
}

/** Groups list rows in one rounded card with hairline dividers. */
export function ListCard({ children }: { children: ReactNode }) {
  const c = useColors();
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: 'hidden', backgroundColor: c.card }}>
      {items.map((child, i) => (
        <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: c.border } : undefined}>
          {child}
        </View>
      ))}
    </View>
  );
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}
