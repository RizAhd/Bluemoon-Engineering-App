import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { AlertCircle, Calendar, Check, ChevronDown, Search, X } from 'lucide-react-native';
import { memo, useState, type ReactNode } from 'react';
import { FlatList, Modal, Platform, Pressable, TextInput, View, type DimensionValue, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { addDays, formatDay, toDay, today } from '@/lib/dates';
import { formatAmount, parseCents } from '@/lib/money';
import { FONT_MAP, hairline, lineHeight, listTuning, radius, space, touch, touchMin, type, useColors, useFont, useLayout } from '@/theme';

import { IconButton } from './Button';
import { usePressScale } from './PressScale';
import { Txt } from './Txt';

// ---------------------------------------------------------------- shared bits

/** Field label: caption 13/600 `text` (stays `text` on error), optional marker in textMuted 400. */
export function Label({ text, optional }: { text: string; optional?: boolean; error?: string | null }) {
  const t = useT();
  return (
    <Txt variant="caption" weight="semibold" color="text">
      {text}
      {optional ? (
        <Txt color="textMuted" variant="caption" weight="regular">
          {`  (${t('optional')})`}
        </Txt>
      ) : null}
    </Txt>
  );
}

/** Error (danger + AlertCircle, live region) or hint (textMuted) under a field. */
export function HelperText({ error, hint, tone = 'textMuted' }: { error?: string | null; hint?: string; tone?: 'textMuted' | 'warning' }) {
  const c = useColors();
  if (error)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }} accessibilityLiveRegion="polite">
        <AlertCircle size={14} color={c.danger} strokeWidth={2.4} style={{ marginTop: 2 }} />
        <Txt variant="caption" color="danger" weight="semibold" style={{ flex: 1 }}>
          {error}
        </Txt>
      </View>
    );
  if (hint)
    return (
      <Txt variant="caption" color={tone}>
        {hint}
      </Txt>
    );
  return null;
}

/** 2 dp focus ring drawn outside the shape so the box itself never moves. */
export function Ring({ focus, children, style }: { focus: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ padding: 2, margin: -2, borderRadius: radius.md + 2, borderWidth: 2, borderColor: focus ? c.focusRing : 'transparent' }, style]}>
      {children}
    </View>
  );
}

function useBoxColors(opts: { focus: boolean; error?: string | null; disabled?: boolean }) {
  const c = useColors();
  return {
    borderColor: opts.error ? c.danger : opts.focus ? c.primary : opts.disabled ? c.border : c.borderStrong,
    backgroundColor: opts.disabled ? c.surface2 : c.card,
    color: opts.disabled ? c.textMuted : c.text,
  };
}

// ---------------------------------------------------------------- Field

export interface FieldProps extends TextInputProps {
  label: string;
  optional?: boolean;
  error?: string | null;
  hint?: string;
  /** Renders without the label (for inline use). */
  hideLabel?: boolean;
  disabled?: boolean;
  /** A leading icon inside the box (phone, map pin…); it turns primary while the field has focus. */
  icon?: LucideIcon;
}

export function Field({ label, optional, error, hint, multiline, hideLabel, disabled, editable, style, icon: Icon, ...input }: FieldProps) {
  const c = useColors();
  const font = useFont();
  const [focus, setFocus] = useState(false);
  const off = disabled || editable === false;
  const box = useBoxColors({ focus, error, disabled: off });
  const textInput = (
    <TextInput
      {...input}
      editable={!off}
      accessibilityLabel={label}
      multiline={multiline}
      placeholderTextColor={c.placeholder}
      onFocus={(e) => {
        setFocus(true);
        input.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocus(false);
        input.onBlur?.(e);
      }}
      style={[
        {
          minHeight: multiline ? 112 : touch,
          textAlignVertical: multiline ? 'top' : 'center',
          paddingHorizontal: Icon ? 0 : space.lg,
          paddingVertical: multiline ? space.md : 0,
          color: box.color,
          fontSize: type.bodyLg,
          fontFamily: font('regular'),
        },
        Icon
          ? { flex: 1, minWidth: 0, paddingRight: space.lg }
          : { borderRadius: radius.md, borderWidth: hairline, borderColor: box.borderColor, backgroundColor: box.backgroundColor },
        style,
      ]}
    />
  );
  return (
    <View style={{ gap: 6 }}>
      {hideLabel ? null : <Label text={label} optional={optional} error={error} />}
      <Ring focus={focus && !off}>
        {Icon ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: multiline ? 'flex-start' : 'center',
              gap: space.md,
              paddingLeft: space.lg,
              borderRadius: radius.md,
              borderWidth: hairline,
              borderColor: box.borderColor,
              backgroundColor: box.backgroundColor,
            }}>
            <Icon size={20} color={error ? c.danger : focus ? c.primary : c.textMuted} strokeWidth={2} style={multiline ? { marginTop: space.md + 1 } : undefined} />
            {textInput}
          </View>
        ) : (
          textInput
        )}
      </Ring>
      <HelperText error={error} hint={hint} />
    </View>
  );
}

// ---------------------------------------------------------------- AmountField

export interface AmountFieldProps {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  error?: string | null;
  autoFocus?: boolean;
  optional?: boolean;
  /** Computed hint under the box, e.g. "1 × Rs 3,500". */
  hint?: string;
  /** Hint in warning colour (e.g. "paying more than owed"). */
  hintTone?: 'textMuted' | 'warning';
  /** 48 tall, no label, smaller digits — for the work & pay rows. */
  compact?: boolean;
  disabled?: boolean;
  /** Called after the blur re-format. */
  onBlur?: () => void;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  /** Example amount shown while empty ("6,500"); "0" when not given. */
  placeholder?: string;
}

/** Large amount input with an Rs prefix and a number keypad. Re-formats with thousands separators on blur. */
export function AmountField({ label, value, onChangeText, error, autoFocus, optional, hint, hintTone, compact, disabled, onBlur, onSubmitEditing, returnKeyType, placeholder = '0' }: AmountFieldProps) {
  const c = useColors();
  const t = useT();
  const [focus, setFocus] = useState(false);
  const box = useBoxColors({ focus, error, disabled });
  return (
    <View style={{ gap: 6 }}>
      {compact ? null : <Label text={label} optional={optional} error={error} />}
      <Ring focus={focus && !disabled}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            borderRadius: radius.md,
            borderWidth: hairline,
            borderColor: box.borderColor,
            backgroundColor: box.backgroundColor,
            paddingHorizontal: space.lg,
            minHeight: compact ? touchMin : 72,
            gap: space.sm,
          }}>
          <Txt variant={compact ? 'body' : 'bodyLg'} weight="semibold" color="textMuted">
            {t('rs')}
          </Txt>
          <TextInput
            accessibilityLabel={label}
            // Shown with thousands separators while not being edited ("2,200", not "2200").
            value={focus || !value ? value : (() => {
              const cents = parseCents(value);
              return cents === null ? value : formatAmount(cents);
            })()}
            editable={!disabled}
            onChangeText={(s) => onChangeText(s.replace(/[^0-9.,]/g, ''))}
            keyboardType="decimal-pad"
            autoFocus={autoFocus}
            placeholder={placeholder}
            placeholderTextColor={c.placeholder}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            onFocus={() => setFocus(true)}
            onBlur={() => {
              setFocus(false);
              const cents = parseCents(value);
              if (value && cents !== null) onChangeText(formatAmount(cents));
              onBlur?.();
            }}
            maxFontSizeMultiplier={1.2}
            style={{
              flex: 1,
              fontSize: compact ? type.bodyLg : type.amount,
              // Android draws the placeholder off-centre when a lineHeight is set, so the empty "0" sat higher than "Rs".
              lineHeight: value ? (compact ? lineHeight.bodyLg.latin : lineHeight.amount.latin) : undefined,
              fontFamily: FONT_MAP.en.bold,
              color: box.color,
              paddingVertical: compact ? space.sm : space.md,
              fontVariant: ['tabular-nums'],
            }}
          />
        </View>
      </Ring>
      <HelperText error={error} hint={hint} tone={hintTone} />
    </View>
  );
}

// ---------------------------------------------------------------- Chips

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Shown after the label ("Out 3"); a zero count may be paired with `disabled`. */
  count?: number;
  disabled?: boolean;
  /** Spoken instead of the label (e.g. "Half day" for "½"). */
  accessibilityLabel?: string;
}

/** One option of a Chips group. Its own component so each chip owns its press animation. */
function Chip<T extends string>({ option: o, on, numeric, onChange }: { option: ChipOption<T>; on: boolean; numeric?: boolean; onChange: (v: T) => void }) {
  const c = useColors();
  const press = usePressScale();
  const off = !!o.disabled;
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: on, disabled: off }}
        accessibilityLabel={o.accessibilityLabel ?? (o.count != null ? `${o.label} ${o.count}` : o.label)}
        disabled={off}
        {...press.handlers}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onChange(o.value);
        }}
        style={({ pressed }) => ({
          minHeight: touchMin,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          borderWidth: hairline,
          borderColor: on ? (pressed ? c.slatePressed : c.slate) : off ? c.border : c.borderStrong,
          backgroundColor: on ? (pressed ? c.slatePressed : c.slate) : pressed ? c.muted : c.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        })}>
        {on ? <Check size={16} color={c.onSlate} strokeWidth={2.4} /> : o.icon}
        <Txt weight={on ? 'semibold' : 'regular'} numeric={numeric} style={{ color: on ? c.onSlate : off ? c.placeholder : c.text, flexShrink: 1 }} numberOfLines={2}>
          {o.count != null ? `${o.label} ${o.count}` : o.label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

/** Single-choice chips that wrap onto several lines. Selected = ink (slate) fill with a tick. */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  numeric,
}: {
  label?: string;
  options: ChipOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  error?: string | null;
  /** Labels are numbers (½ · 1 · 1½): render with Latin tabular digits. */
  numeric?: boolean;
}) {
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Label text={label} error={error} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Chip key={o.value} option={o} on={o.value === value} numeric={numeric} onChange={onChange} />
        ))}
      </View>
      <HelperText error={error} />
    </View>
  );
}

// ---------------------------------------------------------------- Segmented

/** 2–4 short options in one 48-tall track; the chosen segment is ink. Use Chips for more. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  numeric,
  style,
}: {
  options: { value: T; label: string; accessibilityLabel?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label?: string;
  numeric?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Label text={label} /> : null}
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', minHeight: touchMin, backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, gap: 2 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.accessibilityLabel ?? o.label}
              // 42 inside the 48 track; the hit area reaches the track's edges
              hitSlop={{ top: 3, bottom: 3 }}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange(o.value);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 42,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: space.sm,
                backgroundColor: on ? (pressed ? c.slatePressed : c.slate) : pressed ? c.muted : 'transparent',
              })}>
              <Txt weight="semibold" numeric={numeric} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ color: on ? c.onSlate : c.text }}>
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Checkbox

/** 28 × 28 box in a 48 × 48 hit area. The label is the row text beside it (pass `label` for a11y). */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  style,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(!checked);
      }}
      style={({ pressed }) => [
        { width: touchMin, height: touchMin, borderRadius: touchMin / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed && !disabled ? c.muted : 'transparent' },
        style,
      ]}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: checked ? c.slate : disabled ? c.border : c.borderStrong,
          backgroundColor: checked ? c.slate : disabled ? c.surface2 : c.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {checked ? <Check size={20} color={c.onSlate} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- SearchField

/** 48-tall search box with a leading magnifier and a clear button. No label. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  style,
}: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const t = useT();
  const font = useFont();
  const [focus, setFocus] = useState(false);
  const box = useBoxColors({ focus });
  const ph = placeholder ?? t('search');
  return (
    <Ring focus={focus} style={style}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: touchMin,
          borderRadius: radius.md,
          borderWidth: hairline,
          borderColor: box.borderColor,
          backgroundColor: box.backgroundColor,
          paddingLeft: space.md,
          paddingRight: space.xs,
          gap: space.sm,
        }}>
        <Search size={18} color={c.textMuted} strokeWidth={2} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={ph}
          accessibilityLabel={ph}
          placeholderTextColor={c.placeholder}
          returnKeyType="search"
          autoFocus={autoFocus}
          autoCorrect={false}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{ flex: 1, minHeight: touchMin - 2, color: c.text, fontSize: type.body, fontFamily: font('regular'), paddingVertical: 0 }}
        />
        {value ? <IconButton icon={X} label={t('close')} size={44} tone="textMuted" onPress={() => onChangeText('')} /> : <View style={{ width: 44 }} />}
      </View>
    </Ring>
  );
}

// ---------------------------------------------------------------- DateField

/** Date with one-tap Today / Yesterday, plus a calendar chip for anything else. */
export function DateField({
  label,
  value,
  onChange,
  maxDay,
  error,
}: {
  label: string;
  value: string;
  onChange: (d: string) => void;
  /** Latest selectable day (YYYY-MM-DD); pass `today()` where future dates make no sense. */
  maxDay?: string;
  error?: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const td = today();
  const yd = addDays(td, -1);
  const custom = value !== td && value !== yd;
  const [y, m, d] = value.split('-').map(Number);
  const max = maxDay ? maxDay.split('-').map(Number) : null;

  return (
    <View style={{ gap: space.sm }}>
      <Label text={label} error={error} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Chips
          options={[
            { value: td, label: t('today') },
            { value: yd, label: t('yesterday') },
          ]}
          value={custom ? null : value}
          onChange={onChange}
        />
        <CalendarChip label={`${label}: ${formatDay(value)}`} custom={custom} value={value} onPress={() => setOpen(true)} />
      </View>
      <HelperText error={error} />
      {open ? (
        <DateTimePicker
          value={new Date(y, (m || 1) - 1, d || 1)}
          mode="date"
          maximumDate={max ? new Date(max[0], (max[1] || 1) - 1, max[2] || 1) : new Date(2100, 0, 1)}
          onValueChange={(_e, date) => {
            setOpen(false);
            onChange(toDay(date));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}

/** The "pick another day" chip of a DateField: ink when a day other than today / yesterday is chosen; 0.97 press scale like the chips. */
function CalendarChip({ label, custom, value, onPress }: { label: string; custom: boolean; value: string; onPress: () => void }) {
  const c = useColors();
  const press = usePressScale();
  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        {...press.handlers}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        style={({ pressed }) => ({
          minHeight: touchMin,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          borderWidth: hairline,
          borderColor: custom ? (pressed ? c.slatePressed : c.slate) : c.borderStrong,
          backgroundColor: custom ? (pressed ? c.slatePressed : c.slate) : pressed ? c.muted : c.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        })}>
        <Calendar size={16} color={custom ? c.onSlate : c.textMuted} strokeWidth={2} />
        <Txt numeric weight={custom ? 'semibold' : 'regular'} style={{ color: custom ? c.onSlate : c.text }}>
          {formatDay(value)}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------- SelectField + PickerSheet

export interface PickerItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Shown but not pickable (e.g. "already on this project"). */
  disabled?: boolean;
}

/** A field that opens a searchable list in a bottom sheet. */
export function SelectField<T extends PickerItem>({
  label,
  items,
  value,
  onChange,
  error,
  optional,
  placeholder,
  allowNone,
  disabled,
  hint,
  footer,
}: {
  label: string;
  items: T[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string | null;
  optional?: boolean;
  placeholder?: string;
  allowNone?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Extra content under the sheet's list (e.g. a "New project" button). */
  footer?: ReactNode;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const box = useBoxColors({ focus: open, error, disabled });
  const selected = items.find((i) => i.id === value);
  return (
    <View style={{ gap: 6 }}>
      <Label text={label} optional={optional} error={error} />
      <Ring focus={open}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${selected?.title ?? placeholder ?? ''}`}
          accessibilityState={{ disabled: !!disabled, expanded: open }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            minHeight: touch,
            paddingHorizontal: space.lg,
            borderRadius: radius.md,
            borderWidth: hairline,
            borderColor: box.borderColor,
            backgroundColor: pressed ? c.muted : box.backgroundColor,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
          })}>
          <Txt variant="bodyLg" style={{ flex: 1 }} color={selected ? (disabled ? 'textMuted' : 'text') : 'placeholder'} numberOfLines={1}>
            {selected?.title ?? placeholder ?? label}
          </Txt>
          <ChevronDown size={18} color={c.textMuted} strokeWidth={2} />
        </Pressable>
      </Ring>
      <HelperText error={error} hint={hint} />
      <PickerSheet
        visible={open}
        title={label}
        items={items}
        value={value}
        allowNone={allowNone}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
        footer={footer}
      />
    </View>
  );
}

/**
 * The panel of a bottom sheet: surface3, rounded top, safe bottom padding, never taller than `maxHeight` of the
 * window (its content scrolls inside), and on tablets at most 640 wide and centred like the screens.
 */
export function SheetPanel({ children, maxHeight = '85%', style }: { children: ReactNode; maxHeight?: DimensionValue; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { column, wide } = useLayout();
  return (
    <View
      style={[
        column,
        {
          maxHeight,
          backgroundColor: c.surface3,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderTopWidth: hairline,
          // a centred tablet sheet needs its sides drawn; a phone sheet runs edge to edge
          borderLeftWidth: wide ? hairline : 0,
          borderRightWidth: wide ? hairline : 0,
          borderColor: c.border,
          paddingBottom: insets.bottom + space.lg,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/** A modal bottom sheet: dimmed backdrop (tap to close) and a SheetPanel. Back closes it through `onClose`. */
export function BottomSheet({ visible, onClose, maxHeight, children }: { visible: boolean; onClose: () => void; maxHeight?: DimensionValue; children: ReactNode }) {
  const c = useColors();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }}>
        <Pressable style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')} />
        <SheetPanel maxHeight={maxHeight}>{children}</SheetPanel>
      </View>
    </Modal>
  );
}

/** Sheet header: grabber, title, close. Shared by PickerSheet and the quick-add sheet. */
export function SheetHeader({ title, onClose, caption }: { title: string; onClose: () => void; caption?: string }) {
  const c = useColors();
  const t = useT();
  return (
    <View>
      <View style={{ alignItems: 'center', paddingTop: space.sm }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: space.lg, paddingRight: space.sm, gap: space.sm }}>
        <Txt variant="title" weight="semibold" style={{ flex: 1, minWidth: 0 }} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Txt>
        <IconButton icon={X} label={t('close')} size={44} onPress={onClose} />
      </View>
      {caption ? (
        <Txt variant="caption" color="textMuted" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {caption}
        </Txt>
      ) : null}
    </View>
  );
}

export function PickerSheet<T extends PickerItem>({
  visible,
  title,
  items,
  value,
  onPick,
  onClose,
  allowNone,
  footer,
  searchFrom = 8,
}: {
  visible: boolean;
  title: string;
  items: T[];
  value: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  allowNone?: boolean;
  footer?: ReactNode;
  /** Show the search box when there are more items than this. */
  searchFrom?: number;
}) {
  const c = useColors();
  const t = useT();
  const [q, setQ] = useState('');
  const shown = q ? items.filter((i) => `${i.title} ${i.subtitle ?? ''}`.toLowerCase().includes(q.toLowerCase())) : items;
  const rows = allowNone ? [{ id: '', title: '—' } as T, ...shown] : shown;
  const hasIcons = items.some((i) => i.icon);
  const separatorInset = hasIcons ? 68 : space.lg;

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="75%">
      <SheetHeader title={title} onClose={onClose} />
      {items.length > searchFrom ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <SearchField value={q} onChangeText={setQ} />
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={pickerKey}
        keyboardShouldPersistTaps="handled"
        {...listTuning}
        removeClippedSubviews={Platform.OS === 'android'}
        ItemSeparatorComponent={() => <View style={{ height: hairline, backgroundColor: c.border, marginLeft: separatorInset }} />}
        ListEmptyComponent={
          q ? (
            <Txt variant="caption" color="textMuted" style={{ padding: space.lg }}>
              {`${t('search')}: "${q}"`}
            </Txt>
          ) : undefined
        }
        renderItem={({ item }) => <PickerRow item={item} on={(item.id || null) === value} onPick={onPick} />}
      />
      {footer ? <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>{footer}</View> : null}
    </BottomSheet>
  );
}

const pickerKey = (i: PickerItem) => i.id || 'none';

/** One row of a PickerSheet: ripple and pressed colour, selected = primarySoft + tick. */
const PickerRow = memo(function PickerRow({ item, on, onPick }: { item: PickerItem; on: boolean; onPick: (id: string | null) => void }) {
  const c = useColors();
  const Icon = item.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !!item.disabled }}
      android_ripple={{ color: c.muted }}
      onPress={() => onPick(item.id || null)}
      style={({ pressed }) => ({
        minHeight: touch,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: pressed ? c.muted : on ? c.primarySoft : 'transparent',
      })}>
      {Icon ? (
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={c.textMuted} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt weight="semibold" color={item.disabled ? 'textMuted' : 'text'} numberOfLines={2}>
          {item.title}
        </Txt>
        {item.subtitle ? (
          <Txt variant="caption" color="textMuted" numberOfLines={1}>
            {item.subtitle}
          </Txt>
        ) : null}
      </View>
      {on ? <Check size={20} color={c.primary} strokeWidth={2.4} /> : null}
    </Pressable>
  );
});

// ---------------------------------------------------------------- FormSection

/**
 * A titled block of a long form ("Client", "Job and site"): a 36 dp icon tile, the title as a header,
 * a one-line caption, then the fields 16 dp apart. Sections sit 24 dp apart inside the Screen.
 */
export function FormSection({ icon: Icon, title, caption, children, first }: { icon: LucideIcon; title: string; caption?: string; children: ReactNode; first?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: space.lg, marginTop: first ? 0 : space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} color={c.primary} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyLg" weight="semibold" accessibilityRole="header" numberOfLines={2}>
            {title}
          </Txt>
          {caption ? (
            <Txt variant="caption" color="textMuted" numberOfLines={2}>
              {caption}
            </Txt>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}
