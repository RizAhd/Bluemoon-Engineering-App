import { Stack, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button } from '@/components/ui/Button';
import { AmountField, Chips, DateField, Field, SelectField } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveExpense } from '@/db/repo';
import { EXPENSE_CATEGORIES, PAY_METHODS, type Expense, type ExpenseCategory, type PayMethod } from '@/db/types';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { centsToInput, parseCents } from '@/lib/money';
import { space } from '@/theme';

export default function ExpenseForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const existing = useFirst<Expense>('SELECT * FROM expenses WHERE id = ?', [params.id ?? '']);
  // Wait for the row before building the form, so the inputs start with its values.
  if (params.id && !existing) return null;
  return <ExpenseFormInner existing={existing} />;
}

function ExpenseFormInner({ existing }: { existing: Expense | null }) {
  const t = useT();
  const form = useRecordForm('expenses', existing?.id);
  const projects = useProjects(false);
  const current = useCurrentProjectId();

  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? current ?? (projects.length === 1 ? projects[0].id : null));
  const [amount, setAmount] = useState(existing ? centsToInput(existing.amount_cents) : '');
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'materials');
  const [day, setDay] = useState(existing?.day ?? today());
  const [paidTo, setPaidTo] = useState(existing?.paid_to ?? '');
  const [method, setMethod] = useState<PayMethod>(existing?.method ?? 'cash');
  const [note, setNote] = useState(existing?.note ?? '');

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
      <Stack.Screen options={{ title: t(form.isNew ? 'newExpense' : 'editExpense') }} />
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {!form.isNew ? (
              <Button kind="danger" icon={Trash2} label={t('delete')} onPress={() => form.confirmDelete(() => deleteRecord('expenses', form.id))} />
            ) : null}
            <Button label={t('save')} onPress={onSave} style={{ flex: 1 }} />
          </View>
        }>
        <AmountField label={t('amount')} value={amount} onChangeText={setAmount} error={form.err('amount')} autoFocus={form.isNew} />
        <Chips
          label={t('category')}
          value={category}
          onChange={setCategory}
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`cat_${c}`) }))}
        />
        <PhotoStrip ownerTable="expenses" ownerId={form.id} label={t('receiptPhotos')} />
        <SelectField
          label={t('project')}
          items={projects.map((p) => ({ id: p.id, title: p.name, subtitle: p.location ?? undefined }))}
          value={projectId}
          onChange={setProjectId}
          error={form.err('project_id')}
          placeholder={t('chooseProject')}
        />
        <DateField label={t('date')} value={day} onChange={setDay} />
        <Field label={t('paidTo')} optional placeholder={t('paidToHint')} value={paidTo} onChangeText={setPaidTo} />
        <Chips
          label={t('method')}
          value={method}
          onChange={setMethod}
          options={PAY_METHODS.map((m) => ({ value: m, label: t(`method_${m}`) }))}
        />
        <Field label={t('note')} optional value={note} onChangeText={setNote} multiline />
      </Screen>
    </>
  );
}
