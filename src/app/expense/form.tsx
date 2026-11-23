import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Banknote, Building2, Check, FileText, Landmark, Store, Trash2, type LucideIcon } from 'lucide-react-native';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { CATEGORY_ICON } from '@/components/categoryIcons';
import { PhotoStrip } from '@/components/PhotoStrip';
import { Button, HeaderButton } from '@/components/ui/Button';
import { DateField, Field, groupTyped, HelperText, Label, SelectField } from '@/components/ui/form';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst } from '@/db';
import { deleteRecord, saveExpense } from '@/db/repo';
import { EXPENSE_CATEGORIES, PAY_METHODS, type Expense, type ExpenseCategory, type PayMethod } from '@/db/types';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { centsToInput, formatAmount, parseCents } from '@/lib/money';
import { FONT_MAP, radius, space, touchMin, type, useColors, useElevation, useTextScale } from '@/theme';

const METHOD_ICON: Record<PayMethod, LucideIcon> = { cash: Banknote, bank: Landmark, cheque: FileText };

export default function ExpenseForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const existing = useFirst<Expense>('SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  // Wait for the row before building the form, so the inputs start with its values.
  if (params.id && !existing) return null;
  return <ExpenseFormInner key={existing?.id ?? 'new'} existing={existing} />;
}

function ExpenseFormInner({ existing }: { existing: Expense | null }) {
  const t = useT();
  const form = useRecordForm('expenses', existing?.id);
  const allProjects = useProjects();
  const openProjects = allProjects.filter((p) => p.status !== 'completed');
  const current = useCurrentProjectId();

  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? current ?? (openProjects.length === 1 ? openProjects[0].id : null));
  // Completed projects are not offered for new records, but the one this form opened on (the current
  // project, or the record's own) stays in the list, so the field never shows "Choose project" over a saved id.
  const [openedOn] = useState(projectId);
  const projectItems = useMemo(
    () =>
      allProjects
        .filter((p) => p.status !== 'completed' || p.id === openedOn || p.id === projectId)
        .map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · ') })),
    [allProjects, openedOn, projectId, t],
  );
  const [amount, setAmount] = useState(existing ? centsToInput(existing.amount_cents) : '');
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'materials');
  const [day, setDay] = useState(existing?.day ?? today());
  const [paidTo, setPaidTo] = useState(existing?.paid_to ?? '');
  const [method, setMethod] = useState<PayMethod>(existing?.method ?? 'cash');
  const [note, setNote] = useState(existing?.note ?? '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([projectId, amount, category, day, paidTo, method, note]);

  function onSave() {
    form.submit(() =>
      saveExpense({
        id: form.id,
        project_id: projectId,
        day,
        category,
        amount_cents: parseCents(amount),
        paid_to: paidTo,
        method,
        note,
      }),
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newExpense' : 'editExpense'),
          headerRight: form.isNew
            ? undefined
            : () => <HeaderButton icon={Trash2} label={t('delete')} tone="danger" onPress={() => form.confirmDelete(() => deleteRecord('expenses', form.id))} />,
        }}
      />
      <Screen footer={<Button icon={Check} label={t('save')} onPress={onSave} full />} gap={space.lg + 4}>
        <BigAmount
          label={t('amount')}
          value={amount}
          onChangeText={(v) => {
            setAmount(v);
            form.clearError('amount');
          }}
          error={form.err('amount')}
          autoFocus={form.isNew}
        />
        <CategoryGrid label={t('category')} value={category} onChange={setCategory} />
        <Field label={t('paidTo')} optional icon={Store} placeholder={t('phPaidTo')} hint={t('paidToHint')} value={paidTo} onChangeText={setPaidTo} />
        <MethodTrack label={t('method')} value={method} onChange={setMethod} />
        <DateField label={t('date')} value={day} onChange={setDay} />
        <SelectField
          label={t('project')}
          items={projectItems}
          value={projectId}
          onChange={(id) => {
            setProjectId(id);
            form.clearError('project_id');
          }}
          error={form.err('project_id')}
          placeholder={t('chooseProject')}
        />
        <PhotoStrip ownerTable="expenses" ownerId={form.id} label={t('receiptPhotos')} context="expense.photos" />
        <Field label={t('note')} optional placeholder={t('phExpenseNote')} value={note} onChangeText={setNote} multiline />
      </Screen>
    </>
  );
}

/**
 * The amount as the hero of the form (Blueprint): a white card, the label on top, "Rs" and the amount large and
 * centred over a blue line. Typing works like every amount box: thousands separators as typed, the keypad's comma at
 * the end is a decimal point, and leaving the box tidies "1250.5" to "1,250.50".
 */
function BigAmount({
  label,
  value,
  onChangeText,
  error,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const c = useColors();
  const t = useT();
  const k = useTextScale();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [focus, setFocus] = useState(false);
  const shown = !value
    ? value
    : focus
      ? groupTyped(value)
      : (() => {
          const cents = parseCents(value);
          return cents === null ? value : formatAmount(cents);
        })();
  return (
    <Card padding={space.xl} gap={space.sm}>
      <Pressable accessible={false} onPress={() => ref.current?.focus()} style={{ alignItems: 'center', gap: space.sm }}>
        <Txt weight="semibold" color="textMuted" center>
          {label}
        </Txt>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.md,
            alignSelf: 'stretch',
            paddingBottom: space.sm,
            borderBottomWidth: 2,
            borderBottomColor: error ? c.danger : focus ? c.primary : c.primarySoft2,
          }}>
          <Txt variant="title" weight="bold" color="textMuted" numeric>
            {t('rs')}
          </Txt>
          <TextInput
            ref={ref}
            accessibilityLabel={label}
            value={shown}
            onChangeText={(s) => {
              if (s.replace(/,/g, '') === (value ?? '').replace(/,/g, '')) {
                // The keypad's comma typed at the end is a decimal point ("12,50" is 12.50); anything else equal is Android echoing back the grouped text.
                if (s.endsWith(',') && value && !value.includes('.') && s.length === groupTyped(value).length + 1) onChangeText(groupTyped(`${value}.`));
                return;
              }
              onChangeText(groupTyped(s));
            }}
            keyboardType="decimal-pad"
            returnKeyType="done"
            autoFocus={autoFocus}
            placeholder="0"
            placeholderTextColor={c.placeholder}
            onFocus={() => setFocus(true)}
            onBlur={() => {
              setFocus(false);
              const cents = parseCents(value);
              const tidy = cents === null ? null : formatAmount(cents);
              // tidy "1250.5" to "1,250.50", but adding commas alone is not a change (no "Discard changes?" for it)
              if (value && tidy !== null && tidy.replace(/,/g, '') !== value.replace(/,/g, '')) onChangeText(tidy);
            }}
            maxFontSizeMultiplier={1.2}
            style={{
              minWidth: 80,
              flexShrink: 1,
              minHeight: 56,
              paddingVertical: 0,
              fontSize: type.amountXl * k,
              fontFamily: FONT_MAP.en.bold,
              color: c.text,
              textAlign: 'center',
              fontVariant: ['tabular-nums'],
            }}
          />
        </View>
      </Pressable>
      {error ? (
        <View style={{ alignItems: 'center' }}>
          <HelperText error={error} />
        </View>
      ) : null}
    </Card>
  );
}

/** Categories as a grid of three tiles a row, each with its icon; the chosen one is blue. */
function CategoryGrid({ label, value, onChange }: { label: string; value: ExpenseCategory; onChange: (v: ExpenseCategory) => void }) {
  const t = useT();
  const c = useColors();
  const lift = useElevation('card');
  return (
    <View style={{ gap: space.sm }}>
      <Label text={label} />
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {EXPENSE_CATEGORIES.map((k) => {
          const on = k === value;
          const Icon = CATEGORY_ICON[k];
          const name = t(`cat_${k}`);
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={name}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange(k);
              }}
              style={({ pressed }) => ({
                flexGrow: 1,
                flexBasis: '30%',
                minWidth: 92,
                minHeight: 96,
                paddingVertical: space.md,
                paddingHorizontal: space.sm,
                borderRadius: radius.md + 2,
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.sm,
                backgroundColor: on ? (pressed ? c.fillPressed : c.fill) : pressed ? c.muted : c.card,
                ...(on ? null : lift),
              })}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md - 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? c.headerSoft : c.primarySoft,
                }}>
                <Icon size={20} color={on ? c.onFill : c.primary} strokeWidth={1.9} />
              </View>
              <Txt variant="caption" weight="bold" center numberOfLines={2} style={{ color: on ? c.onFill : c.text }}>
                {name}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Paid by: Cash · Bank · Cheque in one grey track with their icons; the chosen one is a white raised pill. */
function MethodTrack({ label, value, onChange }: { label: string; value: PayMethod; onChange: (v: PayMethod) => void }) {
  const t = useT();
  const c = useColors();
  const lift = useElevation('field');
  return (
    <View style={{ gap: space.sm }}>
      <Label text={label} />
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', backgroundColor: c.surface2, borderRadius: radius.md, padding: 3, gap: 2 }}>
        {PAY_METHODS.map((m) => {
          const on = m === value;
          const Icon = METHOD_ICON[m];
          const name = t(`method_${m}`);
          return (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={name}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange(m);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: touchMin,
                borderRadius: radius.md - 3,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingHorizontal: space.xs,
                backgroundColor: on ? c.card : pressed ? c.muted : 'transparent',
                ...(on ? lift : null),
              })}>
              <Icon size={17} color={on ? c.primary : c.textMuted} strokeWidth={2} />
              <Txt weight={on ? 'bold' : 'semibold'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1, color: on ? c.primary : c.textMuted }}>
                {name}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
