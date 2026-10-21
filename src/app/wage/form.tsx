import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { AmountField, Chips, DateField, Field, SelectField } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst } from '@/db';
import { saveWageEntry } from '@/db/repo';
import type { WageEntry, WageKind } from '@/db/types';
import { useCurrentProjectId, useProjects, useWorkers } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';

const DAY_CHOICES = ['0.5', '1', '1.5', '2'];

export default function WageForm() {
  const params = useLocalSearchParams<{ id?: string; workerId?: string; kind?: WageKind; amount?: string }>();
  const existing = useFirst<WageEntry>('SELECT * FROM wage_entries WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} params={params} />;
}

function Inner({ existing, params }: { existing: WageEntry | null; params: { workerId?: string; kind?: WageKind; amount?: string } }) {
  const t = useT();
  const form = useRecordForm('wage_entries', existing?.id);
  const workers = useWorkers(!existing);
  const projects = useProjects(false);
  const current = useCurrentProjectId();

  const kind: WageKind = existing?.kind ?? params.kind ?? 'work';
  const [workerId, setWorkerId] = useState<string | null>(existing?.worker_id ?? params.workerId ?? null);
  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? current);
  const [day, setDay] = useState(existing?.day ?? today());
  const [days, setDays] = useState(existing?.days != null ? String(existing.days) : '1');
  const [amount, setAmount] = useState(
    existing ? centsToInput(existing.amount_cents) : params.amount ? centsToInput(Number(params.amount)) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const worker = workers.find((w) => w.id === workerId);

  // For work, the amount follows days × daily rate unless the user types their own.
  const [amountTouched, setAmountTouched] = useState(!!existing);
  const nDays = Number(days);
  const autoAmount = kind === 'work' && worker?.daily_rate_cents && nDays > 0 ? Math.round(worker.daily_rate_cents * nDays) : null;
  const shownAmount = kind === 'work' && !amountTouched && autoAmount != null ? centsToInput(autoAmount) : amount;

  function onSave() {
    form.submit(() =>
      saveWageEntry({
        id: form.id,
        worker_id: workerId,
        project_id: projectId,
        day,
        kind,
        days: kind === 'work' ? nDays : null,
        amount_cents: parseCents(shownAmount),
        note,
      }),
    );
  }

  const title = kind === 'work' ? 'recordWork' : kind === 'advance' ? 'giveAdvance' : 'payWages';

  return (
    <>
      <Stack.Screen options={{ title: t(title) }} />
      <Screen footer={<Button label={t('save')} onPress={onSave} />}>
        <SelectField
          label={t('worker')}
          items={workers.map((w) => ({ id: w.id, title: w.name, subtitle: w.trade ?? undefined }))}
          value={workerId}
          onChange={setWorkerId}
          error={form.err('worker_id')}
          placeholder={t('worker')}
        />
        {kind === 'work' ? (
          <>
            <Chips
              label={t('days')}
              value={DAY_CHOICES.includes(days) ? days : null}
              onChange={setDays}
              options={DAY_CHOICES.map((d) => ({ value: d, label: d }))}
              error={form.err('days')}
            />
            <Field label={t('days')} value={days} onChangeText={setDays} keyboardType="decimal-pad" />
            {worker?.daily_rate_cents ? (
              <Txt color="textMuted" numeric>
                {t('dailyRate')} {formatLKR(worker.daily_rate_cents)}
              </Txt>
            ) : null}
          </>
        ) : null}
        <AmountField
          label={t('amount')}
          value={shownAmount}
          onChangeText={(s) => {
            setAmountTouched(true);
            setAmount(s);
          }}
          error={form.err('amount')}
        />
        <DateField label={t('date')} value={day} onChange={setDay} />
        <SelectField
          label={t('project')}
          optional
          allowNone
          items={projects.map((p) => ({ id: p.id, title: p.name }))}
          value={projectId}
          onChange={setProjectId}
          error={form.err('project_id')}
          placeholder="—"
        />
        <Field label={t('note')} optional value={note} onChangeText={setNote} />
      </Screen>
    </>
  );
}
