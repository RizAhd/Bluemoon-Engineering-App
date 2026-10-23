import { Stack, useLocalSearchParams } from 'expo-router';
import { Building2, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button, IconButton } from '@/components/ui/Button';
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
            : () => (
                <IconButton
                  icon={Trash2}
                  label={t('delete')}
                  tone="danger"
                  size={44}
                  pressedBg="headerDeep"
                  onPress={() => form.confirmDelete(() => deleteRecord('expenses', form.id))}
                />
              ),
        }}
      />
      <Screen footer={<Button label={t('save')} onPress={onSave} full />}>
        <AmountField
          label={t('amount')}
          value={amount}
          onChangeText={(v) => {
            setAmount(v);
            form.clearError('amount');
          }}
          error={form.err('amount')}
          autoFocus={form.isNew}
        />
        <Chips
          label={t('category')}
          value={category}
          onChange={setCategory}
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`cat_${c}`) }))}
        />
        <PhotoStrip ownerTable="expenses" ownerId={form.id} label={t('receiptPhotos')} context="expense.photos" />
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
        <Field label={t('paidTo')} optional hint={t('paidToHint')} value={paidTo} onChangeText={setPaidTo} />
        <Chips
          label={t('method')}
          value={method}
          onChange={setMethod}
          options={PAY_METHODS.map((m) => ({ value: m, label: t(`method_${m}`) }))}
        />
        <Field label={t('note')} optional placeholder={t('phExpenseNote')} value={note} onChangeText={setNote} multiline />
      </Screen>
    </>
  );
}
