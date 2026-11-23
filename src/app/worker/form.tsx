import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check, Phone, Trash2, UserRound, Wrench } from 'lucide-react-native';
import { useState } from 'react';

import { Button, HeaderButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { AmountField, Field } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { first, tx, useFirst } from '@/db';
import { assignWorker, deleteRecord, saveWorker } from '@/db/repo';
import type { Worker } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { showError } from '@/lib/errors';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';

export default function WorkerForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const existing = useFirst<Worker>('SELECT * FROM workers WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} />;
}

function Inner({ existing }: { existing: Worker | null }) {
  const t = useT();
  const form = useRecordForm('workers', existing?.id);
  const pid = useCurrentProjectId();
  const [name, setName] = useState(existing?.name ?? '');
  const [trade, setTrade] = useState(existing?.trade ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [rate, setRate] = useState(existing?.daily_rate_cents ? centsToInput(existing.daily_rate_cents) : '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([name, trade, phone, rate]);
  const [rateError, setRateError] = useState<string | null>(null);

  function onSave() {
    const cents = rate.trim() ? parseCents(rate) : 0;
    if (cents == null) {
      setRateError(t('errAmount'));
      return;
    }
    form.submit(() =>
      tx(() => {
        const id = saveWorker({ id: form.id, name, trade, phone, daily_rate_cents: cents, active: existing ? !!existing.active : true });
        // A new worker made while a project is selected goes on that project, or every project-scoped list would hide them.
        if (form.isNew && pid) assignWorker({ project_id: pid, worker_id: id, rate_cents: cents });
      }),
    );
  }

  /** Deleting hides the worker from every list and from "Wages to pay": say so when money is still owed or paid ahead, and offer "Mark as left" instead. */
  function onDelete() {
    const balance = first<{ b: number }>('SELECT balance_cents AS b FROM v_worker_balance WHERE worker_id = ?', [form.id])?.b ?? 0;
    const remove = () => deleteRecord('workers', form.id);
    if (!balance || !existing) return form.confirmDelete(remove);
    form.confirmDelete(remove, 1, {
      body: t(balance > 0 ? 'deleteWorkerOwedBody' : 'deleteWorkerAheadBody', { amount: formatLKR(Math.abs(balance)) }),
      alt: {
        text: t('markInactive'),
        run: () => {
          try {
            saveWorker({ id: existing.id, name: existing.name, phone: existing.phone, trade: existing.trade, daily_rate_cents: existing.daily_rate_cents, active: false });
            toast(t('savedOnPhone'));
            form.allowLeave();
            router.back();
          } catch (e) {
            showError(e, 'worker.markLeft', t, { id: existing.id });
          }
        },
      },
    });
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newWorker' : 'editWorker'),
          headerRight: form.isNew
            ? undefined
            : () => <HeaderButton icon={Trash2} tone="danger" label={t('delete')} onPress={onDelete} />,
        }}
      />
      <Screen footer={<Button icon={Check} label={t('save')} onPress={onSave} full />} gap={20}>
        <Field
          label={t('name')}
          icon={UserRound}
          placeholder={t('phWorkerName')}
          autoCorrect={false}
          value={name}
          onChangeText={(s) => {
            setName(s);
            form.clearError('name');
          }}
          error={form.err('name')}
          autoFocus={form.isNew}
          autoCapitalize="words"
          returnKeyType="next"
        />
        <Field label={t('trade')} optional icon={Wrench} placeholder={t('tradeHint')} value={trade} onChangeText={setTrade} autoCapitalize="words" />
        <Field label={t('phone')} optional icon={Phone} placeholder={t('phPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <AmountField
          label={t('dailyRate')}
          placeholder={t('phDayRate')}
          value={rate}
          onChangeText={(s) => {
            setRate(s);
            setRateError(null);
            form.clearError('daily_rate');
          }}
          error={rateError ?? form.err('daily_rate')}
        />
      </Screen>
    </>
  );
}
