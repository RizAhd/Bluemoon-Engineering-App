import type { LucideIcon } from 'lucide-react-native';
import { CheckCircle2 } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, useColors, type Palette } from '@/theme';

import { Txt } from './Txt';

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.md }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: c.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon size={34} color={c.primary} strokeWidth={2} />
      </View>
      <Txt variant="title" weight="bold" center>
        {title}
      </Txt>
      <Txt color="textMuted" center style={{ maxWidth: 320 }}>
        {hint}
      </Txt>
      {action ? <View style={{ marginTop: space.sm, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Badge({ label, tone = 'slate', icon: Icon }: { label: string; tone?: 'slate' | 'success' | 'warning' | 'danger' | 'primary'; icon?: LucideIcon }) {
  const c = useColors();
  const bg: Record<string, keyof Palette> = {
    slate: 'muted',
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
        gap: 4,
        alignSelf: 'flex-start',
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: c[bg[tone]],
      }}>
      {Icon ? <Icon size={14} color={fg} strokeWidth={2.4} /> : null}
      <Txt variant="caption" weight="semibold" style={{ color: fg }}>
        {label}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------- toast

type ToastMsg = { id: number; text: string };
let push: ((text: string) => void) | null = null;
let counter = 0;

/** Show a short confirmation, e.g. "Saved on phone". */
export function toast(text: string) {
  push?.(text);
}

export function ToastHost() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<ToastMsg | null>(null);

  useEffect(() => {
    push = (text) => setMsg({ id: ++counter, text });
    return () => {
      push = null;
    };
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);

  if (!msg) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 96, alignItems: 'center' }}>
      <Animated.View
        key={msg.id}
        entering={FadeInDown.duration(180)}
        exiting={FadeOutDown.duration(140)}
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          backgroundColor: c.slate,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.pill,
          maxWidth: '90%',
        }}>
        <CheckCircle2 size={20} color={c.onSlate} />
        <Txt weight="semibold" style={{ color: c.onSlate }}>
          {msg.text}
        </Txt>
      </Animated.View>
    </View>
  );
}
