import type { LucideIcon } from 'lucide-react-native';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hairline, motion, radius, space, touchMin, useColors, useLayout, useMotion, type Palette } from '@/theme';

import { Txt } from './Txt';

export { ErrorScreen } from '../ErrorScreen';

// ---------------------------------------------------------------- EmptyState

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  /** One button (primary full width; compact secondary inside cards). Never two blue buttons on one screen. */
  action?: ReactNode;
  /** Inside a card or section: smaller tile and title. */
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, hint, action, compact }: EmptyStateProps) {
  const c = useColors();
  const tile = compact ? 48 : 56;
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? space.xl : space.xxxl, paddingHorizontal: space.lg, gap: space.md }}>
      <View style={{ width: tile, height: tile, borderRadius: radius.lg, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={compact ? 24 : 28} color={c.textMuted} strokeWidth={2} />
      </View>
      <Txt variant={compact ? 'bodyLg' : 'title'} weight="semibold" center>
        {title}
      </Txt>
      {hint ? (
        <Txt color="textMuted" center style={{ maxWidth: 320 }}>
          {hint}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: space.xs, alignSelf: compact ? 'center' : 'stretch' }}>{action}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------- Badge

export type BadgeTone = 'slate' | 'success' | 'warning' | 'danger' | 'primary';

/** 24-tall label with a soft background. Always words, never icon-only, never a pill. `primary` is reserved for "current". */
export function Badge({ label, tone = 'slate', icon: Icon }: { label: string; tone?: BadgeTone; icon?: LucideIcon }) {
  const c = useColors();
  const bg: Record<BadgeTone, keyof Palette> = {
    slate: 'surface2',
    success: 'successSoft',
    warning: 'warningSoft',
    danger: 'dangerSoft',
    primary: 'primarySoft',
  };
  const fg = tone === 'slate' ? c.textMuted : c[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        alignSelf: 'flex-start',
        maxWidth: '100%',
        minHeight: 24,
        paddingHorizontal: space.sm,
        borderRadius: radius.sm,
        backgroundColor: c[bg[tone]],
      }}>
      {Icon ? <Icon size={14} color={fg} strokeWidth={2.4} /> : null}
      <Txt variant="caption" weight="semibold" style={{ color: fg, flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------- toast

export interface ToastOptions {
  /** One tappable word: Undo / Retry. */
  action?: { label: string; onPress: () => void };
  tone?: 'neutral' | 'danger';
  /** Stays until tapped or closed (danger + Retry). */
  sticky?: boolean;
}

type ToastMsg = { id: number; text: string } & ToastOptions;
let push: ((msg: ToastMsg) => void) | null = null;
let counter = 0;

/** Show a short confirmation ("Saved on phone"); with `action` for Undo / Retry; `tone: 'danger'` for failures. */
export function toast(text: string, opts: ToastOptions = {}) {
  push?.({ id: ++counter, text, ...opts });
}

/** Dismiss whatever toast is showing. */
export function hideToast() {
  push?.({ id: -1, text: '' });
}

export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const m = useMotion();
  const { column } = useLayout();
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    push = (next) => setMsg(next.id < 0 ? null : next);
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!msg || msg.sticky) return;
    timer.current = setTimeout(() => setMsg(null), msg.action ? 6000 : 2500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [msg]);

  if (!msg) return null;
  const danger = msg.tone === 'danger';
  const fg = danger ? c.danger : c.onSlate;
  const Icon = danger ? AlertTriangle : CheckCircle2;
  const close = () => setMsg(null);
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: insets.bottom + 148, alignItems: 'center' }}>
      <View pointerEvents="box-none" style={[column, { alignItems: 'center' }]}>
        <Animated.View
          key={msg.id}
          entering={FadeInDown.duration(m.reduced ? m.enter : motion.base)}
          exiting={FadeOutDown.duration(m.reduced ? m.exit : 120)}
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: danger ? c.dangerSoft : c.slate,
            borderWidth: hairline,
            borderColor: danger ? c.danger : c.slate,
            paddingLeft: space.lg,
            paddingRight: msg.action || danger ? space.xs : space.lg,
            paddingVertical: space.xs,
            minHeight: touchMin,
            borderRadius: radius.md,
            maxWidth: '100%',
          }}>
          <Icon size={18} color={fg} strokeWidth={2} />
          <Txt weight="semibold" style={{ color: fg, flexShrink: 1, paddingVertical: space.sm }}>
            {msg.text}
          </Txt>
          {msg.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={msg.action.label}
              hitSlop={{ top: 2, bottom: 2 }}
              onPress={() => {
                close();
                msg.action?.onPress();
              }}
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: space.md, marginLeft: space.sm, justifyContent: 'center', borderRadius: radius.sm, backgroundColor: pressed ? (danger ? c.muted : c.slatePressed) : 'transparent' })}>
              <Txt weight="bold" style={{ color: fg }}>
                {msg.action.label}
              </Txt>
            </Pressable>
          ) : null}
          {danger ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="×"
              hitSlop={2}
              onPress={close}
              style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: pressed ? c.muted : 'transparent' })}>
              <X size={18} color={fg} strokeWidth={2} />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}
