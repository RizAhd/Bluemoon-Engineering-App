import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Building2, CheckCircle2, Info, UserPlus } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Keyboard, Platform, Pressable, View } from 'react-native';

import { ShareHeaderButton, useShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { AmountField, Checkbox, DateField, Segmented, SelectField } from '@/components/ui/form';
import { InfoLine, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import type { ProjectWorkerBalance, WageDay } from '@/db/types';
import { recordWorkDay, removeWorkDay, payWages } from '@/db/repo';
import { setCurrentProject, useCurrentProjectId, useProjects, useProjectWorkers, useWageDay, useWorkers } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { isValidDay, today } from '@/lib/dates';
import { guard } from '@/lib/errors';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { hairline, listTuning, radius, space, useColors, useLayout } from '@/theme';

const DAY_CHOICES = ['0.5', '1', '1.5', '2'] as const;
const DAY_LABELS: Record<(typeof DAY_CHOICES)[number], { label: string; a11y: TKey }> = {
  '0.5': { label: '½', a11y: 'halfDay' },
  '1': { label: '1', a11y: 'fullDay' },
  '1.5': { label: '1½', a11y: 'oneAndHalf' },
  '2': { label: '2', a11y: 'twoDays' },
};

/**
 * What the supervisor typed on one row and has not been written yet. Work marks (tick, untick, days)
 * are written the moment they are tapped, so they are not drafts: they come from the database.
 */
interface Draft {
  /** A wage typed over the one from the database; written when the field is left or on Save today. */
  amount?: string;
  /** Pay now. Never pre-filled: money only moves when someone types an amount or confirms Pay all. */
  pay?: string;
}

interface Sheet {
  key: string;
  map: Record<string, Draft>;
  errors: Record<string, TKey>;
  payErrors: Record<string, TKey>;
}

interface Vm {
  row: ProjectWorkerBalance;
  rec: WageDay | undefined;
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
  payError: TKey | null;
}

interface PayLine {
  v: Vm;
  cents: number;
}

function newSheet(key: string): Sheet {
  return { key, map: {}, errors: {}, payErrors: {} };
}

function without(m: Record<string, TKey>, id: string): Record<string, TKey> {
  if (!(id in m)) return m;
  const next = { ...m };
  delete next[id];
  return next;
}

export default function TodaysWorkScreen() {
  const params = useLocalSearchParams<{ day?: string }>();
  const t = useT();
  const td = today();
  const pid = useCurrentProjectId();
  const projects = useProjects();
  const activeWorkers = useWorkers(true);
  const [day, setDay] = useState(params.day && isValidDay(params.day) && params.day <= td ? params.day : td);

  const roster = useProjectWorkers(pid);
  const dayRows = useWageDay(pid, day);

  const key = `${pid ?? ''}|${day}`;
  const [store, setStore] = useState<Sheet>(() => newSheet(key));
  const fresh = store.key === key;
  const drafts = fresh ? store.map : EMPTY_DRAFTS;
  const errors = fresh ? store.errors : EMPTY_ERRORS;
  const payErrors = fresh ? store.payErrors : EMPTY_ERRORS;
  const [busy, setBusy] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  // The day's work and pay of this project, as saved: amounts still being typed are saved first (openShare).
  const share = useShareSheet({ kind: 'daySheet', id: pid, options: { day } });

  // "Already recorded" is about the day as it was when the sheet opened: ticking a worker here must not make it appear.
  const hasRecorded = dayRows.some((r) => r.days != null || r.paid_cents > 0);
  const [opened, setOpened] = useState({ key, recorded: hasRecorded });
  if (opened.key !== key) setOpened({ key, recorded: hasRecorded });
  const alreadyRecorded = opened.key === key ? opened.recorded : hasRecorded;

  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const dayMap = useMemo(() => new Map(dayRows.map((r) => [r.worker_id, r])), [dayRows]);
  // "Mark as left" only changes the worker, not the project assignment, so check the worker's own flag too.
  const activeIds = useMemo(() => new Set(activeWorkers.map((w) => w.id)), [activeWorkers]);

  const vms = useMemo<Vm[]>(() => {
    return roster
      .filter((r) => (r.active && activeIds.has(r.worker_id)) || dayMap.has(r.worker_id))
      .map((row) => {
        const rec = dayMap.get(row.worker_id);
        const d = drafts[row.worker_id] ?? EMPTY_DRAFT;
        const worked = rec?.days != null;
        const days = rec?.days ?? 1;
        const wage = rec?.work_cents ?? 0;
        const amountStr = d.amount ?? (worked && wage > 0 ? centsToInput(wage) : '');
        const amountCents = amountStr.trim() === '' ? 0 : parseCents(amountStr);
        const paid = rec?.paid_cents ?? 0;
        const remaining = Math.max(0, (amountCents ?? 0) - paid);
        const payStr = d.pay ?? '';
        const payCents = payStr.trim() === '' ? 0 : (parseCents(payStr) ?? 0);
        return {
          row,
          rec,
          worked,
          days,
          amountStr,
          amountCents,
          paid,
          payStr,
          payCents,
          remaining,
          error: errors[row.worker_id] ?? null,
          payError: payErrors[row.worker_id] ?? null,
        };
      });
  }, [roster, dayMap, activeIds, drafts, errors, payErrors]);

  const patch = useCallback(
    (id: string, p: Draft) => {
      setStore((prev) => {
        const base = prev.key === key ? prev : newSheet(key);
        return {
          key,
          map: { ...base.map, [id]: { ...base.map[id], ...p } },
          // Editing a field clears that field's error only.
          errors: 'amount' in p ? without(base.errors, id) : base.errors,
          payErrors: 'pay' in p ? without(base.payErrors, id) : base.payErrors,
        };
      });
    },
    [key],
  );

  const fail = useCallback(
    (id: string, field: 'errors' | 'payErrors', msg: TKey) => {
      setStore((prev) => {
        const base = prev.key === key ? prev : newSheet(key);
        return { ...base, [field]: { ...base[field], [id]: msg } };
      });
    },
    [key],
  );

  /** Run a database write now; a failure shows the friendly message and nothing throws. */
  const run = useCallback((fn: () => void) => guard('wage.today', t, () => void fn()), [t]);

  const toggle = useCallback(
    (vm: Vm, next: boolean) => {
      if (!pid) return;
      const id = vm.row.worker_id;
      if (next) {
        if (vm.row.rate_cents <= 0) {
          router.push(`/worker/assign?projectId=${vm.row.project_id}&workerId=${id}`);
          return;
        }
        // Work marks save immediately (one tap = 1 day at the project rate).
        void run(() => recordWorkDay({ project_id: pid, worker_id: id, day, days: 1 }));
        patch(id, { amount: undefined, pay: undefined });
        return;
      }
      const rec = vm.rec;
      const untick = () => {
        void run(() => removeWorkDay(pid, id, day));
        patch(id, { amount: undefined, pay: undefined });
        if (rec?.days != null) {
          const days = rec.days;
          const wage = rec.work_cents;
          toast(t('deleted'), {
            action: {
              label: t('undo'),
              onPress: () => void run(() => recordWorkDay({ project_id: pid, worker_id: id, day, days, amount_cents: wage > 0 ? wage : undefined })),
            },
          });
        }
      };
      if (vm.paid > 0) {
        Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('delete'), style: 'destructive', onPress: untick },
        ]);
      } else {
        untick();
      }
    },
    [pid, day, run, patch, t],
  );

  const setDays = useCallback(
    (vm: Vm, days: number) => {
      if (!pid) return;
      const id = vm.row.worker_id;
      // The wage follows the project rate; a worker with no rate keeps the wage that was typed for them.
      const wage = vm.row.rate_cents > 0 ? undefined : vm.rec?.work_cents || undefined;
      void run(() => recordWorkDay({ project_id: pid, worker_id: id, day, days, amount_cents: wage }));
      patch(id, { amount: undefined });
    },
    [pid, day, run, patch],
  );

  /** A wage typed over the recorded one is written when the field is left. */
  const commitAmount = useCallback(
    (vm: Vm) => {
      if (!pid || !vm.worked) return;
      const id = vm.row.worker_id;
      const cents = vm.amountCents;
      if (cents === null || cents <= 0) {
        fail(id, 'errors', 'errAmount');
        return;
      }
      if (vm.rec?.work_cents !== cents) {
        void run(() => recordWorkDay({ project_id: pid, worker_id: id, day, days: vm.days, amount_cents: cents }));
      }
    },
    [pid, day, run, fail],
  );

  const workedRows = vms.filter((v) => v.worked);
  const totalWages = workedRows.reduce((s, v) => s + (v.amountCents ?? 0), 0);
  // Money already handed over today, from the database: includes payments of workers who were unticked or are off the roster.
  const totalPaid = dayRows.reduce((s, r) => s + r.paid_cents, 0);
  const totalToPay = workedRows.reduce((s, v) => s + v.remaining, 0);

  /** What would be paid: the typed amount where there is one, else (for Pay all) everything still owed. */
  function payLines(all: boolean): PayLine[] {
    return workedRows.map((v) => ({ v, cents: v.payCents > 0 ? v.payCents : all ? v.remaining : 0 })).filter((l) => l.cents > 0);
  }
  const payAllTotal = payLines(true).reduce((s, l) => s + l.cents, 0);

  /** Write wages typed over the recorded ones (before the day or project changes, and on Save). */
  function flushAmounts() {
    if (!pid) return;
    const todo = workedRows.filter((v) => v.amountCents !== null && v.amountCents > 0 && v.rec?.work_cents !== v.amountCents);
    if (!todo.length) return;
    void run(() => {
      for (const v of todo) recordWorkDay({ project_id: pid, worker_id: v.row.worker_id, day, days: v.days, amount_cents: v.amountCents as number });
    });
  }

  function markAll() {
    if (!pid) return;
    const todo = vms.filter((v) => !v.worked && v.row.rate_cents > 0);
    if (todo.length) {
      void run(() => {
        for (const v of todo) recordWorkDay({ project_id: pid, worker_id: v.row.worker_id, day, days: 1 });
      });
      for (const v of todo) patch(v.row.worker_id, { amount: undefined, pay: undefined });
    }
    if (vms.some((v) => !v.worked && v.row.rate_cents <= 0)) toast(t('rateRequired'));
  }

  /** Amounts must parse before anything is written, so a typo cannot leave the sheet half saved. */
  function validate(): boolean {
    const bad: Record<string, TKey> = {};
    const badPay: Record<string, TKey> = {};
    for (const v of workedRows) {
      const id = v.row.worker_id;
      if (v.amountCents === null || v.amountCents <= 0) bad[id] = 'errAmount';
      if (v.payStr.trim() !== '' && parseCents(v.payStr) === null) badPay[id] = 'errAmount';
    }
    if (!Object.keys(bad).length && !Object.keys(badPay).length) return true;
    setStore((prev) => ({ ...(prev.key === key ? prev : newSheet(key)), errors: bad, payErrors: badPay }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    toast(t('errAmount'), { tone: 'danger' });
    return false;
  }

  /** Write the wages and the given payments, then leave. Payments are the only thing that needs the money to be confirmed first. */
  async function save(lines: PayLine[]) {
    if (!pid || busy) return;
    setBusy(true);
    const done = await guard('wage.today', t, () => {
      for (const v of workedRows) {
        const cents = v.amountCents as number;
        if (v.rec?.work_cents !== cents) {
          recordWorkDay({ project_id: pid, worker_id: v.row.worker_id, day, days: v.days, amount_cents: cents });
        }
      }
      for (const l of lines) {
        payWages({ project_id: pid, worker_id: l.v.row.worker_id, day, amount_cents: l.cents });
        // Written: clear the draft so a retry after a later failure cannot pay twice.
        patch(l.v.row.worker_id, { pay: '' });
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

  /** Money moves only after the names and amounts have been shown and confirmed. */
  function confirmPay(lines: PayLine[], title: TKey) {
    const total = lines.reduce((s, l) => s + l.cents, 0);
    Alert.alert(t(title), lines.map((l) => `${l.v.row.name} — ${formatLKR(l.cents)}`).join('\n'), [
      { text: t('cancel'), style: 'cancel' },
      { text: `${t(title)} · ${formatLKR(total)}`, onPress: () => void save(lines) },
    ]);
  }

  /** Save today: the work is saved; only amounts typed into Pay now are paid, and those are confirmed first. */
  function onSave() {
    if (!pid || busy || !validate()) return;
    const lines = payLines(false);
    if (lines.length) confirmPay(lines, 'payNow');
    else void save([]);
  }

  function onPayAll() {
    if (!pid || busy || !validate()) return;
    const lines = payLines(true);
    if (lines.length) confirmPay(lines, 'payAll');
    else toast(t('nothingToPay'));
  }

  const { gutter, column, short } = useLayout();

  const projectField = (
    <SelectField
      label={t('project')}
      items={projects.map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · ') }))}
      value={pid}
      onChange={(id) => {
        flushAmounts();
        setCurrentProject(id);
      }}
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
      <DateField
        label={t('date')}
        value={day}
        onChange={(d) => {
          flushAmounts();
          setDay(d);
        }}
        maxDay={td}
      />
      {alreadyRecorded ? (
        <InfoLine icon={Info} text={t('dayAlreadyRecorded')} />
      ) : null}
      {vms.length ? (
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          <Button compact kind="secondary" icon={CheckCircle2} label={t('markAllWorked')} onPress={markAll} />
        </View>
      ) : null}
    </View>
  );

  const addWorker = () => router.push(`/worker/assign?projectId=${pid}`);

  function openShare() {
    Keyboard.dismiss();
    flushAmounts();
    share.open();
  }

  const footer = (
    <>
      {kbOpen ? null : (
              <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <SummaryCell label={t('workersToday')} value={String(workedRows.length)} />
                  <SummaryCell label={t('wages')} value={formatLKR(totalWages)} />
                </View>
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <SummaryCell label={t('wagesPaidToday')} value={formatLKR(totalPaid)} tone={totalPaid > 0 ? 'success' : 'text'} />
                  <SummaryCell label={t('toPayToday')} value={formatLKR(totalToPay)} tone={totalToPay > 0 ? 'danger' : 'text'} />
                </View>
              </View>
            )}
            {payAllTotal > 0 && !kbOpen ? (
              <>
                {/* "Pay all" only when this pays everything still owed; a typed part payment says just what it pays */}
                <Button
                  label={payAllTotal >= totalToPay ? `${t('payAll')} · ${formatLKR(payAllTotal)}` : t('payAmount', { amount: formatLKR(payAllTotal) })}
                  onPress={onPayAll}
                  loading={busy}
                />
                <Button compact kind="ghost" label={t('saveSheet')} onPress={onSave} disabled={busy} />
              </>
            ) : (
              <Button label={t('saveSheet')} onPress={onSave} loading={busy} />
            )}
    </>
  );

  return (
    <>
      <Stack.Screen options={{ title: t('todaysWork'), headerRight: () => <ShareHeaderButton onPress={openShare} /> }} />
      {/* On a short window (landscape, split screen) the totals and Save scroll with the sheet instead of covering it. */}
      <Screen scroll={false} footer={short ? undefined : footer}>
        <FlatList
          data={vms}
          keyExtractor={vmKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          {...listTuning}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={[column, { paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: space.xl }]}
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
            vms.length || short ? (
              <View style={{ marginTop: space.lg, gap: space.lg }}>
                {vms.length ? (
                  <ListCard>
                    <ListRow icon={UserPlus} title={t('addWorkerToProject')} onPress={addWorker} />
                  </ListCard>
                ) : null}
                {short ? <View style={{ gap: space.sm }}>{footer}</View> : null}
              </View>
            ) : undefined
          }
          renderItem={({ item }) => <WorkerRow vm={item} onToggle={toggle} onDays={setDays} onPatch={patch} onCommitAmount={commitAmount} />}
        />
      </Screen>
      {share.sheet}
    </>
  );
}

const vmKey = (v: Vm) => v.row.worker_id;
const EMPTY_DRAFTS: Record<string, Draft> = {};
const EMPTY_DRAFT: Draft = {};
const EMPTY_ERRORS: Record<string, TKey> = {};

function Gap() {
  return <View style={{ height: space.md }} />;
}

function SummaryCell({ label, value, tone = 'text' }: { label: string; value: string; tone?: 'text' | 'success' | 'danger' }) {
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm }}>
      <Txt variant="caption" color="textMuted" style={{ flex: 1, minWidth: 0 }}>
        {label}
      </Txt>
      {/* Half a 320 dp phone is 136 dp: a big total shrinks (to 70 %) before it could run past the cell. */}
      <Txt weight="semibold" numeric color={tone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flexShrink: 0, maxWidth: '70%' }}>
        {value}
      </Txt>
    </View>
  );
}

const WorkerRow = memo(function WorkerRow({
  vm,
  onToggle,
  onDays,
  onPatch,
  onCommitAmount,
}: {
  vm: Vm;
  onToggle: (vm: Vm, next: boolean) => void;
  onDays: (vm: Vm, days: number) => void;
  onPatch: (id: string, p: Draft) => void;
  onCommitAmount: (vm: Vm) => void;
}) {
  const c = useColors();
  const t = useT();
  const { row, worked, paid } = vm;
  const wage = vm.amountCents ?? 0;
  const noRate = row.rate_cents <= 0;
  const overpay = vm.payCents > vm.remaining;
  // The amount still owed is only a hint under the field: it is never put in the field for the supervisor.
  const payHint = overpay ? t('payMore') : vm.remaining > 0 && vm.payStr.trim() === '' ? `${t('toPayToday')} ${formatLKR(vm.remaining)}` : undefined;
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
        <View style={{ flex: 1, minWidth: 0, paddingVertical: space.sm, gap: 2 }}>
          <Txt weight="semibold" numberOfLines={2}>
            {row.name}
          </Txt>
          <Txt variant="caption" color={noRate ? 'warning' : 'textMuted'} numberOfLines={2}>
            {sub}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: space.xs, marginLeft: space.sm, flexShrink: 0, maxWidth: '45%' }}>
          {worked ? (
            <>
              <Txt weight="semibold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {formatLKR(wage)}
              </Txt>
              {wage > 0 && paid >= wage ? (
                <Badge tone="success" icon={CheckCircle2} label={t('paid')} />
              ) : paid > 0 ? (
                <Badge tone="warning" label={`${t('paidToday')} ${formatLKR(paid)}`} />
              ) : null}
            </>
          ) : (
            <>
              <Txt variant="caption" color="textMuted">
                {t('notWorked')}
              </Txt>
              {/* A payment outlives its work mark; keep it visible. */}
              {paid > 0 ? <Badge tone="warning" label={`${t('paidToday')} ${formatLKR(paid)}`} /> : null}
            </>
          )}
        </View>
      </Pressable>

      {worked ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}>
          <Segmented
            label={t('days')}
            numeric
            value={(DAY_CHOICES as readonly string[]).includes(String(vm.days)) ? String(vm.days) : null}
            onChange={(v) => onDays(vm, Number(v))}
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
                onBlur={() => onCommitAmount(vm)}
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
                hint={payHint}
                hintTone={overpay ? 'warning' : 'textMuted'}
                error={vm.payError ? t(vm.payError) : null}
              />
            </View>
          </View>
          {paid > 0 ? <InfoLine icon={CheckCircle2} tone="success" text={`${t('paidToday')} · ${formatLKR(paid)}`} /> : null}
        </View>
      ) : null}
    </View>
  );
});
