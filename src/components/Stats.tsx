import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { hairline, radius, space, useColors, useLayout } from '@/theme';

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
          borderWidth: hairline,
          borderColor: c.border,
          backgroundColor: pressed && onPress ? c.muted : c.card,
        },
        style,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.xs }}>
        <Txt eyebrow numberOfLines={2} style={{ flexShrink: 1 }}>
          {label}
        </Txt>
        {onPress ? <ChevronRight size={14} color={c.textMuted} strokeWidth={2} style={{ marginTop: 2 }} /> : null}
      </View>
      <Txt variant="title" weight="bold" numeric adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} color={tone}>
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

/** How much of the contract value has been spent. Colour plus a % label, never colour alone. */
export function ContractBar({ spent, contract }: { spent: number; contract: number }) {
  const t = useT();
  const c = useColors();
  const pct = contract > 0 ? Math.round((spent / contract) * 100) : 0;
  const over = pct >= 100;
  const fill = over ? c.danger : pct > 85 ? c.warning : c.slate;
  return (
    <View style={{ gap: space.xs }} accessibilityLabel={`${pct}% ${t('contract')}`}>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: c.border, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 5, backgroundColor: fill }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Txt variant="caption" color={over ? 'danger' : 'textMuted'} weight="semibold" numeric>
          {pct} %
        </Txt>
        {/* "කොන්ත්‍රාත්තුව Rs 9,999,999,999" is wider than a 320 phone leaves beside the %: it wraps on the right. */}
        <Txt variant="caption" color="textMuted" weight="semibold" numeric style={{ flexShrink: 1, textAlign: 'right' }}>
          {t('contract')} {formatLKR(contract)}
        </Txt>
      </View>
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
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.border, overflow: 'hidden' }}>
            <View style={{ width: `${(r.cents / max) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: c.slate }} />
          </View>
        </View>
      ))}
    </View>
  );
}
