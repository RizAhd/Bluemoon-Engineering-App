import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Building2, CheckCircle2, Info, UserPlus } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Keyboard, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { AmountField, Checkbox, DateField, Segmented, SelectField } from '@/components/ui/form';
import { InfoLine, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import type { ProjectWorkerBalance, WageDay } from '@/db/types';
import { recordWorkDay, removeWorkDay, payWages } from '@/db/repo';
import { setCurrentProject, useCurrentProjectId, useProjects, useProjectWorkers, useWageDay } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { isValidDay, today } from '@/lib/dates';
import { guard } from '@/lib/errors';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { hairline, radius, space, useColors, useLayout } from '@/theme';

const DAY_CHOICES = ['0.5', '1', '1.5', '2'] as const;
const DAY_LABELS: Record<(typeof DAY_CHOICES)[number], { label: string; a11y: TKey }> = {
  '0.5': { label: '½', a11y: 'halfDay' },
  '1': { label: '1', a11y: 'fullDay' },
  '1.5': { label: '1½', a11y: 'oneAndHalf' },
  '2': { label: '2', a11y: 'twoDays' },
};

/** What the supervisor changed on one row since the sheet opened (everything else comes from the database). */
interface Draft {
  worked?: boolean;
  days?: number;
  amount?: string;
  pay?: string;
}

interface Vm {
  row: ProjectWorkerBalance;
  rec: WageDay | undefined;
  recorded: boolean;
  worked: boolean;
  days: number;
  amountStr: string;
  amountCents: number | null;
  paid: number;
  payStr: string;
  payCents: number;
  /** Cents still owed for this day, from the live amount. */
  remaining: number;
  error: TKey | null;
}

export default function TodaysWorkScreen() {
  const params = useLocalSearchParams<{ day?: string }>();
  const t = useT();
  const td = today();
  const pid = useCurrentProjectId();
  const projects = useProjects();
  const [day, setDay] = useState(params.day && isValidDay(params.day) && params.day <= td ? params.day : td);

  const roster = useProjectWorkers(pid);
  const dayRows = useWageDay(pid, day);

  const key = `${pid ?? ''}|${day}`;
  const [store, setStore] = useState<{ key: string; map: Record<string, Draft>; errors: Record<string, TKey> }>({ key, map: {}, errors: {} });
  const fresh = store.key === key;
  const drafts = fresh ? store.map : EMPTY_DRAFTS;
  const errors = fresh ? store.errors : EMPTY_ERRORS;
  const [busy, setBusy] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);

  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const dayMap = useMemo(() => new Map(dayRows.map((r) => [r.worker_id, r])), [dayRows]);

  const vms = useMemo<Vm[]>(() => {
    return roster
      .filter((r) => r.active || dayMap.has(r.worker_id))
      .map((row) => {
        const rec = dayMap.get(row.worker_id);
        const d = drafts[row.worker_id] ?? EMPTY_DRAFT;
        const recorded = rec?.days != null;
        const worked = d.worked ?? recorded;
        const days = d.days ?? (recorded ? (rec?.days as number) : 1);
        const auto = recorded && rec?.days === days ? rec.work_cents : Math.round(days * row.rate_cents);
        const amountStr = d.amount ?? (worked && auto > 0 ? centsToInput(auto) : '');
        const amountCents = amountStr.trim() === '' ? 0 : parseCents(amountStr);
        const paid = rec?.paid_cents ?? 0;
        const remaining = Math.max(0, (amountCents ?? 0) - paid);
        const payStr = d.pay ?? (remaining > 0 ? centsToInput(remaining) : '');
        const payCents = payStr.trim() === '' ? 0 : (parseCents(payStr) ?? 0);
        return { row, rec, recorded, worked, days, amountStr, amountCents, paid, payStr, payCents, remaining, error: errors[row.worker_id] ?? null };
      });
  }, [roster, dayMap, drafts, errors]);

  const patch = useCallback(
    (id: string, p: Draft) => {
      setStore((prev) => {
        const base = prev.key === key ? prev : { key, map: {}, errors: {} };
        const nextErrors = { ...base.errors };
        delete nextErrors[id];
        return { key, map: { ...base.map, [id]: { ...base.map[id], ...p } }, errors: nextErrors };
      });
    },
    [key],
  );

  const toggle = useCallback(
    (vm: Vm, next: boolean) => {
      if (next) {
        if (vm.row.rate_cents <= 0 && !vm.recorded) {
          router.push(`/worker/assign?projectId=${vm.row.project_id}&workerId=${vm.row.worker_id}`);
          return;
        }
        patch(vm.row.worker_id, { worked: true, days: vm.days, amount: undefined, pay: undefined });
        return;
      }
      const untick = () => patch(vm.row.worker_id, { worked: false, pay: '' });
      if (vm.paid > 0) {
        Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('delete'), style: 'destructive', onPress: untick },
        ]);
      } else {
        untick();
      }
    },
    [patch, t],
  );

  const workedRows = vms.filter((v) => v.worked);
  const totalWages = workedRows.reduce((s, v) => s + (v.amountCents ?? 0), 0);
  const totalPaid = workedRows.reduce((s, v) => s + v.paid + v.payCents, 0);
  const totalToPay = workedRows.reduce((s, v) => s + Math.max(0, (v.amountCents ?? 0) - v.paid - v.payCents), 0);
  const alreadyRecorded = dayRows.some((r) => r.days != null || r.paid_cents > 0);

  function markAll() {
    let skipped = false;
    for (const v of vms) {
      if (v.worked) continue;
      if (v.row.rate_cents <= 0) {
        skipped = true;
        continue;
      }
      patch(v.row.worker_id, { worked: true, days: 1, amount: undefined, pay: undefined });
    }
    if (skipped) toast(t('rateRequired'));
  }

  function payAllNow() {
    for (const v of workedRows) patch(v.row.worker_id, { pay: v.remaining > 0 ? centsToInput(v.remaining) : '' });
  }

  async function onSave() {
    if (!pid || busy) return;
    // Validate first so nothing is half-written because of a typo.
    const bad: Record<string, TKey> = {};
    for (const v of workedRows) {
      if (v.amountCents === null || v.amountCents <= 0) bad[v.row.worker_id] = 'errAmount';
      else if (parseCents(v.payStr || '0') === null) bad[v.row.worker_id] = 'errAmount';
    }
    if (Object.keys(bad).length) {
      setStore((prev) => ({ key, map: prev.key === key ? prev.map : {}, errors: bad }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast(t('errAmount'), { tone: 'danger' });
      return;
    }
    setBusy(true);
    const done = await guard('wage.today', t, () => {
      for (const v of vms) {
        const id = v.row.worker_id;
        if (v.worked) {
          const cents = v.amountCents as number;
          if (!v.recorded || v.rec?.days !== v.days || v.rec?.work_cents !== cents) {
            recordWorkDay({ project_id: pid, worker_id: id, day, days: v.days, amount_cents: cents });
          }
        } else if (v.recorded) {
          removeWorkDay(pid, id, day);
        }
      }
      for (const v of vms) {
        if (!v.worked || v.payCents <= 0) continue;
        payWages({ project_id: pid, worker_id: v.row.worker_id, day, amount_cents: v.payCents });
        // Written: clear the draft so a retry after a later failure cannot pay twice.
        patch(v.row.worker_id, { pay: '' });
      }
      return true;
    });
    setBusy(false);
    if (done) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(t('sheetSaved'));
      router.back();
    }
  }

  const { gutter, maxWidth } = useLayout();

  const projectField = (
    <SelectField
      label={t('project')}
      items={projects.map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · ') }))}
      value={pid}
      onChange={(id) => setCurrentProject(id)}
      placeholder={t('chooseProject')}
    />
  );

  if (!pid) {
    return (
      <>
        <Stack.Screen options={{ title: t('todaysWork') }} />
        <Screen>
          {projectField}
          <EmptyState icon={Building2} title={t('noProjectSelected')} hint={t('chooseProjectFirstHint')} />
        </Screen>
      </>
    );
  }

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.md }}>
      {projectField}
      <DateField label={t('date')} value={day} onChange={setDay} maxDay={td} />
      {alreadyRecorded ? (
        <InfoLine icon={Info} text={t('dayAlreadyRecorded')} />
      ) : null}
      {vms.length ? (
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Button compact kind="secondary" icon={CheckCircle2} label={t('markAllWorked')} onPress={markAll} />
          <Button compact kind="secondary" label={t('payAll')} onPress={payAllNow} />
        </View>
      ) : null}
    </View>
  );

  const addWorker = () => router.push(`/worker/assign?projectId=${pid}`);

  return (
    <>
      <Stack.Screen options={{ title: t('todaysWork') }} />
      <Screen
        scroll={false}
        footer={
          <>
            {kbOpen ? null : (
              <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <SummaryCell label={t('workersToday')} value={String(workedRows.length)} />
                  <SummaryCell label={t('wages')} value={formatLKR(totalWages)} />
                </View>
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <SummaryCell label={t('wagesPaidToday')} value={formatLKR(totalPaid)} tone="success" />
                  <SummaryCell label={t('toPayToday')} value={formatLKR(totalToPay)} tone={totalToPay > 0 ? 'danger' : 'text'} />
                </View>
              </View>
            )}
            <Button label={t('saveSheet')} onPress={onSave} loading={busy} />
          </>
        }>
        <FlatList
          data={vms}
          keyExtractor={(v) => v.row.worker_id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={8}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: space.xl, maxWidth, width: '100%', alignSelf: 'center' }}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon={UserPlus}
              title={t('noWorkersOnProject')}
              hint={t('noWorkersOnProjectHint')}
              action={<Button label={t('addWorkerToProject')} icon={UserPlus} onPress={addWorker} full />}
            />
          }
          ListFooterComponent={
            vms.length ? (
              <View style={{ marginTop: space.lg }}>
                <ListCard>
                  <ListRow icon={UserPlus} title={t('addWorkerToProject')} onPress={addWorker} />
                </ListCard>
              </View>
            ) : undefined
          }
          renderItem={({ item }) => <WorkerRow vm={item} onToggle={toggle} onPatch={patch} />}
        />
      </Screen>
    </>
  );
}

const EMPTY_DRAFTS: Record<string, Draft> = {};
const EMPTY_DRAFT: Draft = {};
const EMPTY_ERRORS: Record<string, TKey> = {};

function Gap() {
  return <View style={{ height: space.md }} />;
}

function SummaryCell({ label, value, tone = 'text' }: { label: string; value: string; tone?: 'text' | 'success' | 'danger' }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm }}>
      <Txt variant="caption" color="textMuted" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt weight="semibold" numeric color={tone} style={{ flexShrink: 0 }}>
        {value}
      </Txt>
    </View>
  );
}

const WorkerRow = memo(function WorkerRow({
  vm,
  onToggle,
  onPatch,
}: {
  vm: Vm;
  onToggle: (vm: Vm, next: boolean) => void;
  onPatch: (id: string, p: Draft) => void;
}) {
  const c = useColors();
  const t = useT();
  const { row, worked, paid } = vm;
  const wage = vm.amountCents ?? 0;
  const noRate = row.rate_cents <= 0;
  const overpay = vm.payCents > vm.remaining;
  const sub = noRate
    ? t('rateRequired')
    : [row.trade, `${formatLKR(row.rate_cents)} / ${t('day')}`, row.balance_cents > 0 ? `${t('weOwe')} ${formatLKR(row.balance_cents)}` : null].filter(Boolean).join(' · ');

  return (
    <View style={{ backgroundColor: c.card, borderRadius: radius.lg, borderWidth: hairline, borderColor: c.border, overflow: 'hidden' }}>
      <Pressable
        accessible={false}
        onPress={() => onToggle(vm, !worked)}
        android_ripple={{ color: c.muted }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 64,
          paddingRight: space.lg,
          paddingLeft: space.xs,
          backgroundColor: pressed ? c.muted : c.card,
        })}>
        <Checkbox checked={worked} label={row.name} onChange={(next) => onToggle(vm, next)} />
        <View style={{ flex: 1, paddingVertical: space.sm, gap: 2 }}>
          <Txt weight="semibold" numberOfLines={2}>
            {row.name}
          </Txt>
          <Txt variant="caption" color={noRate ? 'warning' : 'textMuted'} numberOfLines={2}>
            {sub}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: space.xs, marginLeft: space.sm, flexShrink: 0 }}>
          {worked ? (
            <>
              <Txt weight="semibold" numeric>
                {formatLKR(wage)}
              </Txt>
              {wage > 0 && paid >= wage ? (
                <Badge tone="success" icon={CheckCircle2} label={t('paid')} />
              ) : paid > 0 ? (
                <Badge tone="warning" label={`${t('paidToday')} ${formatLKR(paid)}`} />
              ) : null}
            </>
          ) : (
            <Txt variant="caption" color="textMuted">
              {t('notWorked')}
            </Txt>
          )}
        </View>
      </Pressable>

      {worked ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
          <Segmented
            label={t('days')}
            numeric
            value={(DAY_CHOICES as readonly string[]).includes(String(vm.days)) ? String(vm.days) : null}
            onChange={(v) => onPatch(row.worker_id, { days: Number(v), amount: undefined })}
            options={DAY_CHOICES.map((d) => ({ value: d, label: DAY_LABELS[d].label, accessibilityLabel: t(DAY_LABELS[d].a11y) }))}
          />
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt variant="caption" weight="semibold">
                {t('amount')}
              </Txt>
              <AmountField
                compact
                label={t('amount')}
                value={vm.amountStr}
                onChangeText={(s) => onPatch(row.worker_id, { amount: s })}
                error={vm.error ? t(vm.error) : null}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt variant="caption" weight="semibold">
                {t('payNow')}
              </Txt>
              <AmountField
                compact
                label={t('payNow')}
                value={vm.payStr}
                onChangeText={(s) => onPatch(row.worker_id, { pay: s })}
                hint={overpay ? t('payMore') : undefined}
                hintTone="warning"
              />
            </View>
          </View>
          {paid > 0 ? <InfoLine icon={CheckCircle2} tone="success" text={`${t('paidToday')} · ${formatLKR(paid)}`} /> : null}
        </View>
      ) : null}
    </View>
  );
});
