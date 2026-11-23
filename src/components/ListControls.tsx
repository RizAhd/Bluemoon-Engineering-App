/**
 * The control bar of the list screens (Expenses, Projects, Workers, Estimates): one row of chips under the
 * header with a "Filter & sort" button first, a caption that says what is applied with a one-tap Clear, and
 * the bottom sheet behind the button (Period when the screen keeps it there, Sort, the screen's own filters,
 * Reset and Done).
 *
 * Choices are remembered per screen in the settings table (`list_<screen>_<field>`), so they survive a restart.
 * A choice equal to its default is stored as NULL, so "nothing changed" is the same as "never touched".
 */
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { Calendar, ChevronDown, SlidersHorizontal, X } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button } from '@/components/ui/Button';
import { BottomSheet, Chips, Label, PickerSheet, SheetHeader } from '@/components/ui/form';
import { usePressScale } from '@/components/ui/PressScale';
import { Txt } from '@/components/ui/Txt';
import { setSetting, tx, useQuery } from '@/db';
import { useT, type TKey } from '@/i18n';
import { today } from '@/lib/dates';
import { formatLKR } from '@/lib/money';
import { hairline, radius, space, touchMin, useColors, useElevation, useLayout } from '@/theme';

type T = ReturnType<typeof useT>;

// ---------------------------------------------------------------- remembered choices

/** The settings key one field of one screen's list choices is kept under, e.g. `list_expenses_sort`. */
export function listKey(screen: string, field: string): string {
  return `list_${screen}_${field}`;
}

/**
 * The list choices of one screen, read from the settings table in one query. `set` writes one field
 * (its default is stored as NULL), `reset` puts every field back to its default.
 */
export function useListPrefs<K extends string>(screen: string, defaults: Record<K, string>) {
  const fields = Object.keys(defaults) as K[];
  const keys = fields.map((f) => listKey(screen, f));
  const rows = useQuery<{ key: string; value: string | null }>(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(', ')})`, keys);
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const prefs = {} as Record<K, string>;
  fields.forEach((f, i) => {
    prefs[f] = stored.get(keys[i]) ?? defaults[f];
  });
  const set = (field: K, value: string) => setSetting(listKey(screen, field), value === defaults[field] ? null : value);
  const reset = () =>
    tx(() => {
      for (const f of fields) setSetting(listKey(screen, f), null);
    });
  return { prefs, set, reset };
}

/** A stored value if it is one of `allowed`, else the fallback (a value from an older app version, or typed by hand). */
export function oneOf<V extends string>(value: string, allowed: readonly V[], fallback: V): V {
  return (allowed as readonly string[]).includes(value) ? (value as V) : fallback;
}

/** A comma-separated stored list, keeping only the allowed values. */
export function listOf<V extends string>(value: string, allowed: readonly V[]): V[] {
  return value
    .split(',')
    .filter((v): v is V => (allowed as readonly string[]).includes(v));
}

/** Cents from a stored amount, or null when there is none. */
export function centsOf(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------- months and periods

/** Today's date, kept current: it changes at local midnight and when the app comes back to the front. */
export function useToday(): string {
  const [day, setDay] = useState(today);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setDay(today());
      clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(refresh, Math.max(1000, midnight.getTime() - now.getTime()));
    };
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return day;
}

/** 'this' and 'last' follow the calendar; a 'YYYY-MM' is one fixed month; 'all' is no limit. */
export type Period = 'this' | 'last' | 'all' | `${number}-${number}`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-03" plus n months, e.g. shiftMonth('2026-01', -1) = '2025-12'. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A stored period, or 'all' for anything unreadable. */
export function toPeriod(value: string): Period {
  return value === 'this' || value === 'last' || MONTH_RE.test(value) ? (value as Period) : 'all';
}

/** The calendar month a period stands for on `day` ('YYYY-MM'), or null for all time. */
export function periodMonth(period: Period, day: string): string | null {
  if (period === 'this') return day.slice(0, 7);
  if (period === 'last') return shiftMonth(day.slice(0, 7), -1);
  return MONTH_RE.test(period) ? period : null;
}

/** First day of the month and first day of the next one: `day >= from AND day < to` is the whole month. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

/** The day range of a period on `day`, or null for all time. */
export function periodRange(period: Period, day: string): { from: string; to: string } | null {
  const m = periodMonth(period, day);
  return m ? monthRange(m) : null;
}

/** "2026-03" -> "March 2026" in the UI language. */
export function monthLabel(month: string, t: T): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m || m > 12) return month;
  return `${t(`month_${m}` as TKey)} ${y}`;
}

/** What a period is called in a caption or a tile: the month's name, or "All time". */
export function periodLabel(period: Period, day: string, t: T): string {
  const m = periodMonth(period, day);
  return m ? monthLabel(m, t) : t('allTime');
}

/** A month that has records, with their total and number (for the month picker). */
export interface MonthTotal {
  month: string;
  total: number;
  count: number;
}

/** "Rs 4,000 – Rs 9,000", "From Rs 4,000", "Up to Rs 9,000", or null with neither. */
export function amountRangeLabel(min: number | null, max: number | null, t: T): string | null {
  if (min != null && max != null) return `${formatLKR(min)} – ${formatLKR(max)}`;
  if (min != null) return t('amountFrom', { amount: formatLKR(min) });
  if (max != null) return t('amountUpTo', { amount: formatLKR(max) });
  return null;
}

// ---------------------------------------------------------------- chips

/** One chip of the sheet and the month chooser: 48 tall rounded square; chosen = navy fill, like the form chips. */
function BarChip({
  label,
  selected,
  onPress,
  count,
  disabled,
  icon: Icon,
  trailing: Trailing,
  role = 'radio',
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  disabled?: boolean;
  icon?: LucideIcon;
  trailing?: LucideIcon;
  role?: 'radio' | 'button' | 'checkbox';
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const press = usePressScale();
  const text = count != null ? `${label} ${count}` : label;
  const fg = selected ? c.onSlate : disabled ? c.placeholder : c.text;
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole={role}
        accessibilityState={role === 'button' ? { disabled: !!disabled, selected } : { checked: selected, disabled: !!disabled }}
        accessibilityLabel={accessibilityLabel ?? text}
        disabled={disabled}
        {...press.handlers}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={({ pressed }) => ({
          minHeight: touchMin,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          borderWidth: hairline,
          borderColor: selected ? (pressed ? c.slatePressed : c.slate) : c.border,
          backgroundColor: selected ? (pressed ? c.slatePressed : c.slate) : pressed ? c.muted : c.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        })}>
        {Icon ? <Icon size={18} color={selected ? fg : c.text} strokeWidth={2} /> : null}
        <Txt weight="semibold" numberOfLines={1} style={{ color: fg }}>
          {text}
        </Txt>
        {Trailing ? <Trailing size={18} color={selected ? fg : c.textMuted} strokeWidth={2} /> : null}
      </Pressable>
    </Animated.View>
  );
}

/**
 * One-of choices in a grey track; the chosen one is a white raised pill with blue words (Blueprint segmented).
 * Each segment is as wide as its words (long Sinhala / Tamil labels never shrink); with `fill` the segments share
 * the track's width when they fit. The row scrolls sideways when it does not.
 */
function SegTrack({
  options,
  value,
  onChange,
  fill,
}: {
  options: { value: string; label: string; count?: number; disabled?: boolean }[];
  value: string | null;
  onChange: (v: string) => void;
  fill?: boolean;
}) {
  const c = useColors();
  const lift = useElevation('field');
  return (
    <View
      accessibilityRole="radiogroup"
      style={{ flexDirection: 'row', flexGrow: fill ? 1 : 0, backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        const text = o.count != null ? `${o.label} · ${o.count}` : o.label;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: !!o.disabled }}
            accessibilityLabel={o.count != null ? `${o.label} ${o.count}` : o.label}
            disabled={o.disabled}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            style={({ pressed }) => ({
              flexGrow: fill ? 1 : 0,
              minHeight: touchMin,
              paddingHorizontal: space.lg,
              borderRadius: radius.md - 3,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? c.card : pressed ? c.muted : 'transparent',
              ...(on ? lift : null),
            })}>
            <Txt weight={on ? 'bold' : 'semibold'} numeric={o.count != null} numberOfLines={1} style={{ color: on ? c.primary : o.disabled ? c.placeholder : c.textMuted }}>
              {text}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Several-choice chips for the sheet (categories, payment methods). None chosen = all of them. */
export function MultiChips<V extends string>({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: { value: V; label: string }[];
  values: V[];
  onChange: (next: V[]) => void;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Label text={label} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((o) => {
          const on = values.includes(o.value);
          return (
            <BarChip
              key={o.value}
              role="checkbox"
              label={o.label}
              selected={on}
              onPress={() => onChange(on ? values.filter((v) => v !== o.value) : options.map((x) => x.value).filter((v) => v === o.value || values.includes(v)))}
            />
          );
        })}
      </View>
    </View>
  );
}

/** The "Filter & sort" button that opens the sheet, with the number of choices made inside it. */
function FilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  const c = useColors();
  const t = useT();
  const press = usePressScale();
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count ? t('filterSortActive', { n: count }) : t('filterSort')}
        {...press.handlers}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={({ pressed }) => ({
          minHeight: touchMin,
          paddingLeft: space.md,
          paddingRight: count ? space.sm : space.lg,
          borderRadius: radius.md,
          borderWidth: hairline,
          borderColor: count ? c.slate : c.border,
          backgroundColor: pressed ? c.muted : c.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        })}>
        <SlidersHorizontal size={20} color={c.text} strokeWidth={2} />
        <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {t('filterSort')}
        </Txt>
        {count ? (
          <View style={{ minWidth: 24, height: 24, paddingHorizontal: space.xs, borderRadius: radius.pill, backgroundColor: c.slate, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="caption" weight="bold" numeric style={{ color: c.onSlate }}>
              {String(count)}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** The square Filter & sort button beside the search box (Blueprint), with the number of choices made as a navy badge. */
function SquareFilterButton({ count, onPress }: { count: number; onPress: () => void }) {
  const c = useColors();
  const t = useT();
  const press = usePressScale();
  const lift = useElevation('field');
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count ? t('filterSortActive', { n: count }) : t('filterSort')}
        {...press.handlers}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={({ pressed }) => ({
          width: 52,
          height: 52,
          minHeight: 52,
          borderRadius: radius.md,
          borderWidth: hairline,
          borderColor: count ? c.slate : c.border,
          backgroundColor: pressed ? c.muted : c.card,
          alignItems: 'center',
          justifyContent: 'center',
          ...lift,
        })}>
        <SlidersHorizontal size={20} color={c.text} strokeWidth={2} />
        {count ? (
          <View
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 22,
              height: 22,
              paddingHorizontal: 5,
              borderRadius: 11,
              borderWidth: 2,
              borderColor: c.bg,
              backgroundColor: c.slate,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Txt variant="caption" weight="bold" numeric style={{ color: c.onSlate, fontSize: 11, lineHeight: 14 }}>
              {String(count)}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** "March 2026 · Materials · Highest first" with a one-tap Clear, under the bar while anything is not default. */
function AppliedCaption({ parts, onClear }: { parts: string[]; onClear: () => void }) {
  const c = useColors();
  const t = useT();
  const text = parts.join(' · ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLiveRegion="polite">
      <Txt variant="caption" color="textMuted" style={{ flex: 1 }} numberOfLines={3} testID="list-applied">
        {text}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('clear')}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onClear();
        }}
        hitSlop={4}
        style={({ pressed }) => ({
          minHeight: touchMin,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          backgroundColor: pressed ? c.primarySoft : 'transparent',
        })}>
        <X size={18} color={c.primary} strokeWidth={2.4} />
        <Txt weight="semibold" color="primary">
          {t('clear')}
        </Txt>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------- the bar

export interface QuickChip {
  value: string;
  label: string;
  /** Shown after the label ("Draft 3"); a zero count is usually paired with `disabled`. */
  count?: number;
  disabled?: boolean;
}

export interface ListControlsProps {
  /** Period chips (This month · Last month · All time · Choose month) in the bar, or in the sheet with `inSheet`. */
  period?: {
    value: Period;
    onChange: (p: Period) => void;
    /** The months that have records, newest first, with their totals. */
    months: MonthTotal[];
    /** Today's date, so "this month" stays right past midnight. */
    today: string;
    inSheet?: boolean;
  };
  /** One-tap chips in the bar after the button (status, balance). */
  quick?: { options: QuickChip[]; value: string; onChange: (v: string) => void };
  sort: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void };
  /** The screen's own filter sections inside the sheet. */
  children?: ReactNode;
  /** How many choices inside the sheet differ from their default (the badge on the button). */
  sheetCount: number;
  /** What is applied, for the caption; empty when everything is default. */
  applied: string[];
  /** Back to the defaults (the caption's Clear and the sheet's Reset). */
  onClear: () => void;
  /**
   * The list's search box (`useSearchBox().node`). Given, the bar is the Blueprint one: the search box with a square
   * Filter & sort button beside it, then the period and quick choices as segmented tracks under them.
   */
  search?: ReactNode;
}

/** The control bar: chips row, applied caption with Clear, and the Filter & sort sheet. */
export function ListControls({ period, quick, sort, children, sheetCount, applied, onClear, search }: ListControlsProps) {
  const t = useT();
  const { gutter } = useLayout();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const chosenMonth = period ? periodMonth(period.value, period.today) : null;
  const fixedMonth = period && period.value !== 'this' && period.value !== 'last' && period.value !== 'all' ? period.value : null;
  const pickMonth = (month: string | null) => {
    setPicking(false);
    if (!period || !month) return;
    const thisMonth = period.today.slice(0, 7);
    period.onChange(month === thisMonth ? 'this' : month === shiftMonth(thisMonth, -1) ? 'last' : (month as Period));
  };
  const periodChoices: { value: Period; label: string }[] = [
    { value: 'this', label: t('thisMonth') },
    { value: 'last', label: t('lastMonth') },
    { value: 'all', label: t('allTime') },
  ];
  const monthChip = period ? (
    <BarChip
      role="button"
      icon={Calendar}
      trailing={ChevronDown}
      label={fixedMonth ? monthLabel(fixedMonth, t) : t('chooseMonth')}
      accessibilityLabel={fixedMonth ? `${t('chooseMonth')}: ${monthLabel(fixedMonth, t)}` : t('chooseMonth')}
      selected={!!fixedMonth}
      disabled={period.months.length === 0}
      onPress={() => {
        setOpen(false);
        setPicking(true);
      }}
    />
  ) : null;

  const barPeriod = period && !period.inSheet ? period : null;
  const tracks =
    barPeriod || quick ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ marginHorizontal: -gutter, flexGrow: 0 }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: gutter, gap: space.sm, alignItems: 'center' }}>
        {search ? null : <FilterButton count={sheetCount} onPress={() => setOpen(true)} />}
        {barPeriod ? (
          <SegTrack
            fill={!!search}
            // the chosen month is the month chip's, so no segment is lit then
            value={fixedMonth ? null : barPeriod.value}
            onChange={(v) => barPeriod.onChange(v as Period)}
            options={search ? [periodChoices[2], periodChoices[0], periodChoices[1]] : periodChoices}
          />
        ) : null}
        {barPeriod ? monthChip : null}
        {quick ? <SegTrack fill={!!search} value={quick.value} onChange={quick.onChange} options={quick.options} /> : null}
      </ScrollView>
    ) : search ? null : (
      <View style={{ flexDirection: 'row' }}>
        <FilterButton count={sheetCount} onPress={() => setOpen(true)} />
      </View>
    );

  return (
    <View style={{ gap: space.md }}>
      {search ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>{search}</View>
          <SquareFilterButton count={sheetCount} onPress={() => setOpen(true)} />
        </View>
      ) : null}
      {tracks}
      {applied.length ? <AppliedCaption parts={applied} onClear={onClear} /> : null}

      <FilterSheet
        visible={open}
        onClose={() => setOpen(false)}
        onReset={onClear}
        period={
          period?.inSheet ? (
            <View style={{ gap: space.sm }}>
              <Chips<Period>
                label={t('period')}
                options={periodChoices}
                value={fixedMonth ? null : period.value}
                onChange={period.onChange}
              />
              <View style={{ flexDirection: 'row' }}>{monthChip}</View>
            </View>
          ) : null
        }
        sort={sort}>
        {children}
      </FilterSheet>

      {period ? (
        <PickerSheet
          visible={picking}
          title={t('chooseMonth')}
          value={chosenMonth}
          items={period.months.map((m) => ({
            id: m.month,
            title: monthLabel(m.month, t),
            subtitle: `${formatLKR(m.total)} · ${t('recordsCount', { n: m.count })}`,
            icon: Calendar,
          }))}
          onClose={() => setPicking(false)}
          onPick={pickMonth}
          searchFrom={24}
        />
      ) : null}
    </View>
  );
}

/** The bottom sheet behind "Filter & sort": the screen's choices take effect at once; Reset and Done at the foot. */
function FilterSheet({
  visible,
  onClose,
  onReset,
  period,
  sort,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onReset: () => void;
  period: ReactNode;
  sort: ListControlsProps['sort'];
  children?: ReactNode;
}) {
  const c = useColors();
  const t = useT();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title={t('filterSort')} onClose={onClose} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.xl }}>
        {period}
        <View style={{ gap: space.sm }}>
          <Label text={t('sortBy')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
            <SegTrack fill options={sort.options} value={sort.value} onChange={sort.onChange} />
          </ScrollView>
        </View>
        {children}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: hairline, borderTopColor: c.divider }}>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" label={t('reset')} onPress={onReset} full />
        </View>
        <View style={{ flex: 1.6 }}>
          <Button label={t('done')} onPress={onClose} full />
        </View>
      </View>
    </BottomSheet>
  );
}
