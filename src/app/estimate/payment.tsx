import { Stack, useLocalSearchParams } from 'expo-router';
import { Calculator, Percent, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { PresetField } from '@/components/EstimateBits';
import { Button, IconButton } from '@/components/ui/Button';
import { Field } from '@/components/ui/form';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst } from '@/db';
import { removeEstimatePayment, saveEstimatePayment } from '@/db/estimates';
import type { EstimatePayment } from '@/db/types';
import { useEstimatePayments, useEstimateTotal } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { allocatePayments, formatPercent, parsePercent, STANDARD_SCHEDULE } from '@/lib/estimate';
import { formatLKR } from '@/lib/money';
import { space, useColors } from '@/theme';

/** The usual stages. The first three are the ones "Use standard schedule" makes, so they are printed in English like those. */
const STAGES = [...STANDARD_SCHEDULE.map((s) => s.label), 'Retention'];

type Params = { estimateId?: string; id?: string };

/** Add or change one stage of an estimate's payment schedule (opened from the estimate's hub). */
export default function EstimatePaymentScreen() {
  const params = useLocalSearchParams<Params>();
  const existing = useFirst<EstimatePayment>('SELECT * FROM estimate_payments WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  // Wait for the row before building the form, so the inputs start with its values.
  if (params.id && !existing) return null;
  return <StageForm key={existing?.id ?? 'new'} estimateId={existing?.estimate_id ?? params.estimateId ?? ''} existing={existing} />;
}

function StageForm({ estimateId, existing }: { estimateId: string; existing: EstimatePayment | null }) {
  const t = useT();
  const c = useColors();
  const form = useRecordForm('estimate_payments', existing?.id);
  const total = useEstimateTotal(estimateId);
  const stages = useEstimatePayments(estimateId);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [percent, setPercent] = useState(existing ? formatPercent(existing.percent_bp) : '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([label, percent]);

  // What the other stages already take, and so how much this one may still have.
  const others = stages.filter((s) => s.id !== form.id);
  const taken = others.reduce((sum, s) => sum + s.percent_bp, 0);
  const free = Math.max(0, 10000 - taken);

  // The amount as the schedule will show it: this stage in its place among the others (the last stage of a full schedule takes the remainder).
  const bp = parsePercent(percent);
  const found = existing ? stages.findIndex((s) => s.id === existing.id) : -1;
  const slot = found >= 0 ? found : stages.length;
  const shares = stages.map((s) => s.percent_bp);
  if (bp != null) shares[slot] = bp;
  const amount = bp != null && total ? (allocatePayments(total.total_cents, shares)[slot] ?? null) : null;

  function onSave() {
    form.submit(() => {
      saveEstimatePayment({ id: form.id, estimate_id: estimateId, label, percent_bp: bp });
    });
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'addStage' : 'editStage'),
          headerRight: form.isNew
            ? undefined
            : () => (
                <IconButton
                  icon={Trash2}
                  label={t('delete')}
                  tone="danger"
                  size={44}
                  pressedBg="headerDeep"
                  onPress={() => form.confirmDelete(() => removeEstimatePayment(form.id))}
                />
              ),
        }}
      />
      <Screen footer={<Button label={t('save')} onPress={onSave} full />}>
        <PresetField
          label={t('stageName')}
          fieldLabel={t('stageName')}
          hideFieldLabel
          presets={STAGES.map((s) => ({ value: s, label: s }))}
          value={label}
          onChangeText={(s) => {
            setLabel(s);
            form.clearError('label');
          }}
          numeric
          placeholder={t('phStage')}
          error={form.err('label')}
          returnKeyType="next"
        />
        <Field
          label={t('stagePercent')}
          value={percent}
          onChangeText={(s) => {
            setPercent(s);
            form.clearError('percent');
          }}
          error={form.err('percent')}
          icon={Percent}
          placeholder={t('phPercent')}
          hint={t('percentAvailable', { pct: formatPercent(free) })}
          keyboardType="decimal-pad"
          autoFocus={!form.isNew}
        />
        <Card tone={amount == null ? undefined : 'primarySoft'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Calculator size={22} color={amount == null ? c.textMuted : c.primary} strokeWidth={2} />
            <Txt eyebrow style={{ flex: 1 }}>
              {t('amount')}
            </Txt>
            <Txt variant="title" weight="bold" numeric adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={{ flexShrink: 1, color: amount == null ? c.textMuted : c.primary }}>
              {amount == null ? '—' : formatLKR(amount)}
            </Txt>
          </View>
        </Card>
      </Screen>
    </>
  );
}
