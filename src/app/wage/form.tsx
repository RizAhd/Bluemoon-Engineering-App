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
  const everyone = useWorkers(false);
  const allProjects = useProjects();
  const current = useCurrentProjectId();

  const kind: WageKind = existing?.kind ?? params.kind ?? 'work';
  const [workerId, setWorkerId] = useState<string | null>(existing?.worker_id ?? params.workerId ?? null);
  // An existing entry keeps the project it was written on (an old one without a project must be given one);
  // only a new entry starts on the project that was chosen.
  const [startProjectId] = useState<string | null>(existing ? existing.project_id : (params.projectId ?? current));
  const [projectId, setProjectId] = useState<string | null>(startProjectId);
  const [day, setDay] = useState(existing?.day ?? today());
  const [days, setDays] = useState(existing?.days != null ? String(existing.days) : '1');
  const [amount, setAmount] = useState(
    existing ? centsToInput(existing.amount_cents) : params.amount ? centsToInput(Number(params.amount)) : '',
  );
  const [note, setNote] = useState(existing?.note ?? '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([workerId, projectId, day, days, amount, note]);

  // Completed projects are not offered for new work, but the one this form opened on always is,
  // so the field shows what will be saved.
  const projectItems = allProjects
    .filter((p) => p.status !== 'completed' || p.id === startProjectId)
    .map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: p.location ?? undefined }));
  const projectValue = projectItems.some((i) => i.id === projectId) ? projectId : null;

  // Prefer the project's own roster (with its rates); fall back to every worker.
  // "Mark as left" only changes the worker, so a new entry skips workers who left, except the one it was opened for.
  const roster = useProjectWorkers(projectValue);
  const activeIds = new Set(everyone.filter((w) => w.active).map((w) => w.id));
  const rosterRows = existing ? roster : roster.filter((r) => (r.active && activeIds.has(r.worker_id)) || r.worker_id === params.workerId);
  const useRoster = rosterRows.length > 0;
  const fallback = existing ? everyone : everyone.filter((w) => w.active || w.id === params.workerId);
  const listed = useRoster
    ? rosterRows.map((r) => ({ id: r.worker_id, title: r.name, subtitle: r.trade ?? undefined }))
    : fallback.map((w) => ({ id: w.id, title: w.name, subtitle: w.trade ?? undefined }));
  // The worker this form is for always stays selectable, even when the project's roster does not list them:
  // an entry's own worker (so editing it never has to reassign the wages), and the one the form was opened for or has picked
  // (a worker on no project, one taken off it or one who left would otherwise be dropped and Save would say "Choose a worker").
  const pinned = [existing?.worker_id, params.workerId, workerId]
    .filter((id, i, ids): id is string => !!id && ids.indexOf(id) === i && !listed.some((l) => l.id === id))
    .flatMap((id) => {
      const w = everyone.find((x) => x.id === id);
      return w ? [{ id: w.id, title: w.name, subtitle: w.trade ?? undefined }] : [];
    });
  const items = [...pinned, ...listed];
  const workerValue = items.some((i) => i.id === workerId) ? workerId : null;

  const rosterRow = rosterRows.find((r) => r.worker_id === workerValue);
  const worker = everyone.find((w) => w.id === workerValue);
  const rate = rosterRow?.rate_cents || worker?.daily_rate_cents || 0;

  // For work, the amount follows days × rate unless the user types their own.
  const [amountTouched, setAmountTouched] = useState(!!existing);
  const nDays = Number(days);
  // Paying or advancing: what the worker stands at on this project before this entry, so nobody is paid twice by mistake.
  const before = (roster.find((r) => r.worker_id === workerValue)?.balance_cents ?? 0) + (existing && existing.kind !== 'work' ? (existing.amount_cents ?? 0) : 0);
  const moneyHint =
    kind === 'work' || !workerValue || before === 0
      ? undefined
      : before > 0
        ? `${t('weOwe')} ${formatLKR(before)}`
        : `${t('workerOwes')} ${formatLKR(-before)}`;
  const autoAmount = kind === 'work' && rate > 0 && nDays > 0 ? Math.round(rate * nDays) : null;
  const shownAmount = kind === 'work' && !amountTouched && autoAmount != null ? centsToInput(autoAmount) : amount;

  function onSave() {
    form.submit(() =>
      saveWageEntry({
        id: form.id,
        worker_id: workerValue,
        project_id: projectValue,
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
          items={projectItems}
          value={projectValue}
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
          placeholder={t('chooseWorker')}
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
              // labelled, so the box under the chips says what it is for (e.g. 3 or 2.5 days)
              label={t('typeDays')}
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
            // The box re-formats itself when it loses focus. That is not an edit, so the amount keeps following days × rate.
            if (amountTouched || autoAmount == null || parseCents(s) !== autoAmount) setAmountTouched(true);
            setAmount(s);
            form.clearError('amount');
          }}
          hint={kind === 'work' && rate > 0 && nDays > 0 ? `${days} × ${formatLKR(rate)}` : moneyHint}
          error={form.err('amount')}
          // an advance or a payment is just an amount: the keypad opens at once (work starts from days × rate)
          autoFocus={form.isNew && kind !== 'work'}
        />
        <DateField label={t('date')} value={day} onChange={setDay} maxDay={today()} error={form.err('day')} />
        <Field label={t('note')} optional placeholder={t(kind === 'advance' ? 'phWageNote' : kind === 'work' ? 'phWorkNote' : 'phPayNote')} value={note} onChangeText={setNote} />
      </Screen>
    </>
  );
}
