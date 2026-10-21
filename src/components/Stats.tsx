import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors } from '@/theme';

/** Small tappable number tile. */
export function Stat({ label, value, onPress, tone = 'text' }: { label: string; value: string; onPress?: () => void; tone?: 'text' | 'danger' | 'success' }) {
  const c = useColors();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} ${value}`}
      style={({ pressed }) => ({
        flex: 1,
        gap: space.xs,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: pressed ? c.muted : c.card,
      })}>
      <Txt variant="caption" color="textMuted" weight="semibold" numberOfLines={2}>
        {label}
      </Txt>
      <Txt variant="title" weight="bold" numeric adjustsFontSizeToFit numberOfLines={1} color={tone}>
        {value}
      </Txt>
    </Pressable>
  );
}

/** How much of the contract value has been spent. Colour plus a % label, never colour alone. */
export function ContractBar({ spent, contract }: { spent: number; contract: number }) {
  const t = useT();
  const c = useColors();
  const pct = Math.round((spent / contract) * 100);
  const over = spent > contract;
  const fill = over ? c.danger : pct > 85 ? c.warning : c.slate;
  return (
    <View style={{ gap: space.xs }} accessibilityLabel={`${pct}% ${t('contract')}`}>
      <View style={{ height: 12, borderRadius: 6, backgroundColor: c.muted, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', backgroundColor: fill }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="caption" color={over ? 'danger' : 'textMuted'} weight="semibold" numeric>
          {pct}%
        </Txt>
        <Txt variant="caption" color="textMuted" numeric>
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
        <View key={r.label} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
            <Txt style={{ flex: 1 }} numberOfLines={1}>
              {r.label}
            </Txt>
            <Txt weight="semibold" numeric>
              {formatLKR(r.cents)}
            </Txt>
          </View>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: c.muted, overflow: 'hidden' }}>
            <View style={{ width: `${(r.cents / max) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: c.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}
