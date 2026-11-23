import { router } from 'expo-router';
import { Building2, ChevronLeft, ChevronRight, HardHat, Receipt, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/form';
import { Card, Divider, ListRow } from '@/components/ui/layout';
import { SplitAmount } from '@/components/ui/SplitAmount';
import { Txt } from '@/components/ui/Txt';
import { useQuery } from '@/db';
import { useT } from '@/i18n';
import { addDays, formatDay, monthName, periodRange, shiftPeriod, type Period } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { radius, space, useColors, useLayout } from '@/theme';

interface Row {
  project_id: string;
  name: string;
  expense_cents: number;
  labour_cents: number;
  paid_cents: number;
}

/**
 * The money of one day, week or month: expenses, labour earned and the two together, with ‹ › to step back
 * through earlier periods. For all projects it also lists each project's share, so two or three sites
 * running at once can be compared at a glance.
 */
export function PeriodSummary({ pid, today }: { pid: string | null; today: string }) {
  const t = useT();
  const c = useColors();
  const { stackTiles } = useLayout();
  const [period, setPeriod] = useState<Period>('day');
  // null follows today (so the card moves on at midnight); a date is a period the owner stepped back to
  const [picked, setPicked] = useState<string | null>(null);
  const anchor = picked ?? today;
  const { from, to } = periodRange(period, anchor);
  const isCurrent = from <= today && today <= to;

  const rows = useQuery<Row>(
    `SELECT p.id AS project_id, p.name,
            COALESCE(e.s, 0) AS expense_cents, COALESCE(w.work, 0) AS labour_cents, COALESCE(w.paid, 0) AS paid_cents
       FROM projects p
       LEFT JOIN (SELECT project_id, SUM(amount_cents) AS s FROM expenses
                   WHERE deleted_at IS NULL AND day BETWEEN ? AND ? GROUP BY project_id) e ON e.project_id = p.id
       LEFT JOIN (SELECT project_id, SUM(CASE WHEN kind = 'work' THEN amount_cents END) AS work,
                         SUM(CASE WHEN kind != 'work' THEN amount_cents END) AS paid
                    FROM wage_entries WHERE deleted_at IS NULL AND day BETWEEN ? AND ? GROUP BY project_id) w ON w.project_id = p.id
      WHERE p.deleted_at IS NULL ${pid ? 'AND p.id = ?' : ''}
      ORDER BY COALESCE(e.s, 0) + COALESCE(w.work, 0) DESC, p.name COLLATE NOCASE`,
    pid ? [from, to, from, to, pid] : [from, to, from, to],
  );
  const sum = rows.reduce(
    (a, r) => ({ exp: a.exp + r.expense_cents, labour: a.labour + r.labour_cents, paid: a.paid + r.paid_cents }),
    { exp: 0, labour: 0, paid: 0 },
  );
  const busy = rows.filter((r) => r.expense_cents + r.labour_cents > 0);

  const label =
    period === 'day'
      ? anchor === today
        ? t('today')
        : anchor === addDays(today, -1)
          ? t('yesterday')
          : formatDay(anchor)
      : period === 'week'
        ? isCurrent
          ? t('thisWeek')
          : `${formatDay(from)} – ${formatDay(to)}`
        : isCurrent
          ? t('thisMonth')
          : monthName(from);
  const range = period === 'day' ? formatDay(anchor) : `${formatDay(from)} – ${formatDay(to)}`;

  const step = (by: -1 | 1) => {
    const next = shiftPeriod(period, anchor, by);
    const r = periodRange(period, next);
    setPicked(r.from <= today && today <= r.to ? null : next);
  };

  return (
    <Card gap={space.lg}>
      <Txt variant="title" weight="bold" accessibilityRole="header">
        {t('summary')}
      </Txt>
      <Segmented
        options={[
          { value: 'day', label: t('periodDay') },
          { value: 'week', label: t('periodWeek') },
          { value: 'month', label: t('periodMonth') },
        ]}
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setPicked(null);
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <IconButton icon={ChevronLeft} label={t('previousPeriod')} size={44} shape="boxed" onPress={() => step(-1)} style={{ backgroundColor: c.surface2, borderColor: 'transparent' }} />
        <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLiveRegion="polite">
          <Txt weight="bold" center numberOfLines={1}>
            {label}
          </Txt>
          {label !== range ? (
            <Txt variant="caption" color="textMuted" center numberOfLines={1}>
              {range}
            </Txt>
          ) : null}
        </View>
        <IconButton
          icon={ChevronRight}
          label={t('nextPeriod')}
          size={44}
          shape="boxed"
          onPress={() => step(1)}
          disabled={isCurrent}
          style={{ backgroundColor: c.surface2, borderColor: 'transparent' }}
        />
      </View>
      {/* Blueprint: labour earned on a blue tile, expenses on a soft one; both open their tab */}
      <View style={{ flexDirection: stackTiles ? 'column' : 'row', gap: space.md }}>
        <SummaryTile
          primary
          icon={HardHat}
          label={t('labour')}
          value={formatLKR(sum.labour)}
          caption={`${t('paidToWorkers')} ${formatLKR(sum.paid)}`}
          onPress={() => router.push('/(tabs)/workers')}
        />
        <SummaryTile icon={Receipt} label={t('expenses')} value={formatLKR(sum.exp)} onPress={() => router.push('/(tabs)/expenses')} />
      </View>
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
        <Txt color="textMuted" weight="semibold" style={{ flexShrink: 1 }}>
          {t(`total_${period}`)}
        </Txt>
        <Txt variant="title" weight="bold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 22, lineHeight: 28 }}>
          {formatLKR(sum.exp + sum.labour)}
        </Txt>
      </View>
      {!pid && busy.length ? (
        <>
          <Divider />
          {busy.map((r) => (
            <ListRow
              key={r.project_id}
              icon={Building2}
              title={r.name}
              subtitle={`${t('expenses')} ${formatLKR(r.expense_cents)} · ${t('labour')} ${formatLKR(r.labour_cents)}`}
              value={formatLKR(r.expense_cents + r.labour_cents)}
              onPress={() => router.push(`/project/${r.project_id}`)}
            />
          ))}
        </>
      ) : null}
      {sum.exp + sum.labour === 0 ? (
        <Txt variant="caption" color="textMuted" center>
          {t('nothingInPeriod')}
        </Txt>
      ) : null}
    </Card>
  );
}

/**
 * One figure of the summary: an icon in a small square, the label, the amount ("Rs" smaller) and a caption.
 * `primary` = the blue tile with white words (labour earned); otherwise a soft grey tile.
 */
function SummaryTile({ icon: Icon, label, value, caption, primary, onPress }: { icon: LucideIcon; label: string; value: string; caption?: string; primary?: boolean; onPress: () => void }) {
  const c = useColors();
  const muted = primary ? c.onFill : c.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}${caption ? ` ${caption}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        gap: space.xs,
        padding: space.lg,
        borderRadius: radius.lg - 2,
        backgroundColor: primary ? (pressed ? c.fillPressed : c.fill) : pressed ? c.muted : c.surface2,
      })}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm + 2,
          marginBottom: space.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? c.primaryPressed : c.card,
        }}>
        <Icon size={18} color={primary ? c.onFill : c.primary} strokeWidth={1.9} />
      </View>
      <Txt variant="caption" weight="semibold" numberOfLines={2} style={{ color: muted, opacity: primary ? 0.85 : 1 }}>
        {label}
      </Txt>
      <SplitAmount value={value} size={24} color={primary ? 'onFill' : 'text'} rsColor={primary ? 'onFill' : 'textMuted'} />
      {caption ? (
        <Txt variant="caption" weight="semibold" numeric numberOfLines={2} style={{ color: muted, opacity: primary ? 0.85 : 1 }}>
          {caption}
        </Txt>
      ) : null}
    </Pressable>
  );
}
