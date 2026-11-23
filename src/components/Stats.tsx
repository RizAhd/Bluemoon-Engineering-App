import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors, useElevation, useLayout, useScheme } from '@/theme';

export type StatTone = 'text' | 'danger' | 'success' | 'warning';

export interface StatProps {
  label: string;
  value: string;
  onPress?: () => void;
  tone?: StatTone;
  /** Optional second line, e.g. "6 workers". */
  caption?: string;
  style?: StyleProp<ViewStyle>;
}

/** Number tile: eyebrow label, title 20/700 numeric value; tappable tiles show a chevron. */
export function Stat({ label, value, onPress, tone = 'text', caption, style }: StatProps) {
  const c = useColors();
  const lift = useElevation('card');
  const dark = useScheme() === 'dark';
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} ${value}${caption ? ` ${caption}` : ''}`}
      android_ripple={onPress ? { color: c.muted } : undefined}
      style={({ pressed }) => [
        {
          flex: 1,
          // Tiles wrap below this width (see Tiles), so an amount always has room; 3 tiles on a phone become 2 + 1.
          minWidth: STAT_MIN_WIDTH,
          minHeight: 84,
          gap: space.xs,
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: dark ? 1 : 0,
          borderColor: c.border,
          backgroundColor: pressed && onPress ? c.muted : c.card,
          ...lift,
        },
        style,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.xs }}>
        <Txt variant="caption" weight="semibold" color="textMuted" numberOfLines={2} style={{ flexShrink: 1 }}>
          {label}
        </Txt>
        {onPress ? <ChevronRight size={14} color={c.textMuted} strokeWidth={2} style={{ marginTop: 2 }} /> : null}
      </View>
      <Txt variant="title" weight="bold" numeric adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} color={tone} style={{ fontSize: 20, lineHeight: 26 }}>
        {value}
      </Txt>
      {caption ? (
        <Txt variant="caption" color="textMuted" numberOfLines={1}>
          {caption}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/** Narrowest a Stat tile gets before the row wraps: room for "Rs 1,234,567" at 70 %. */
const STAT_MIN_WIDTH = 136;

/**
 * Lays Stat tiles out in one row (gap 12, equal flex); stacks them when the window is under 340 wide. A row
 * that cannot give every tile 136 dp (three tiles on a phone, large text) wraps, and the last tile takes the
 * whole next line, instead of cutting the amounts.
 */
export function Tiles({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { stackTiles } = useLayout();
  return <View style={[{ flexDirection: stackTiles ? 'column' : 'row', flexWrap: stackTiles ? 'nowrap' : 'wrap', gap: space.md }, style]}>{children}</View>;
}

/**
 * How much of the contract value has been spent. Colour plus a % label, never colour alone.
 * `onHero`: white on the blue hero (a white fill on a glass track; over the contract it turns amber).
 */
export function ContractBar({ spent, contract, onHero }: { spent: number; contract: number; onHero?: boolean }) {
  const t = useT();
  const c = useColors();
  const ratio = contract > 0 ? spent / contract : 0;
  // 99.5 % is not "100 %" and red: the figure only reaches 100 when the contract really is used up
  const over = ratio >= 1;
  const pct = over ? Math.round(ratio * 100) : Math.min(99, Math.round(ratio * 100));
  const fill = onHero ? (over || ratio > 0.85 ? c.amber : c.heroWhite) : over ? c.danger : ratio > 0.85 ? c.warning : c.primary;
  const track = onHero ? c.headerSoft : c.surface2;
  const label = onHero ? 'onHeaderMuted' : over ? 'danger' : 'textMuted';
  return (
    <View style={{ gap: space.xs + 2 }} accessibilityLabel={`${pct}% ${t('contract')}`}>
      <View style={{ height: onHero ? 8 : 10, borderRadius: 5, backgroundColor: track, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 5, backgroundColor: fill }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Txt variant="caption" color={label} weight="semibold" numeric>
          {/* something spent but under half a percent reads "<1 %", never a misleading "0 %" */}
          {spent > 0 && pct === 0 ? '<1' : pct} %
        </Txt>
        {/* "කොන්ත්‍රාත්තුව Rs 9,999,999,999" is wider than a 320 phone leaves beside the %: it wraps on the right. */}
        <Txt variant="caption" color={onHero ? 'onHeaderMuted' : 'textMuted'} weight="semibold" numeric style={{ flexShrink: 1, textAlign: 'right' }}>
          {t('contract')} {formatLKR(contract)}
        </Txt>
      </View>
    </View>
  );
}

/** How much of the project value the client has paid. Green fill plus a % label, never colour alone. */
export function ReceivedBar({ percent, received, over }: { percent: number; received: number; over: boolean }) {
  const t = useT();
  const c = useColors();
  return (
    <View style={{ gap: space.xs }} accessibilityLabel={`${percent}% ${t('receivedSoFar')}`}>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: c.surface2, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', borderRadius: 5, backgroundColor: over ? c.warning : c.success }} />
      </View>
      <Txt variant="caption" color={over ? 'warning' : 'textMuted'} weight="semibold" numeric>
        {/* something received but under one percent reads "<1 %", never a misleading "0 %" */}
        {received > 0 && percent === 0 ? '<1' : percent} %
      </Txt>
    </View>
  );
}

/** Horizontal bars for spend by category. Values are labelled, so no legend is needed. */
export function CategoryBars({ rows }: { rows: { label: string; cents: number }[] }) {
  const c = useColors();
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <View style={{ gap: space.md }}>
      {rows.map((r) => (
        <View key={r.label} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <Txt style={{ flex: 1 }} numberOfLines={1}>
              {r.label}
            </Txt>
            <Txt weight="semibold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 0, maxWidth: '60%' }}>
              {formatLKR(r.cents)}
            </Txt>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: 'hidden' }}>
            <View style={{ width: `${(r.cents / max) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: c.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}
