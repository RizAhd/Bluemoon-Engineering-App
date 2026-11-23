import { Stack, useLocalSearchParams } from 'expo-router';
import { Check, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, IconButton } from '@/components/ui/Button';
import { AmountField, DateField, Field, Segmented } from '@/components/ui/form';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst } from '@/db';
import { deleteRecord, saveReceipt } from '@/db/repo';
import { PAY_METHODS, type PayMethod, type ProjectReceipt } from '@/db/types';
import { useProject, useProjectReceived } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { receiptSummary } from '@/lib/receipts';
import { space } from '@/theme';

/** One payment from the client. Opened with `?projectId=` for a new one or `?id=` to change or delete one. */
export default function ReceiptForm() {
  const params = useLocalSearchParams<{ id?: string; projectId?: string }>();
  const existing = useFirst<ProjectReceipt>('SELECT * FROM project_receipts WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  // Wait for the row before building the form, so the inputs start with its values.
  if (params.id && !existing) return null;
  return <ReceiptFormInner key={existing?.id ?? 'new'} existing={existing} projectId={existing?.project_id ?? params.projectId ?? null} />;
}

/** Title and the project's name under it, for the white stack header. */
function HeaderTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ flexShrink: 1 }}>
      <Txt variant="title" weight="bold" numberOfLines={1} accessibilityRole="header">
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="caption" weight="semibold" color="textMuted" numberOfLines={1}>
          {subtitle}
        </Txt>
      ) : null}
    </View>
  );
}

function ReceiptFormInner({ existing, projectId }: { existing: ProjectReceipt | null; projectId: string | null }) {
  const t = useT();
  const form = useRecordForm('project_receipts', existing?.id);
  const project = useProject(projectId);
  const received = useProjectReceived(projectId);
  const [amount, setAmount] = useState(existing ? centsToInput(existing.amount_cents) : '');
  const [day, setDay] = useState(existing?.day ?? today());
  const [method, setMethod] = useState<PayMethod>(existing?.method ?? 'bank');
  const [note, setNote] = useState(existing?.note ?? '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([amount, day, method, note]);

  // What was already received, without this payment when it is being changed.
  const others = (received?.received_cents ?? 0) - (existing?.amount_cents ?? 0);

  function save() {
    form.submit(() => saveReceipt({ id: form.id, project_id: projectId, day, amount_cents: parseCents(amount), method, note }));
  }

  function onSave() {
    const cents = parseCents(amount);
    // A missing or impossible amount is reported under the box by the save itself, not by a question.
    if (cents == null || cents <= 0 || !project) return save();
    const sum = receiptSummary(project.contract_cents, others + cents);
    // One confirmation with the project and the amount; it also says when the total goes past the project value.
    Alert.alert(t('receiptConfirmTitle'), [`${project.name} — ${formatLKR(cents)}`, sum.over > 0 ? t('receiptConfirmOver') : null].filter(Boolean).join('\n'), [
      { text: t('cancel'), style: 'cancel' },
      { text: `${t('receiptConfirmTitle')} · ${formatLKR(cents)}`, onPress: save },
    ]);
  }

  // Under the amount: what the client will have paid with this payment, of the project value when there is one.
  const typed = parseCents(amount);
  const after = others + (typed != null && typed > 0 ? typed : 0);
  const afterLine = project?.contract_cents
    ? `${t('receivedSoFar')}: ${formatLKR(after)} / ${formatLKR(project.contract_cents)}`
    : `${t('receivedSoFar')}: ${formatLKR(after)}`;

  return (
    <>
      <Stack.Screen
        options={{
          title: t('moneyFromClient'),
          headerTitle: () => <HeaderTitle title={t('moneyFromClient')} subtitle={project?.name} />,
          headerRight: form.isNew
            ? undefined
            : () => (
                <IconButton
                  icon={Trash2}
                  label={t('delete')}
                  tone="danger"
                  size={44}
                  shape="boxed"
                  onPress={() => form.confirmDelete(() => deleteRecord('project_receipts', form.id))}
                />
              ),
        }}
      />
      <Screen footer={<Button icon={Check} label={t('save')} onPress={onSave} full />}>
        {/* the amount first, in its own card, with the running total under it */}
        <Card gap={space.sm}>
          <AmountField
            label={t('amountReceived')}
            value={amount}
            onChangeText={(v) => {
              setAmount(v);
              form.clearError('amount');
            }}
            error={form.err('amount') ?? form.err('project_id')}
            autoFocus={form.isNew}
          />
          {project ? (
            <Txt variant="caption" weight="semibold" color="textMuted" numeric center>
              {afterLine}
            </Txt>
          ) : null}
        </Card>
        <Segmented<PayMethod> label={t('method')} value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ value: m, label: t(`method_${m}`) }))} />
        <DateField label={t('date')} value={day} onChange={setDay} />
        <Field label={t('note')} optional placeholder={t('phReceiptNote')} value={note} onChangeText={setNote} multiline />
      </Screen>
    </>
  );
}
