import { Stack, useLocalSearchParams } from 'expo-router';
import { Phone, Trash2, UserRound, Wrench } from 'lucide-react-native';
import { useState } from 'react';

import { Button, HeaderButton } from '@/components/ui/Button';
import { AmountField, Field } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { tx, useFirst } from '@/db';
import { assignWorker, deleteRecord, saveWorker } from '@/db/repo';
import type { Worker } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { centsToInput, parseCents } from '@/lib/money';

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

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newWorker' : 'editWorker'),
          headerRight: form.isNew
            ? undefined
            : () => <HeaderButton icon={Trash2} tone="danger" label={t('delete')} onPress={() => form.confirmDelete(() => deleteRecord('workers', form.id))} />,
        }}
      />
      <Screen footer={<Button label={t('save')} onPress={onSave} full />} gap={20}>
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
