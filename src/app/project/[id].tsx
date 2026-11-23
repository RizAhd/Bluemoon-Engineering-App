import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { Banknote, CalendarRange, FileOutput, FileText, Hammer, HardHat, Landmark, MapPin, NotebookPen, Package, Pencil, Plus, Share2, Star, UserPlus, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Hero, HeroAction, HeroAmount } from '@/components/Hero';
import { PhotoStrip } from '@/components/PhotoStrip';
import { useShareSheet } from '@/components/ShareSheet';
import { CategoryBars, ContractBar, ReceivedBar, Stat, Tiles } from '@/components/Stats';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, toast } from '@/components/ui/feedback';
import { Checkbox } from '@/components/ui/form';
import { Card, Divider, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { SplitAmount } from '@/components/ui/SplitAmount';
import { Txt } from '@/components/ui/Txt';
import { setSetting, useFirst, useQuery, useSetting } from '@/db';
import type { Estimate, PayMethod, ProjectCost, ToolHolder, ToolStock } from '@/db/types';
import { setCurrentProject, useCurrentProjectId, useEstimateTotal, useProject, useProjectEstimates, useProjectReceipts, useProjectReceived, useProjectWorkers } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { formatDay } from '@/lib/dates';
import { showError } from '@/lib/errors';
import { formatLKR } from '@/lib/money';
import { exportProjectPdf } from '@/lib/pdf';
import { receiptSummary } from '@/lib/receipts';
import { isSinglePiece, qtyText } from '@/lib/toolStock';
import { radius, space, useColors } from '@/theme';

/** One holder of a tool on this project: who has how much of it, since the last issue to them. */
type OutRow = ToolHolder & Pick<ToolStock, 'name' | 'code' | 'unit' | 'is_material' | 'quantity_milli'> & { worker_name: string | null; since: string | null };

const MAX_ROWS = 5;

/** The icon of a client payment by how it came: notes, a bank transfer, a cheque. */
const METHOD_ICON: Record<PayMethod, LucideIcon> = { cash: Banknote, bank: Landmark, cheque: FileText };

/** One export choice: a checkbox, a label and a one-line hint. The whole row is the tap target (48 dp+). */
function ExportOption({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={() => onChange(!checked)}
      // pressed colour, as on the estimate's share options: the tap shows at once
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 56, borderRadius: radius.md, backgroundColor: pressed ? c.muted : 'transparent' })}>
      {/* The row carries the role and the tap; the box is only the picture of the state. */}
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Checkbox checked={checked} onChange={onChange} label={label} />
      </View>
      <View style={{ flex: 1, paddingVertical: space.xs }}>
        <Txt weight="semibold">{label}</Txt>
        <Txt variant="caption" color="textMuted">
          {hint}
        </Txt>
      </View>
    </Pressable>
  );
}

/** One line of the "Money from client" card: the label on the left, the amount on the right. */
function MoneyLine({ label, value, strong, tone = 'text' }: { label: string; value: string; strong?: boolean; tone?: 'text' | 'warning' | 'danger' | 'success' }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm }}>
      <Txt color="textMuted" weight="semibold" style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <Txt variant="bodyLg" weight={strong ? 'bold' : 'semibold'} color={tone} numeric style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </View>
  );
}

/** "Rs" small and the figure large, side by side (it reads "Rs 3,000,000"). */
function BigMoney({ cents }: { cents: number }) {
  return <SplitAmount value={formatLKR(cents)} size={28} />;
}

/** The share of the project value received, in a soft round badge ("<1 %" for a little, never a misleading 0). */
function PercentBadge({ percent, received, over }: { percent: number; received: number; over: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 5,
        borderColor: over ? c.amber : c.success,
        backgroundColor: over ? c.warningSoft : c.successSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Txt weight="bold" numeric color={over ? 'warning' : 'success'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {`${received > 0 && percent === 0 ? '<1' : percent}%`}
      </Txt>
    </View>
  );
}

/** A link back to the estimate this project was made from: "Estimate EST-2026-001" and its total. */
function LinkedEstimate({ estimate }: { estimate: Estimate }) {
  const t = useT();
  const total = useEstimateTotal(estimate.id);
  return (
    <ListRow
      icon={FileText}
      title={`${t('estimate')} ${estimate.number}`}
      value={total ? formatLKR(total.total_cents) : undefined}
      onPress={() => router.push(`/estimate/${estimate.id}`)}
    />
  );
}

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const project = useProject(id);
  const current = useCurrentProjectId();
  const cost = useFirst<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [id ?? '']);
  const cats = useQuery<{ category: string; s: number }>(
    'SELECT category, SUM(amount_cents) AS s FROM expenses WHERE project_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY s DESC',
    [id ?? ''],
  );
  const noteCount = useFirst<{ n: number }>('SELECT COUNT(*) AS n FROM site_notes WHERE project_id = ? AND deleted_at IS NULL', [id ?? ''])?.n ?? 0;
  const workers = useProjectWorkers(id ?? null);
  const estimates = useProjectEstimates(id);
  const receipts = useProjectReceipts(id);
  const receivedRow = useProjectReceived(id);
  // "Mark inactive" only changes workers.active, and the roster view reports project_workers.active, so ask for the worker's own flag too.
  const inactiveWorkerIds = useQuery<{ id: string }>('SELECT id FROM workers WHERE active = 0 AND deleted_at IS NULL');
  // One row per tool and holder (a tool with 3 pieces here shows "3"; a material its issued amount), since the last issue to them.
  const toolsOut = useQuery<OutRow>(
    `SELECT h.*, s.name, s.code, s.unit, s.is_material, s.quantity_milli, w.name AS worker_name,
            (SELECT MAX(m.day) FROM tool_movements m
             WHERE m.tool_id = h.tool_id AND m.kind = 'issue' AND m.deleted_at IS NULL
               AND m.project_id IS h.project_id AND m.worker_id IS h.worker_id AND m.taken_by IS h.taken_by) AS since
     FROM v_tool_holders h JOIN v_tool_stock s ON s.tool_id = h.tool_id LEFT JOIN workers w ON w.id = h.worker_id
     WHERE h.project_id = ? ORDER BY s.name COLLATE NOCASE, h.tool_id, since, worker_name COLLATE NOCASE`,
    [id ?? ''],
  );
  // The last choices are remembered: photos on by default, letterhead off by default.
  const includePhotos = useSetting('export_photos') !== '0';
  const letterhead = useSetting('export_letterhead') === '1';
  const [exporting, setExporting] = useState(false);

  /** Make the report and hand it to the phone. `handOff` runs once the file is made (the Share sheet closes there). */
  async function onExport(handOff?: () => void) {
    if (!project) return;
    const pr = project;
    setExporting(true);
    try {
      let noLetterhead = false;
      const file = await exportProjectPdf(pr.id, {
        includePhotos,
        letterhead,
        onNotice: () => (noLetterhead = true),
      });
      handOff?.();
      if (noLetterhead) toast(t('letterheadUnavailable'), { tone: 'danger' });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: pr.name, UTI: 'com.adobe.pdf' });
    } catch (e) {
      showError(e, 'project.exportPdf', t, { id: pr.id, includePhotos, letterhead });
    } finally {
      setExporting(false);
    }
  }

  const share = useShareSheet({
    kind: 'project',
    id: id ?? null,
    // the PDF row makes the same report as "Export PDF" below, with its remembered choices
    pdf: {
      hint: `${t(includePhotos ? 'pdfWithPhotos' : 'pdfNoPhotos')} · ${t(letterhead ? 'letterheadOption' : 'pdfPlainPaper')}`,
      run: (handOff) => onExport(handOff),
    },
  });

  if (!project || !cost) {
    return (
      <>
        <Stack.Screen options={{ title: t('project') }} />
        <Screen>
          <EmptyState icon={HardHat} title={t('noProjects')} action={<Button kind="secondary" label={t('close')} onPress={() => router.back()} full />} />
        </Screen>
      </>
    );
  }
  const pr = project;
  const total = cost.expense_cents + cost.labour_cents;
  const money = receiptSummary(pr.contract_cents, receivedRow?.received_cents ?? 0);
  const inactive = new Set(inactiveWorkerIds.map((r) => r.id));
  const activeWorkers = workers.filter((w) => w.active && !inactive.has(w.worker_id));
  const wagesOwed = activeWorkers.reduce((a, w) => a + Math.max(0, w.balance_cents), 0);
  const leftInContract = pr.contract_cents ? pr.contract_cents - total : 0;

  function work(path: '/(tabs)/expenses' | '/(tabs)/workers' | '/(tabs)/tools') {
    setCurrentProject(pr.id);
    router.push(path);
  }

  return (
    <>
      {/* the blue hero carries the back button and the actions */}
      <Stack.Screen options={{ title: pr.name, headerShown: false }} />
      <Screen>
        <Hero
          back
          title={t('project')}
          actions={
            <>
              <HeroAction icon={Share2} label={t('share')} onPress={share.open} />
              <HeroAction icon={Pencil} label={t('editProject')} onPress={() => router.push(`/project/form?id=${pr.id}`)} />
            </>
          }>
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
              <Badge tone={pr.status === 'active' ? 'success' : pr.status === 'on_hold' ? 'warning' : 'slate'} label={t(`status_${pr.status}`)} />
              {current === pr.id ? <Badge tone="primary" label={t('thisProject')} /> : null}
            </View>
            <Txt variant="heading" weight="bold" color="onHeader" numberOfLines={3}>
              {pr.name}
            </Txt>
            {pr.client || pr.location ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs }}>
                <MapPin size={14} color={c.onHeaderMuted} strokeWidth={2} style={{ marginTop: 2 }} />
                <Txt variant="caption" weight="semibold" color="onHeaderMuted" style={{ flex: 1 }}>
                  {[pr.client, pr.location].filter(Boolean).join(' · ')}
                </Txt>
              </View>
            ) : null}
            {pr.start_date || pr.end_date ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <CalendarRange size={14} color={c.onHeaderMuted} strokeWidth={2} />
                <Txt variant="caption" weight="semibold" color="onHeaderMuted" numeric>
                  {[pr.start_date ? formatDay(pr.start_date) : '…', pr.end_date ? formatDay(pr.end_date) : '…'].join(' – ')}
                </Txt>
              </View>
            ) : null}
            {current !== pr.id ? (
              <Button
                kind="heroSoft"
                compact
                icon={Star}
                label={t('setCurrent')}
                onPress={() => {
                  setCurrentProject(pr.id);
                  toast(pr.name);
                }}
                style={{ alignSelf: 'flex-start' }}
              />
            ) : null}
          </View>
          <HeroAmount label={t('totalCost')} value={formatLKR(total)} />
          {pr.contract_cents ? (
            <View style={{ gap: space.xs }}>
              <ContractBar spent={total} contract={pr.contract_cents} onHero />
              <Txt variant="caption" color="onHeader" weight="semibold" numeric>
                {t('balanceToContract')}: {formatLKR(leftInContract)}
              </Txt>
            </View>
          ) : null}
        </Hero>

        <SectionTitle title={t('moneyFromClient')} first />
        <Card gap={space.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            {money.value != null ? <PercentBadge percent={money.percent} received={money.received} over={money.over > 0} /> : null}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="caption" weight="semibold" color="textMuted">
                {t('receivedSoFar')}
              </Txt>
              <BigMoney cents={money.received} />
              {money.value != null ? (
                <Txt variant="caption" color="textMuted" numeric>
                  {`${t('projectValue')}: ${formatLKR(money.value)}`}
                </Txt>
              ) : null}
            </View>
          </View>
          {money.value != null ? <ReceivedBar percent={money.percent} received={money.received} over={money.over > 0} /> : null}
          {money.value != null ? (
            money.over > 0 ? (
              <MoneyLine label={t('overValueBy')} value={formatLKR(money.over)} tone="warning" strong />
            ) : (
              <MoneyLine label={t('stillToReceive')} value={formatLKR(money.left ?? 0)} strong />
            )
          ) : (
            <Txt variant="caption" color="textMuted">
              {t('addValueHint')}
            </Txt>
          )}
          {money.received > 0 ? (
            <MoneyLine label={t('receivedMinusSpent')} value={formatLKR(money.received - total)} tone={money.received - total < 0 ? 'danger' : 'success'} />
          ) : null}
          <Button icon={Plus} label={t('recordPayment')} onPress={() => router.push(`/project/receipt?projectId=${pr.id}`)} />
        </Card>
        {receipts.length ? (
          <ListCard inset>
            {receipts.map((r) => (
              <ListRow
                key={r.id}
                icon={METHOD_ICON[r.method] ?? Wallet}
                iconTone="success"
                title={formatLKR(r.amount_cents)}
                subtitle={[formatDay(r.day), t(`method_${r.method}`), r.note].filter(Boolean).join(' · ')}
                onPress={() => router.push(`/project/receipt?id=${r.id}`)}
              />
            ))}
          </ListCard>
        ) : (
          <Txt variant="caption" color="textMuted">
            {t('noPaymentsYet')}
          </Txt>
        )}

        <SectionTitle title={t('overview')} />
        {/* two even tiles; what was paid of the labour sits under it, not alone on a third row */}
        <Tiles>
          <Stat label={t('materialsAndOther')} value={formatLKR(cost.expense_cents)} onPress={() => work('/(tabs)/expenses')} />
          <Stat
            label={t('labour')}
            value={formatLKR(cost.labour_cents)}
            caption={`${t('labourPaid')} ${formatLKR(cost.labour_paid_cents)}`}
            onPress={() => work('/(tabs)/workers')}
          />
        </Tiles>

        {estimates.length ? (
          <ListCard inset>
            {estimates.map((e) => (
              <LinkedEstimate key={e.id} estimate={e} />
            ))}
          </ListCard>
        ) : null}

        <SectionTitle
          title={t('projectWorkers')}
          count={activeWorkers.length}
          action={<Button kind="ghost" compact icon={UserPlus} label={t('add')} onPress={() => router.push(`/worker/assign?projectId=${pr.id}`)} />}
        />
        {activeWorkers.length ? (
          <>
            {wagesOwed > 0 ? (
              <Card tone="dangerSoft" padding={space.md} onPress={() => work('/(tabs)/workers')} accessibilityLabel={`${t('wagesToPay')} ${formatLKR(wagesOwed)}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                  <Txt weight="semibold" color="danger" style={{ flexShrink: 1 }}>
                    {t('wagesToPay')}
                  </Txt>
                  <Txt variant="bodyLg" weight="bold" color="danger" numeric>
                    {formatLKR(wagesOwed)}
                  </Txt>
                </View>
              </Card>
            ) : null}
            <ListCard inset>
              {activeWorkers.slice(0, MAX_ROWS).map((w) => (
                <ListRow
                  key={w.worker_id}
                  avatar={w.name}
                  title={w.name}
                  subtitle={[w.trade, `${formatLKR(w.rate_cents)} / ${t('day')}`].filter(Boolean).join(' · ')}
                  value={formatLKR(Math.abs(w.balance_cents))}
                  valueTone={w.balance_cents > 0 ? 'danger' : 'text'}
                  badge={
                    w.balance_cents > 0 ? (
                      <Badge tone="danger" label={t('weOwe')} />
                    ) : w.balance_cents < 0 ? (
                      <Badge tone="warning" label={t('workerOwes')} />
                    ) : w.earned_cents > 0 || w.paid_cents > 0 ? (
                      <Badge tone="success" label={t('settled')} />
                    ) : undefined
                  }
                  onPress={() => router.push(`/worker/${w.worker_id}`)}
                />
              ))}
              {activeWorkers.length > MAX_ROWS ? (
                <ListRow icon={HardHat} title={t('seeAll')} value={String(activeWorkers.length)} onPress={() => work('/(tabs)/workers')} />
              ) : null}
            </ListCard>
          </>
        ) : (
          <Card>
            <EmptyState
              compact
              icon={HardHat}
              title={t('noWorkersOnProject')}
              hint={t('noWorkersOnProjectHint')}
              action={<Button kind="secondary" compact icon={UserPlus} label={t('addWorkerToProject')} onPress={() => router.push(`/worker/assign?projectId=${pr.id}`)} />}
            />
          </Card>
        )}

        {toolsOut.length ? (
          <>
            <SectionTitle title={t('outHere')} count={toolsOut.length} />
            <ListCard inset>
              {toolsOut.slice(0, MAX_ROWS).map((s) => (
                <ListRow
                  key={`${s.tool_id}-${s.worker_id ?? ''}-${s.taken_by ?? ''}`}
                  icon={s.is_material ? Package : Hammer}
                  iconTone="warning"
                  title={s.code ? `${s.name} · ${s.code}` : s.name}
                  subtitle={[`${t('outWith')} ${s.worker_name ?? s.taken_by ?? ''}`.trim(), s.since ? formatDay(s.since) : null].filter(Boolean).join(' · ')}
                  // a single piece looks as it always did; several pieces (or a material) show how many are here
                  value={isSinglePiece(s) ? undefined : qtyText(s.qty_milli, s.unit)}
                  onPress={() => router.push(`/tool/${s.tool_id}`)}
                />
              ))}
              {toolsOut.length > MAX_ROWS ? (
                <ListRow icon={Hammer} title={t('seeAll')} value={String(toolsOut.length)} onPress={() => work('/(tabs)/tools')} />
              ) : null}
            </ListCard>
          </>
        ) : null}

        <ListCard>
          <ListRow
            icon={NotebookPen}
            title={`${t('siteNotes')} (${noteCount})`}
            subtitle={noteCount === 0 ? t('noNotes') : undefined}
            onPress={() => router.push(`/notes?projectId=${pr.id}`)}
          />
        </ListCard>

        {cats.length || cost.labour_cents > 0 ? (
          <>
            <SectionTitle title={t('byCategory')} />
            <Card>
              {/* wages are part of the total cost above, so they get their own bar beside the expense categories */}
              <CategoryBars
                rows={[
                  ...cats.map((r) => ({ label: t(`cat_${r.category}` as TKey), cents: r.s })),
                  ...(cost.labour_cents > 0 ? [{ label: t('wages'), cents: cost.labour_cents }] : []),
                ].sort((a, b) => b.cents - a.cents)}
              />
            </Card>
          </>
        ) : null}

        <SectionTitle title={t('exportPdf')} />
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={21} color={c.primary} strokeWidth={1.9} />
            </View>
            <Txt color="textMuted" style={{ flex: 1 }}>
              {t('exportPdfHint')}
            </Txt>
          </View>
          <View>
            <ExportOption
              label={t('includePhotos')}
              hint={t('includePhotosHint')}
              checked={includePhotos}
              onChange={(v) => setSetting('export_photos', v ? '1' : '0')}
            />
            <Divider />
            <ExportOption
              label={t('letterheadOption')}
              hint={t('letterheadHint')}
              checked={letterhead}
              onChange={(v) => setSetting('export_letterhead', v ? '1' : '0')}
            />
          </View>
          <Button kind="navy" icon={FileOutput} label={exporting ? t('exporting') : t('exportPdf')} loading={exporting} onPress={() => void onExport()} />
        </Card>

        <SectionTitle title={t('documents')} />
        <PhotoStrip ownerTable="projects" ownerId={pr.id} label={t('projectDocs')} />
      </Screen>
      {share.sheet}
    </>
  );
}
