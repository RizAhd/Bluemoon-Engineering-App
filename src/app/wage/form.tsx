import { Stack, useLocalSearchParams } from 'expo-router';
import { Building2, Trash2 } from 'lucide-react-native';
import { useState } from 'react';

import { Button, HeaderButton } from '@/components/ui/Button';
import { AmountField, Chips, DateField, Field, SelectField } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveWageEntry } from '@/db/repo';
import type { WageEntry, WageKind } from '@/db/types';
import { useCurrentProjectId, useProjects, useProjectWorkers, useWorkers } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT, type TKey } from '@/i18n';
import { today } from '@/lib/dates';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';

const DAY_CHOICES: { value: string; label: string; a11y: TKey }[] = [
  { value: '0.5', label: '½', a11y: 'halfDay' },
  { value: '1', label: '1', a11y: 'fullDay' },
  { value: '1.5', label: '1½', a11y: 'oneAndHalf' },
  { value: '2', label: '2', a11y: 'twoDays' },
];

export default function WageForm() {
  const params = useLocalSearchParams<{ id?: string; workerId?: string; kind?: WageKind; amount?: string; projectId?: string }>();
  const existing = useFirst<WageEntry>('SELECT * FROM wage_entries WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} params={params} />;
}

function Inner({ existing, params }: { existing: WageEntry | null; params: { workerId?: string; kind?: WageKind; amount?: string; projectId?: string } }) {
  const t = useT();
  const form = useRecordForm('wage_entries', existing?.id);
  const allWorkers = useWorkers(!existing);
  const projects = useProjects(false);
  const current = useCurrentProjectId();

  const kind: WageKind = existing?.kind ?? params.kind ?? 'work';
  const [workerId, setWorkerId] = useState<string | null>(existing?.worker_id ?? params.workerId ?? null);
  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? params.projectId ?? current);
  const [day, setDay] = useState(existing?.day ?? today());
  const [days, setDays] = useState(existing?.days != null ? String(existing.days) : '1');
  const [amount, setAmount] = useState(
    existing ? centsToInput(existing.amount_cents) : params.amount ? centsToInput(Number(params.amount)) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');

  // Prefer the project's own roster (with its rates); fall back to every worker.
  const roster = useProjectWorkers(projectId);
  const rosterRows = existing ? roster : roster.filter((r) => r.active);
  const useRoster = rosterRows.length > 0;
  const items = useRoster
    ? rosterRows.map((r) => ({ id: r.worker_id, title: r.name, subtitle: r.trade ?? undefined }))
    : allWorkers.map((w) => ({ id: w.id, title: w.name, subtitle: w.trade ?? undefined }));
  const workerValue = items.some((i) => i.id === workerId) ? workerId : null;

  const rosterRow = rosterRows.find((r) => r.worker_id === workerValue);
  const worker = allWorkers.find((w) => w.id === workerValue);
  const rate = rosterRow?.rate_cents || worker?.daily_rate_cents || 0;

  // For work, the amount follows days × rate unless the user types their own.
  const [amountTouched, setAmountTouched] = useState(!!existing);
  const nDays = Number(days);
  const autoAmount = kind === 'work' && rate > 0 && nDays > 0 ? Math.round(rate * nDays) : null;
  const shownAmount = kind === 'work' && !amountTouched && autoAmount != null ? centsToInput(autoAmount) : amount;

  function onSave() {
    form.submit(() =>
      saveWageEntry({
        id: form.id,
        worker_id: workerValue,
        project_id: projectId,
        day,
        kind,
        days: kind === 'work' ? nDays : null,
        amount_cents: parseCents(shownAmount),
        note,
      }),
    );
  }

  const title: TKey = kind === 'work' ? 'recordWork' : kind === 'advance' ? 'giveAdvance' : 'payWages';

  return (
    <>
      <Stack.Screen
        options={{
          title: t(title),
          headerRight: existing
            ? () => (
                <HeaderButton
                  icon={Trash2}
                  label={t('delete')}
                  tone="danger"
                  onPress={() => form.confirmDelete(() => deleteRecord('wage_entries', existing.id))}
                />
              )
            : undefined,
        }}
      />
      <Screen gap={20} footer={<Button label={t('save')} onPress={onSave} />}>
        <SelectField
          label={t('project')}
          items={projects.map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: p.location ?? undefined }))}
          value={projectId}
          onChange={(id) => {
            setProjectId(id);
            form.clearError('project_id');
          }}
          error={form.err('project_id')}
          placeholder={t('chooseProject')}
        />
        <SelectField
          label={t('worker')}
          items={items}
          value={workerValue}
          onChange={(id) => {
            setWorkerId(id);
            form.clearError('worker_id');
          }}
          error={form.err('worker_id')}
          placeholder={t('worker')}
        />
        {kind === 'work' ? (
          <>
            <Chips
              label={t('days')}
              numeric
              value={DAY_CHOICES.some((d) => d.value === days) ? days : null}
              onChange={(v) => {
                setDays(v);
                form.clearError('days');
              }}
              options={DAY_CHOICES.map((d) => ({ value: d.value, label: d.label, accessibilityLabel: t(d.a11y) }))}
              error={form.err('days')}
            />
            <Field
              label={t('days')}
              hideLabel
              value={days}
              onChangeText={(s) => {
                setDays(s);
                form.clearError('days');
              }}
              keyboardType="decimal-pad"
              hint={rate > 0 ? `${t('dailyRate')} ${formatLKR(rate)}` : undefined}
            />
          </>
        ) : null}
        <AmountField
          label={t('amount')}
          value={shownAmount}
          onChangeText={(s) => {
            setAmountTouched(true);
            setAmount(s);
            form.clearError('amount');
          }}
          hint={kind === 'work' && rate > 0 && nDays > 0 ? `${days} × ${formatLKR(rate)}` : undefined}
          error={form.err('amount')}
        />
        <DateField label={t('date')} value={day} onChange={setDay} maxDay={today()} error={form.err('day')} />
        <Field label={t('note')} optional value={note} onChangeText={setNote} />
      </Screen>
    </>
  );
}
