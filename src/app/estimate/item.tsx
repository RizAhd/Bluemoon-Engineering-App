import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Calculator, Ruler, Trash2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { PresetField } from '@/components/EstimateBits';
import { Button, IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { AmountField, Field } from '@/components/ui/form';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst } from '@/db';
import { loadEstimate, removeEstimateItem, saveEstimateItem } from '@/db/estimates';
import type { EstimateItem } from '@/db/types';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { formatQty, lineAmount, MAX_QTY_MILLI, MAX_RATE_CENTS, parseQty } from '@/lib/estimate';
import { showError } from '@/lib/errors';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { space, useColors } from '@/theme';

/**
 * The units of a Sri Lankan bill of quantities, most used first (cube = 100 cu.ft, L.S. = lump sum).
 * They are printed as typed, so they stay the same in every app language.
 */
const UNITS = ['sq.m', 'cu.m', 'sq.ft', 'cube', 'lin.m', 'rft', 'nos', 'kg', 'L.S.', 'perch', 'day'];

type Params = { estimateId?: string; id?: string };

/** Add or change one price line of an estimate (opened from the estimate's hub). */
export default function EstimateItemScreen() {
  const params = useLocalSearchParams<Params>();
  const existing = useFirst<EstimateItem>('SELECT * FROM estimate_items WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  // Wait for the row before building the form, so the inputs start with its values.
  if (params.id && !existing) return null;
  return <ItemForm key={existing?.id ?? 'new'} estimateId={existing?.estimate_id ?? params.estimateId ?? ''} existing={existing} />;
}

/** The discount cannot be more than the lines add up to, so a change to the lines can bring it down. Returns the new discount when it did. */
function discountAfter(estimateId: string, change: () => void): number | null {
  const before = loadEstimate(estimateId)?.total.discount_cents ?? null;
  change();
  const after = loadEstimate(estimateId)?.total.discount_cents ?? null;
  return before != null && after != null && after < before ? after : null;
}

function ItemForm({ estimateId, existing }: { estimateId: string; existing: EstimateItem | null }) {
  const t = useT();
  const c = useColors();
  const form = useRecordForm('estimate_items', existing?.id);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [qty, setQty] = useState(existing ? formatQty(existing.qty_milli) : '');
  const [rate, setRate] = useState(existing ? centsToInput(existing.rate_cents) : '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([description, qty, rate]);
  // "Save and add another" starts the form again; a new key remounts the description field, which takes the focus back.
  const [round, setRound] = useState(0);
  const adding = useRef(false);

  // The line amount as it will be worked out, shown while typing.
  const qtyMilli = parseQty(qty);
  const rateCents = parseCents(rate);
  const amount = qtyMilli != null && rateCents != null && qtyMilli <= MAX_QTY_MILLI && rateCents <= MAX_RATE_CENTS ? lineAmount(qtyMilli, rateCents) : null;

  const lines = () => ({ description, unit, qty_milli: qtyMilli, rate_cents: rateCents });

  function noticeFor(lowered: number | null) {
    if (lowered != null) toast(t('discountLowered', { amount: formatLKR(lowered) }));
  }

  function onSave() {
    const result = { lowered: null as number | null };
    form.submit(() => {
      result.lowered = discountAfter(estimateId, () => {
        saveEstimateItem({ id: form.id, estimate_id: estimateId, ...lines() });
      });
    });
    // after submit, so the notice replaces the "Saved on phone" toast instead of being replaced by it
    noticeFor(result.lowered);
  }

  function onSaveAndAdd() {
    if (adding.current) return;
    adding.current = true;
    try {
      const lowered = discountAfter(estimateId, () => {
        saveEstimateItem({ estimate_id: estimateId, ...lines() });
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(lowered != null ? t('discountLowered', { amount: formatLKR(lowered) }) : t('itemAdded'));
      // the next line: everything cleared except the unit, which is usually the same for a run of lines
      setDescription('');
      setQty('');
      setRate('');
      ['description', 'qty', 'rate'].forEach(form.clearError);
      setRound((r) => r + 1);
    } catch (e) {
      // the shared plumbing shows the field message and the toast
      form.submit(() => {
        throw e;
      });
    } finally {
      adding.current = false;
    }
  }

  function onDelete() {
    if (!existing) return;
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          let lowered: number | null;
          try {
            lowered = discountAfter(estimateId, () => removeEstimateItem(existing.id));
          } catch (e) {
            showError(e, 'delete', t, { table: 'estimate_items', id: existing.id });
            return;
          }
          toast(lowered != null ? t('discountLowered', { amount: formatLKR(lowered) }) : t('deleted'));
          router.back();
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'addItem' : 'editItem'),
          headerRight: form.isNew ? undefined : () => <IconButton icon={Trash2} label={t('delete')} tone="danger" size={44} pressedBg="headerDeep" onPress={onDelete} />,
        }}
      />
      <Screen
        footer={
          // side by side, so the footer is one row tall and the form keeps its room while the keyboard is up
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {form.isNew ? (
              <View style={{ flex: 1 }}>
                <Button kind="secondary" label={t('saveAndNext')} accessibilityLabel={t('saveAndAddAnother')} onPress={onSaveAndAdd} full />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button label={t('save')} onPress={onSave} full />
            </View>
          </View>
        }>
        <Field
          key={`description-${round}`}
          label={t('description')}
          placeholder={t('phDescription')}
          hint={t('descriptionHint')}
          multiline
          value={description}
          onChangeText={(s) => {
            setDescription(s);
            form.clearError('description');
          }}
          error={form.err('description')}
          autoFocus={form.isNew}
          returnKeyType="next"
        />
        <PresetField
          label={t('unit')}
          fieldLabel={t('otherUnit')}
          presets={UNITS.map((u) => ({ value: u, label: u }))}
          value={unit}
          onChangeText={setUnit}
          numeric
          icon={Ruler}
          placeholder={t('phUnit')}
          hint={t('unitHint')}
          returnKeyType="next"
        />
        <Field
          label={t('quantity')}
          value={qty}
          onChangeText={(s) => {
            setQty(s);
            form.clearError('qty');
          }}
          error={form.err('qty')}
          icon={Ruler}
          placeholder={t('phQty')}
          hint={t('qtyHint')}
          keyboardType="decimal-pad"
          returnKeyType="next"
        />
        <AmountField
          label={t('rate')}
          placeholder={t('phRate')}
          hint={unit.trim() ? t('rateHintUnit', { unit: unit.trim() }) : undefined}
          value={rate}
          onChangeText={(s) => {
            setRate(s);
            form.clearError('rate');
          }}
          error={form.err('rate')}
          returnKeyType="done"
          onSubmitEditing={onSave}
        />
        {/* the line as it will print: the working, then the amount */}
        <Card tone={amount == null ? undefined : 'primarySoft'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Calculator size={22} color={amount == null ? c.textMuted : c.primary} strokeWidth={2} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt eyebrow>{t('amount')}</Txt>
              {amount != null && qtyMilli != null && rateCents != null ? (
                <Txt variant="caption" color="textMuted" numeric numberOfLines={1}>
                  {`${[formatQty(qtyMilli), unit.trim()].filter(Boolean).join(' ')} × ${formatLKR(rateCents)}`}
                </Txt>
              ) : null}
            </View>
            <Txt variant="title" weight="bold" numeric adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={{ flexShrink: 1, color: amount == null ? c.textMuted : c.primary }}>
              {amount == null ? '—' : formatLKR(amount)}
            </Txt>
          </View>
        </Card>
      </Screen>
    </>
  );
}
