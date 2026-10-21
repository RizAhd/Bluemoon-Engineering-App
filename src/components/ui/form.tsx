import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, Check, ChevronDown, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { FlatList, Modal, Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { addDays, formatDay, toDay, today } from '@/lib/dates';
import { FONT_MAP, motion, radius, space, touch, type, useColors, useFont } from '@/theme';

import { IconButton } from './Button';
import { Txt } from './Txt';

function Label({ text, optional, error }: { text: string; optional?: boolean; error?: string | null }) {
  const t = useT();
  return (
    <Txt weight="semibold" color={error ? 'danger' : 'text'}>
      {text}
      {optional ? <Txt color="textMuted" variant="caption">{`  (${t('optional')})`}</Txt> : null}
    </Txt>
  );
}

function ErrorText({ error, hint }: { error?: string | null; hint?: string }) {
  if (error)
    return (
      <Txt variant="caption" color="danger" weight="semibold" accessibilityLiveRegion="polite">
        {error}
      </Txt>
    );
  if (hint)
    return (
      <Txt variant="caption" color="textMuted">
        {hint}
      </Txt>
    );
  return null;
}

export function Field({
  label,
  optional,
  error,
  hint,
  multiline,
  ...input
}: TextInputProps & { label: string; optional?: boolean; error?: string | null; hint?: string }) {
  const c = useColors();
  const font = useFont();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Label text={label} optional={optional} error={error} />
      <TextInput
        {...input}
        accessibilityLabel={label}
        multiline={multiline}
        placeholderTextColor={c.textMuted}
        onFocus={(e) => {
          setFocus(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          input.onBlur?.(e);
        }}
        style={{
          minHeight: multiline ? 112 : touch,
          textAlignVertical: multiline ? 'top' : 'center',
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          borderRadius: radius.md,
          borderWidth: focus ? 2 : 1.5,
          borderColor: error ? c.danger : focus ? c.primary : c.borderStrong,
          backgroundColor: c.card,
          color: c.text,
          fontSize: type.bodyLg,
          fontFamily: font('regular'),
        }}
      />
      <ErrorText error={error} hint={hint} />
    </View>
  );
}

/** Large amount input with an Rs prefix and a number keypad. */
export function AmountField({
  label,
  value,
  onChangeText,
  error,
  autoFocus,
  optional,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  error?: string | null;
  autoFocus?: boolean;
  optional?: boolean;
}) {
  const c = useColors();
  const t = useT();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Label text={label} optional={optional} error={error} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: radius.md,
          borderWidth: focus ? 2 : 1.5,
          borderColor: error ? c.danger : focus ? c.primary : c.borderStrong,
          backgroundColor: c.card,
          paddingHorizontal: space.lg,
          minHeight: 72,
        }}>
        <Txt variant="title" weight="semibold" color="textMuted" style={{ marginRight: space.sm }}>
          {t('rs')}
        </Txt>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={(s) => onChangeText(s.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          placeholder="0"
          placeholderTextColor={c.textMuted}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            fontSize: type.amount,
            fontFamily: FONT_MAP.en.bold,
            color: c.text,
            paddingVertical: space.sm,
            fontVariant: ['tabular-nums'],
          }}
        />
      </View>
      <ErrorText error={error} />
    </View>
  );
}

/** Single-choice chips that wrap onto several lines. */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label?: string;
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  error?: string | null;
}) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Label text={label} error={error} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={o.label}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => ({
                minHeight: 48,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                borderWidth: 1.5,
                borderColor: on ? c.primary : c.borderStrong,
                backgroundColor: on ? c.primarySoft : pressed ? c.muted : c.card,
                transform: [{ scale: pressed ? motion.pressScale : 1 }],
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.xs,
              })}>
              {on ? <Check size={16} color={c.primary} strokeWidth={3} /> : o.icon}
              <Txt weight={on ? 'bold' : 'regular'} style={{ color: on ? c.primary : c.text }}>
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <ErrorText error={error} />
    </View>
  );
}

/** Date with one-tap Today / Yesterday, plus a calendar for anything else. */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (d: string) => void }) {
  const t = useT();
  const c = useColors();
  const [open, setOpen] = useState(false);
  const td = today();
  const yd = addDays(td, -1);
  const custom = value !== td && value !== yd;
  const [y, m, d] = value.split('-').map(Number);

  return (
    <View style={{ gap: space.sm }}>
      <Label text={label} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Chips
          options={[
            { value: td, label: t('today') },
            { value: yd, label: t('yesterday') },
          ]}
          value={custom ? null : value}
          onChange={onChange}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen(true)}
          style={{
            minHeight: 48,
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            borderWidth: 1.5,
            borderColor: custom ? c.primary : c.borderStrong,
            backgroundColor: custom ? c.primarySoft : c.card,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.xs,
          }}>
          <Calendar size={18} color={custom ? c.primary : c.text} />
          <Txt numeric weight={custom ? 'bold' : 'regular'} style={{ color: custom ? c.primary : c.text }}>
            {formatDay(value)}
          </Txt>
        </Pressable>
      </View>
      {open ? (
        <DateTimePicker
          value={new Date(y, (m || 1) - 1, d || 1)}
          mode="date"
          maximumDate={new Date(2100, 0, 1)}
          onChange={(e, date) => {
            setOpen(false);
            if (e.type === 'set' && date) onChange(toDay(date));
          }}
        />
      ) : null}
    </View>
  );
}

/** A field that opens a searchable list in a bottom sheet. */
export function SelectField<T extends { id: string; title: string; subtitle?: string }>({
  label,
  items,
  value,
  onChange,
  error,
  optional,
  placeholder,
  allowNone,
}: {
  label: string;
  items: T[];
  value: string | null;
  onChange: (id: string | null) => void;
  error?: string | null;
  optional?: boolean;
  placeholder?: string;
  allowNone?: boolean;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);
  return (
    <View style={{ gap: space.xs }}>
      <Label text={label} optional={optional} error={error} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.title ?? placeholder ?? ''}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: touch,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: error ? c.danger : c.borderStrong,
          backgroundColor: pressed ? c.muted : c.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        })}>
        <Txt variant="bodyLg" style={{ flex: 1 }} color={selected ? 'text' : 'textMuted'} numberOfLines={1}>
          {selected?.title ?? placeholder ?? label}
        </Txt>
        <ChevronDown size={20} color={c.textMuted} />
      </Pressable>
      <ErrorText error={error} />
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
      />
    </View>
  );
}

export function PickerSheet<T extends { id: string; title: string; subtitle?: string }>({
  visible,
  title,
  items,
  value,
  onPick,
  onClose,
  allowNone,
  footer,
}: {
  visible: boolean;
  title: string;
  items: T[];
  value: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  allowNone?: boolean;
  footer?: ReactNode;
}) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const shown = q ? items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase())) : items;
  const rows = allowNone ? [{ id: '', title: '—' } as T, ...shown] : shown;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} accessibilityLabel={t('close')} />
      <View
        style={{
          maxHeight: '75%',
          backgroundColor: c.bg,
          borderTopLeftRadius: radius.lg + 8,
          borderTopRightRadius: radius.lg + 8,
          paddingBottom: insets.bottom + space.md,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, paddingBottom: space.sm }}>
          <Txt variant="title" weight="bold" style={{ flex: 1 }}>
            {title}
          </Txt>
          <IconButton icon={X} label={t('close')} onPress={onClose} />
        </View>
        {items.length > 8 ? (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="…"
              placeholderTextColor={c.textMuted}
              style={{
                minHeight: 48,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: c.borderStrong,
                paddingHorizontal: space.md,
                color: c.text,
                backgroundColor: c.card,
                fontSize: type.body,
              }}
            />
          </View>
        ) : null}
        <FlatList
          data={rows}
          keyExtractor={(i) => i.id || 'none'}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const on = (item.id || null) === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => onPick(item.id || null)}
                style={({ pressed }) => ({
                  minHeight: touch,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  backgroundColor: pressed ? c.muted : on ? c.primarySoft : 'transparent',
                })}>
                <View style={{ flex: 1 }}>
                  <Txt weight={on ? 'bold' : 'regular'} variant="bodyLg">
                    {item.title}
                  </Txt>
                  {item.subtitle ? (
                    <Txt variant="caption" color="textMuted">
                      {item.subtitle}
                    </Txt>
                  ) : null}
                </View>
                {on ? <Check size={22} color={c.primary} strokeWidth={3} /> : null}
              </Pressable>
            );
          }}
        />
        {footer ? <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>{footer}</View> : null}
      </View>
    </Modal>
  );
}
