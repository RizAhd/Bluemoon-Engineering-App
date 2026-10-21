import { Stack, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { AmountField, Field } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveWorker } from '@/db/repo';
import type { Worker } from '@/db/types';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { centsToInput, parseCents } from '@/lib/money';
import { space } from '@/theme';

export default function WorkerForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const existing = useFirst<Worker>('SELECT * FROM workers WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} />;
}

function Inner({ existing }: { existing: Worker | null }) {
  const t = useT();
  const form = useRecordForm('workers', existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [trade, setTrade] = useState(existing?.trade ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [rate, setRate] = useState(existing?.daily_rate_cents ? centsToInput(existing.daily_rate_cents) : '');
  const [rateError, setRateError] = useState<string | null>(null);

  function onSave() {
    const cents = rate.trim() ? parseCents(rate) : 0;
    if (cents == null) {
      setRateError(t('errAmount'));
      return;
    }
    form.submit(() =>
      saveWorker({ id: form.id, name, trade, phone, daily_rate_cents: cents, active: existing ? !!existing.active : true }),
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t(form.isNew ? 'newWorker' : 'editWorker') }} />
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {!form.isNew ? (
              <Button kind="danger" icon={Trash2} label={t('delete')} onPress={() => form.confirmDelete(() => deleteRecord('workers', form.id))} />
            ) : null}
            <Button label={t('save')} onPress={onSave} style={{ flex: 1 }} />
          </View>
        }>
        <Field label={t('name')} value={name} onChangeText={setName} error={form.err('name')} autoFocus={form.isNew} autoCapitalize="words" />
        <Field label={t('trade')} optional placeholder={t('tradeHint')} value={trade} onChangeText={setTrade} />
        <AmountField label={t('dailyRate')} value={rate} onChangeText={(s) => { setRate(s); setRateError(null); }} error={rateError} />
        <Field label={t('phone')} optional value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      </Screen>
    </>
  );
}
