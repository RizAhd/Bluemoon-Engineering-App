import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Banknote, Building2, CalendarCheck, FileText, HandCoins, Pencil, Phone, Share2, Trash2, UserCheck, UserX } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { Hero, HeroAction, HeroAmount, HeroButtons, HeroChip, HeroChips } from '@/components/Hero';
import { PdfOptionsSheet } from '@/components/PdfOptionsSheet';
import { useShareSheet } from '@/components/ShareSheet';
import { Button } from '@/components/ui/Button';
import { CardList } from '@/components/ui/CardList';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { Chips, PickerSheet } from '@/components/ui/form';
import { Initials } from '@/components/ui/kit';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { setSetting, useFirst, useQuery, useSetting } from '@/db';
import { deleteRecord, payWages, saveWorker, unassignWorker } from '@/db/repo';
import type { WageEntry, WageKind, Worker, WorkerBalance } from '@/db/types';
import { useCurrentProjectId, useProjects, useWorkerProjects } from '@/hooks/data';
import { usePdfShare } from '@/hooks/pdfShare';
import { useListSearch } from '@/hooks/search';
import { formatPhone } from '@/lib/names';
import { LANG_NAMES, useLang, useT, type Lang } from '@/i18n';
import { confirmPayments } from '@/lib/confirmPay';
import { formatDay, today } from '@/lib/dates';
import { showError } from '@/lib/errors';
import { formatLKR } from '@/lib/money';
import { exportWorkerStatementPdf } from '@/lib/reports/export';
import { space, useColors } from '@/theme';

const ICON = { work: CalendarCheck, advance: HandCoins, payment: Banknote } as const;
const ALL = '__all';

type Entry = WageEntry & { project_name: string | null };

const entryKey = (e: Entry) => e.id;

/** One line of the worker's history: work (+), advance or payment (−), day, project and note. */
const EntryRow = memo(function EntryRow({ e, showProject, onPress }: { e: Entry; showProject: boolean; onPress: (e: Entry) => void }) {
  const t = useT();
  return (
    <ListRow
      icon={ICON[e.kind]}
      title={`${t(`wage_${e.kind}`)}${e.kind === 'work' && e.days ? ` · ${t('daysCount', { n: e.days })}` : ''}`}
      subtitle={[formatDay(e.day), showProject ? e.project_name : null, e.note].filter(Boolean).join(' · ')}
      value={`${e.kind === 'work' ? '+' : '−'}${formatLKR(e.amount_cents)}`}
      valueTone={e.kind === 'work' ? 'text' : 'textMuted'}
      onPress={() => onPress(e)}
    />
  );
});

function BalanceBadge({ balance }: { balance: number }) {
  const t = useT();
  if (balance > 0) return <Badge tone="danger" label={t('weOwe')} />;
  if (balance < 0) return <Badge tone="warning" label={t('workerOwes')} />;
  return <Badge tone="success" label={t('settled')} />;
}

/** Earned · Advances · Paid in one white card over the hero, split by thin lines. */
function Totals({ items }: { items: { label: string; value: string }[] }) {
  const c = useColors();
  return (
    <Card padding={space.lg}>
      <View style={{ flexDirection: 'row' }}>
        {items.map((it, i) => (
          <View
            key={it.label}
            accessible
            accessibilityLabel={`${it.label} ${it.value}`}
            style={{ flex: 1, minWidth: 0, gap: 2, paddingLeft: i ? space.md : 0, borderLeftWidth: i ? 1 : 0, borderLeftColor: c.divider }}>
            <Txt variant="caption" weight="semibold" color="textMuted" numberOfLines={1}>
              {it.label}
            </Txt>
            <Txt variant="bodyLg" weight="bold" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {it.value}
            </Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const appLang = useLang();
  const pid = useCurrentProjectId();
  const worker = useFirst<Worker>('SELECT * FROM workers WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
  const bal = useFirst<WorkerBalance>('SELECT * FROM v_worker_balance WHERE worker_id = ?', [id ?? '']);
  const wp = useWorkerProjects(id ?? '');
  const allProjects = useProjects();
  const entries = useQuery<WageEntry & { project_name: string | null }>(
    `SELECT w.*, p.name AS project_name FROM wage_entries w LEFT JOIN projects p ON p.id = w.project_id
     WHERE w.worker_id = ? AND w.deleted_at IS NULL ORDER BY w.day DESC, w.created_at DESC`,
    [id ?? ''],
  );
  const [filter, setFilter] = useState<string | null>(null);
  // 'quickpay' = the Pay button on the balance card asking which project to pay
  const [picking, setPicking] = useState<WageKind | 'quickpay' | null>(null);

  // Projects that appear in the history, for the filter chips.
  const historyProjects = useMemo(() => {
    const seen = new Map<string, string>();
    entries.forEach((e) => {
      if (e.project_id && e.project_name && !seen.has(e.project_id)) seen.set(e.project_id, e.project_name);
    });
    return [...seen.entries()].map(([pId, name]) => ({ id: pId, name }));
  }, [entries]);

  // The chosen filter only counts while that project is still in the history; otherwise fall back to the default.
  const filterValid = filter === ALL || (filter != null && historyProjects.some((p) => p.id === filter));
  const activeFilter = filterValid && filter ? filter : pid && historyProjects.some((p) => p.id === pid) ? pid : ALL;
  const statementProject = activeFilter === ALL ? null : activeFilter;
  const statementProjectName = statementProject ? (historyProjects.find((p) => p.id === statementProject)?.name ?? null) : null;

  // The printed statement: the letterhead choice is the one of every PDF; its language is remembered for the
  // next worker (the app's language until one is chosen), since a worker may not read what the owner reads.
  const letterhead = useSetting('export_letterhead') === '1';
  const savedLang = useSetting('statement_lang');
  const statementLang: Lang = savedLang === 'en' || savedLang === 'si' || savedLang === 'ta' ? savedLang : appLang;
  const [pdfOpen, setPdfOpen] = useState(false);
  const pdf = usePdfShare({
    tag: 'worker.statementPdf',
    title: `${t('pdfStatement')} · ${worker?.name ?? ''}`.trim(),
    make: (notice) => exportWorkerStatementPdf(id ?? '', statementProject, { letterhead, lang: statementLang, onNotice: notice }),
    details: { id, projectId: statementProject, letterhead, lang: statementLang },
  });
  // the sheets go first: a message shown while one is open would sit behind it
  const exportStatement = (handOff?: () => void) =>
    pdf.run(() => {
      setPdfOpen(false);
      handOff?.();
    });

  const pdfHint = `${t('pdfStatement')} · ${statementProjectName ?? t('allProjects')} · ${LANG_NAMES[statementLang]} · ${t(letterhead ? 'letterheadOption' : 'pdfPlainPaper')}`;
  // The statement follows that filter: one project when one is chosen (the current project by default), else all.
  const share = useShareSheet({
    kind: 'workerStatement',
    id: id ?? null,
    options: { projectId: statementProject },
    pdf: { hint: pdfHint, run: exportStatement },
  });

  // The history under the project chip, then searched by note, project, kind, amount or day; the box is drawn with the history only.
  const shown = useMemo(() => (activeFilter === ALL ? entries : entries.filter((e) => e.project_id === activeFilter)), [entries, activeFilter]);
  const search = useListSearch(shown, (e) => [e.note, e.project_name, t(`wage_${e.kind}`), formatLKR(e.amount_cents), formatDay(e.day)], { shown: entries.length > 0 });

  // The worker was deleted (from the edit form on top of this screen): leave instead of showing an empty shell.
  const gone = !!id && (!worker || !bal);
  useFocusEffect(
    useCallback(() => {
      if (gone && router.canGoBack()) router.back();
    }, [gone]),
  );

  if (!worker || !bal) {
    return (
      <>
        <Stack.Screen options={{ title: t('worker') }} />
        <Screen>
          <EmptyState icon={Building2} title={t('worker')} action={<Button kind="secondary" label={t('close')} onPress={() => router.back()} full />} />
        </Screen>
      </>
    );
  }

  const b = bal.balance_cents;
  const hasUnassigned = entries.some((e) => !e.project_id || !e.project_name);
  const showChips = historyProjects.length > 1 || (historyProjects.length >= 1 && hasUnassigned);
  const onCurrent = !!pid && wp.some((p) => p.project_id === pid);

  /** Which project an action belongs to: current project if the worker is on it, the only one, else ask. */
  function actionProject(): string | null {
    if (pid && wp.some((p) => p.project_id === pid)) return pid;
    if (wp.length === 1) return wp[0].project_id;
    if (wp.length === 0 && pid) return pid;
    return null;
  }

  function go(kind: WageKind, projectId: string) {
    const owed = wp.find((p) => p.project_id === projectId)?.balance_cents ?? 0;
    const amount = kind === 'payment' && owed > 0 ? `&amount=${owed}` : '';
    router.push(`/wage/form?workerId=${worker!.id}&kind=${kind}&projectId=${projectId}${amount}`);
  }

  // Projects this worker is owed money on; the balance card's Pay button pays one of them in full, after one confirmation.
  const owing = wp.filter((p) => p.balance_cents > 0);
  const quickTarget = (() => {
    const chosen = actionProject();
    const row = chosen ? wp.find((p) => p.project_id === chosen) : undefined;
    if (row && row.balance_cents > 0) return row;
    return owing.length === 1 ? owing[0] : null;
  })();

  function quickPay(projectId: string) {
    const row = wp.find((p) => p.project_id === projectId);
    if (!row || row.balance_cents <= 0) return;
    confirmPayments(t, [{ name: `${worker!.name} · ${row.project_name}`, cents: row.balance_cents }], 'payNow', () => {
      try {
        payWages({ project_id: projectId, worker_id: worker!.id, day: today(), amount_cents: row.balance_cents });
        toast(t('savedOnPhone'));
      } catch (e) {
        showError(e, 'worker.quickPay', t, { projectId, workerId: worker!.id });
      }
    });
  }

  function act(kind: WageKind) {
    const projectId = actionProject();
    if (projectId) go(kind, projectId);
    else setPicking(kind);
  }

  function onEntry(e: WageEntry) {
    Alert.alert(t(`wage_${e.kind}`), `${formatDay(e.day)} · ${formatLKR(e.amount_cents)}`, [
      { text: t('close'), style: 'cancel' },
      { text: t('edit'), onPress: () => router.push(`/wage/form?id=${e.id}`) },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('delete'),
              style: 'destructive',
              onPress: () => {
                try {
                  deleteRecord('wage_entries', e.id);
                  toast(t('deleted'));
                } catch (err) {
                  showError(err, 'worker.deleteEntry', t, { id: e.id });
                }
              },
            },
          ]),
      },
    ]);
  }

  function toggleActive() {
    try {
      saveWorker({
        id: worker!.id,
        name: worker!.name,
        phone: worker!.phone,
        trade: worker!.trade,
        daily_rate_cents: worker!.daily_rate_cents,
        active: !worker!.active,
      });
    } catch (e) {
      showError(e, 'worker.toggleActive', t, { id: worker!.id });
    }
  }

  function removeFromCurrent() {
    if (!pid) return;
    // Off the project, the balance leaves every project total: say so, and offer to settle it first.
    const owed = wp.find((p) => p.project_id === pid)?.balance_cents ?? 0;
    const body = owed ? `${t(owed > 0 ? 'weOwe' : 'workerOwes')}: ${formatLKR(Math.abs(owed))}\n${t('removeFromProjectBody')}` : t('removeFromProjectBody');
    Alert.alert(t('removeFromProject'), body, [
      { text: t('cancel'), style: 'cancel' },
      ...(owed > 0 ? [{ text: t('payNow'), onPress: () => go('payment', pid) }] : []),
      {
        text: t('removeFromProject'),
        style: 'destructive',
        onPress: () => {
          try {
            unassignWorker(pid, worker!.id);
            toast(t('deleted'));
          } catch (e) {
            showError(e, 'worker.unassign', t, { projectId: pid, workerId: worker!.id });
          }
        },
      },
    ]);
  }

  const pickable: { id: string; title: string; subtitle?: string }[] =
    picking === 'quickpay'
      ? owing.map((p) => ({ id: p.project_id, title: p.project_name, subtitle: formatLKR(p.balance_cents) }))
      : wp.length
        ? wp.map((p) => ({ id: p.project_id, title: p.project_name }))
        : allProjects.map((p) => ({ id: p.id, title: p.name }));
  const pickerItems = pickable.map((p) => ({ ...p, icon: Building2 }));

  return (
    <>
      {/* the hero draws the back button, Share and Edit */}
      <Stack.Screen options={{ title: worker.name, headerShown: false }} />
      <Screen scroll={false}>
        <CardList
          sections={[{ key: 'history', rows: search.filtered }]}
          keyOf={entryKey}
          renderRow={(e) => <EntryRow e={e} showProject={activeFilter === ALL} onPress={onEntry} />}
          inset
          gap={space.lg}
          empty={
            search.noResults ?? (
              <Txt variant="caption" color="textMuted">
                {`${t('recordWork')} · ${t('giveAdvance')} · ${t('payWages')}`}
              </Txt>
            )
          }
          footer={
            <View style={{ gap: space.md, marginTop: space.md }}>
              <SectionTitle title={t('manage')} />
              <ListCard inset>
                <ListRow
                  icon={worker.active ? UserX : UserCheck}
                  iconTone="slate"
                  title={worker.active ? t('markInactive') : t('markActive')}
                  accessibilityLabel={worker.active ? t('markInactive') : t('markActive')}
                  onPress={toggleActive}
                />
                {onCurrent ? (
                  <ListRow icon={Trash2} iconTone="danger" title={t('removeFromProject')} accessibilityLabel={t('removeFromProject')} onPress={removeFromCurrent} />
                ) : null}
              </ListCard>
            </View>
          }
          header={
            <View style={{ gap: space.lg }}>
              <Hero
                back
                title={t('worker')}
                actions={
                  <>
                    <HeroAction icon={Share2} label={t('share')} onPress={share.open} />
                    <HeroAction icon={Pencil} label={t('editWorker')} onPress={() => router.push(`/worker/form?id=${worker.id}`)} />
                  </>
                }
                card={
                  <Totals
                    items={[
                      { label: t('earned'), value: formatLKR(bal.earned_cents) },
                      { label: t('advances'), value: formatLKR(bal.advance_cents) },
                      { label: t('paid'), value: formatLKR(bal.paid_cents) },
                    ]}
                  />
                }>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.heroWhite, alignItems: 'center', justifyContent: 'center' }}>
                    <Initials name={worker.name} size={60} tone="primary" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt variant="title" weight="bold" color="onHeader" numberOfLines={2} style={{ fontSize: 22, lineHeight: 28 }}>
                      {worker.name}
                    </Txt>
                    {worker.trade || worker.daily_rate_cents ? (
                      <Txt variant="caption" weight="semibold" color="onHeaderMuted" numberOfLines={2}>
                        {[worker.trade, worker.daily_rate_cents ? `${t('dailyRate')} ${formatLKR(worker.daily_rate_cents)}` : null].filter(Boolean).join(' · ')}
                      </Txt>
                    ) : null}
                  </View>
                </View>
                <HeroAmount label={t('balanceAllProjects')} value={formatLKR(Math.abs(b))} />
                {b !== 0 || bal.earned_cents > 0 || bal.paid_cents > 0 || !worker.active ? (
                  <HeroChips>
                    {b !== 0 || bal.earned_cents > 0 || bal.paid_cents > 0 ? (
                      <HeroChip label={b > 0 ? t('weOwe') : b < 0 ? t('workerOwes') : t('settled')} tone={b > 0 ? 'danger' : undefined} />
                    ) : null}
                    {!worker.active ? <HeroChip label={t('inactive')} /> : null}
                  </HeroChips>
                ) : null}
                <HeroButtons>
                  {owing.length ? (
                    <Button
                      kind="hero"
                      icon={Banknote}
                      // The balance adds up every project, but money is paid per project: with more than one the button says which.
                      label={quickTarget ? `${t('payAmount', { amount: formatLKR(quickTarget.balance_cents) })}${wp.length > 1 ? ` · ${quickTarget.project_name}` : ''}` : t('payNow')}
                      onPress={() => (quickTarget ? quickPay(quickTarget.project_id) : setPicking('quickpay'))}
                      full
                    />
                  ) : null}
                  <Button kind={owing.length ? 'heroSoft' : 'hero'} icon={CalendarCheck} label={t('recordWork')} onPress={() => act('work')} full />
                </HeroButtons>
              </Hero>

              {worker.phone ? (
                <Button kind="ghost" compact icon={Phone} label={formatPhone(worker.phone)} onPress={() => Linking.openURL(`tel:${worker.phone}`).catch((e) => showError(e, 'worker.call', t))} style={{ alignSelf: 'flex-start' }} />
              ) : null}

              <ListCard inset>
                <ListRow icon={HandCoins} title={t('giveAdvance')} accessibilityLabel={t('giveAdvance')} onPress={() => act('advance')} />
                <ListRow icon={Banknote} title={t('payWages')} accessibilityLabel={t('payWages')} onPress={() => act('payment')} />
                {/* the statement prints this history (all of it, for the project chosen below): its own options are one tap away */}
                {entries.length ? (
                  <ListRow icon={FileText} title={t('statementPdf')} subtitle={LANG_NAMES[statementLang]} accessibilityLabel={t('statementPdf')} onPress={() => setPdfOpen(true)} />
                ) : null}
              </ListCard>

              {wp.length ? (
                <>
                  <SectionTitle title={t('perProject')} count={wp.length} />
                  <ListCard inset>
                    {wp.map((p) => (
                      <ListRow
                        key={p.project_id}
                        icon={Building2}
                        title={p.project_name}
                        subtitle={`${formatLKR(p.rate_cents)} / ${t('day')} · ${t('daysCount', { n: p.days_total })}`}
                        value={p.balance_cents ? formatLKR(Math.abs(p.balance_cents)) : undefined}
                        badge={<BalanceBadge balance={p.balance_cents} />}
                        onPress={() => router.push(`/worker/assign?projectId=${p.project_id}&workerId=${worker.id}`)}
                      />
                    ))}
                  </ListCard>
                </>
              ) : null}

              {/* the statement prints this history (all of it, for the project chosen below): its own options are one tap away */}
              <SectionTitle title={t('history')} count={entries.length || undefined} />
              {search.node}
              {showChips ? (
                <Chips
                  value={activeFilter}
                  onChange={setFilter}
                  options={[{ value: ALL, label: t('all') }, ...historyProjects.map((p) => ({ value: p.id, label: p.name }))]}
                />
              ) : null}
            </View>
          }
        />
      </Screen>

      <PickerSheet
        visible={picking != null}
        title={t('chooseProject')}
        value={null}
        items={pickerItems}
        onClose={() => setPicking(null)}
        onPick={(projectId) => {
          const kind = picking;
          setPicking(null);
          if (!kind || !projectId) return;
          if (kind === 'quickpay') quickPay(projectId);
          else go(kind, projectId);
        }}
      />
      <PdfOptionsSheet
        visible={pdfOpen}
        title={t('statementPdf')}
        busy={pdf.busy}
        letterhead={letterhead}
        onLetterhead={(v) => setSetting('export_letterhead', v ? '1' : '0')}
        lang={{ label: t('statementLanguage'), value: statementLang, onChange: (l) => setSetting('statement_lang', l) }}
        onShare={() => void exportStatement()}
        onClose={() => setPdfOpen(false)}
      />
      {share.sheet}
    </>
  );
}
