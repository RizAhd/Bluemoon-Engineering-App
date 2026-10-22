import * as Sharing from 'expo-sharing';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  FolderPlus,
  Landmark,
  ListChecks,
  ListPlus,
  Lock,
  Pencil,
  Percent,
  Plus,
  RotateCcw,
  Send,
  Share2,
  Trash2,
  XCircle,
} from 'lucide-react-native';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EstimateStatusBadge } from '@/components/EstimateBits';
import { ShareHeaderButton, useShareSheet } from '@/components/ShareSheet';
import { Button, HeaderButton } from '@/components/ui/Button';
import { EmptyState, toast } from '@/components/ui/feedback';
import { Checkbox, Chips, SheetHeader } from '@/components/ui/form';
import { Card, Divider, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { setSetting, useFirst, useSetting } from '@/db';
import {
  applyStandardSchedule,
  createProjectFromEstimate,
  deleteEstimate,
  duplicateEstimate,
  loadEstimate,
  setEstimateStatus,
} from '@/db/estimates';
import type { EstimateStatus } from '@/db/types';
import { useEstimate, useEstimateItems, useEstimatePayments, useEstimateTotal } from '@/hooks/data';
import { LANG_NAMES, useT, type Lang } from '@/i18n';
import { useCompanyProfile } from '@/lib/company';
import { formatDay } from '@/lib/dates';
import { showError } from '@/lib/errors';
import { allocatePayments, formatPercent, formatQty, lineAmount, validUntil } from '@/lib/estimate';
import { exportEstimatePdf } from '@/lib/estimatePdf';
import { formatLKR } from '@/lib/money';
import { hairline, radius, space, touch, useColors } from '@/theme';

// ---------------------------------------------------------------- small pieces

/**
 * A label and a value on one line. An amount (default) never shrinks or wraps and the label gives way;
 * `text` is for typed text such as a bank name, which wraps and is right-aligned.
 */
function MoneyLine({ label, value, text, numeric = true }: { label: string; value: string; text?: boolean; numeric?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
      <Txt color="textMuted" style={text ? { flexShrink: 0 } : { flex: 1 }} numberOfLines={text ? 1 : 2}>
        {label}
      </Txt>
      <Txt weight="semibold" numeric={numeric} style={text ? { flex: 1, textAlign: 'right' } : { flexShrink: 0 }}>
        {value}
      </Txt>
    </View>
  );
}

/** One row of the actions list: icon, label, and the whole row is the button. */
function ActionRow({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return <ListRow icon={icon} title={label} accessibilityLabel={label} onPress={onPress} />;
}

/** A small caption above a value (Date, Valid until). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Txt variant="caption" color="textMuted">
        {label}
      </Txt>
      <Txt weight="semibold" numeric>
        {value}
      </Txt>
    </View>
  );
}

/** One tick box with a label and a one-line hint. The whole row is the tap target (48 dp+). */
function ShareOption({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (next: boolean) => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        minHeight: touch,
        borderRadius: radius.md,
        backgroundColor: pressed ? c.muted : 'transparent',
      })}>
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

/** The bottom sheet behind "Share estimate PDF": letterhead, language of the labels, and the Share button. */
function PdfShareSheet({
  visible,
  busy,
  letterhead,
  lang,
  onLetterhead,
  onLang,
  onShare,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  letterhead: boolean;
  lang: Lang;
  onLetterhead: (on: boolean) => void;
  onLang: (lang: Lang) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  // While the PDF is being made the sheet stays: closing it would hide the only sign that something is happening.
  const close = busy ? () => undefined : onClose;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: c.overlay }} onPress={close} accessibilityRole="button" accessibilityLabel={t('close')} />
      <View
        style={{
          maxHeight: '85%',
          backgroundColor: c.surface3,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderTopWidth: hairline,
          borderTopColor: c.border,
          paddingBottom: insets.bottom + space.lg,
        }}>
        <SheetHeader title={t('shareEstimate')} onClose={close} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.lg }}>
          <ShareOption label={t('letterheadOption')} hint={t('estimateLetterheadHint')} checked={letterhead} onChange={onLetterhead} />
          <Chips<Lang>
            label={t('pdfLanguage')}
            value={lang}
            onChange={onLang}
            options={(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          />
          <Button icon={Share2} label={busy ? t('exporting') : t('shareNow')} loading={busy} onPress={onShare} full />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- the hub

export default function EstimateHub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const estimate = useEstimate(id);
  const total = useEstimateTotal(id);
  const items = useEstimateItems(id);
  const payments = useEstimatePayments(id);
  const company = useCompanyProfile();
  // The project this estimate became. A row that is not on this phone (imported from another phone) is not "deleted": it is elsewhere.
  const linked = useFirst<{ id: string; deleted_at: string | null }>('SELECT id, deleted_at FROM projects WHERE id = ?', [estimate?.project_id ?? '']);
  // The last choices are remembered: no letterhead by default, and English because the client reads it.
  const letterhead = useSetting('estimate_letterhead') === '1';
  const savedLang = useSetting('estimate_lang');
  const pdfLang: Lang = savedLang === 'si' || savedLang === 'ta' ? savedLang : 'en';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareLock = useRef(false);
  // Set by the actions that leave this screen (duplicate, create project, delete) so a second tap does not run them again;
  // released when the screen is shown again.
  const leaving = useRef(false);
  useFocusEffect(
    useCallback(() => {
      leaving.current = false;
    }, []),
  );

  function setStatus(status: EstimateStatus) {
    if (!estimate) return;
    try {
      setEstimateStatus(estimate.id, status);
      toast(t('statusSetTo', { status: t(`estStatus_${status}`) }));
    } catch (e) {
      showError(e, 'estimate.status', t, { id: estimate.id, status });
    }
  }

  /**
   * Make the PDF with the remembered letterhead and language and hand it to the phone. `handOff` runs once the
   * file is made (the Share sheet closes there, as the PDF sheet does).
   */
  async function share(handOff?: () => void) {
    if (!estimate || shareLock.current) return;
    const est = estimate;
    shareLock.current = true;
    setSharing(true);
    try {
      let noLetterhead = false;
      const file = await exportEstimatePdf(est.id, { letterhead, lang: pdfLang, onNotice: () => (noLetterhead = true) });
      // the sheet goes first: a message shown while it is open would sit behind it
      setSheetOpen(false);
      handOff?.();
      if (noLetterhead) toast(t('letterheadUnavailable'), { tone: 'danger' });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `${t('estimate')} ${est.number}`, UTI: 'com.adobe.pdf' });
      // one tap to record that it went out
      if (est.status === 'draft') {
        Alert.alert(t('markSentTitle'), t('markSentBody'), [
          { text: t('notNow'), style: 'cancel' },
          { text: t('markAsSent'), onPress: () => setStatus('sent') },
        ]);
      }
    } catch (e) {
      showError(e, 'estimate.share', t, { id: est.id, letterhead, lang: pdfLang });
    } finally {
      shareLock.current = false;
      setSharing(false);
    }
  }

  // The header's Share: the estimate as a message in the client's language (the PDF's), or the PDF itself.
  const shareSheet = useShareSheet({
    kind: 'estimate',
    id: id ?? null,
    lang: pdfLang,
    pdf: {
      hint: `${LANG_NAMES[pdfLang]} · ${t(letterhead ? 'letterheadOption' : 'pdfPlainPaper')}`,
      run: (handOff) => share(handOff),
    },
  });

  if (!estimate || !total) {
    return (
      <>
        <Stack.Screen options={{ title: t('estimate') }} />
        <Screen>
          <EmptyState icon={FileText} title={t('errEstimateMissing')} action={<Button kind="secondary" label={t('close')} onPress={() => router.back()} full />} />
        </Screen>
      </>
    );
  }
  const est = estimate;

  const locked = est.status === 'accepted';
  const projectLive = !!linked && !linked.deleted_at;
  const projectElsewhere = !!est.project_id && !linked;
  const canCreateProject = locked && !projectLive && !projectElsewhere;
  const amounts = allocatePayments(
    total.total_cents,
    payments.map((p) => p.percent_bp),
  );
  // One stage with cents ("Rs 479,917.50") gives every stage two decimals, so the amounts line up ("Rs 639,890.00").
  const stageDecimals = amounts.some((a) => a % 100 !== 0);
  const unscheduled = 10000 - total.scheduled_bp;
  const bank = [
    { label: t('bankName'), value: company.bank_name, numeric: false },
    { label: t('accountName'), value: company.account_name, numeric: false },
    { label: t('accountNo'), value: company.account_no, numeric: true },
    { label: t('branch'), value: company.branch, numeric: false },
  ].filter((line) => line.value.trim());
  const bankIncomplete = !company.bank_name.trim() || !company.account_no.trim();

  // ------------------------------------------------ actions

  function standardSchedule() {
    // look at the stages now, not at what the screen showed a moment ago
    const have = loadEstimate(est.id)?.payments.length ?? 0;
    const apply = (replace: boolean) => {
      try {
        applyStandardSchedule(est.id, { replace });
      } catch (e) {
        showError(e, 'estimate.schedule', t, { id: est.id });
      }
    };
    if (!have) {
      apply(false);
      return;
    }
    Alert.alert(t('replaceScheduleTitle'), t('replaceScheduleBody'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('replace'), style: 'destructive', onPress: () => apply(true) },
    ]);
  }

  function makeProject() {
    if (leaving.current) return;
    Alert.alert(t('createProjectTitle'), t('createProjectBody', { name: est.title, amount: formatLKR(total!.total_cents) }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('createProject'),
        onPress: () => {
          if (leaving.current) return;
          leaving.current = true;
          try {
            const projectId = createProjectFromEstimate(est.id);
            toast(t('projectCreated'));
            router.push(`/project/${projectId}`);
          } catch (e) {
            leaving.current = false;
            showError(e, 'estimate.createProject', t, { id: est.id });
          }
        },
      },
    ]);
  }

  function duplicate() {
    if (leaving.current) return;
    leaving.current = true;
    try {
      const copy = duplicateEstimate(est.id);
      toast(t('estimateDuplicated'));
      router.push(`/estimate/${copy}`);
    } catch (e) {
      leaving.current = false;
      showError(e, 'estimate.duplicate', t, { id: est.id });
    }
  }

  function remove() {
    if (leaving.current) return;
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          if (leaving.current) return;
          leaving.current = true;
          try {
            deleteEstimate(est.id);
          } catch (e) {
            leaving.current = false;
            showError(e, 'estimate.delete', t, { id: est.id });
            return;
          }
          toast(t('deleted'));
          router.back();
        },
      },
    ]);
  }

  const openItem = (itemId?: string) => router.push(itemId ? `/estimate/item?estimateId=${est.id}&id=${itemId}` : `/estimate/item?estimateId=${est.id}`);
  const openStage = (stageId?: string) => router.push(stageId ? `/estimate/payment?estimateId=${est.id}&id=${stageId}` : `/estimate/payment?estimateId=${est.id}`);

  // The actions that make sense for the status the estimate is in now.
  const actionRows: ReactNode[] = [];
  if (est.status === 'draft') {
    actionRows.push(<ActionRow key="sent" icon={Send} label={t('markAsSent')} onPress={() => setStatus('sent')} />);
    actionRows.push(<ActionRow key="accepted" icon={CheckCircle2} label={t('markAsAccepted')} onPress={() => setStatus('accepted')} />);
  } else if (est.status === 'sent') {
    actionRows.push(<ActionRow key="accepted" icon={CheckCircle2} label={t('markAsAccepted')} onPress={() => setStatus('accepted')} />);
    actionRows.push(<ActionRow key="declined" icon={XCircle} label={t('markAsDeclined')} onPress={() => setStatus('declined')} />);
    actionRows.push(<ActionRow key="draft" icon={RotateCcw} label={t('backToDraft')} onPress={() => setStatus('draft')} />);
  } else {
    actionRows.push(<ActionRow key="reopen" icon={RotateCcw} label={t('reopenAsDraft')} onPress={() => setStatus('draft')} />);
  }
  if (canCreateProject) actionRows.push(<ActionRow key="project" icon={FolderPlus} label={t('createProjectFromEstimate')} onPress={makeProject} />);
  if (projectLive && linked) actionRows.push(<ActionRow key="open" icon={ExternalLink} label={t('openProject')} onPress={() => router.push(`/project/${linked.id}`)} />);
  actionRows.push(<ActionRow key="edit" icon={Pencil} label={t('editDetails')} onPress={() => router.push(`/estimate/form?id=${est.id}`)} />);
  actionRows.push(<ActionRow key="duplicate" icon={Copy} label={t('duplicateEstimate')} onPress={duplicate} />);

  return (
    <>
      <Stack.Screen
        options={{
          title: est.number,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ShareHeaderButton onPress={shareSheet.open} />
              <HeaderButton icon={Pencil} label={t('editDetails')} onPress={() => router.push(`/estimate/form?id=${est.id}`)} />
            </View>
          ),
        }}
      />
      <Screen>
        {/* who it is for, and when */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
            <Txt variant="bodyLg" weight="semibold" numeric style={{ flex: 1 }} numberOfLines={1}>
              {est.number}
            </Txt>
            <EstimateStatusBadge status={est.status} />
          </View>
          <View style={{ gap: space.xs }}>
            <Txt variant="title" weight="semibold" numberOfLines={2}>
              {est.client_name}
            </Txt>
            <Txt color="textMuted" numberOfLines={2}>
              {est.title}
            </Txt>
            {[est.client_phone, est.client_address, est.location].filter(Boolean).map((line) => (
              <Txt key={line} variant="caption" color="textMuted" numberOfLines={2}>
                {line}
              </Txt>
            ))}
          </View>
          <Divider />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Fact label={t('date')} value={formatDay(est.issue_day)} />
            <Fact label={t('validUntil')} value={formatDay(validUntil(est.issue_day, est.valid_days))} />
          </View>
        </Card>

        {/* the total is the centre of the screen */}
        <Card>
          <MoneyLine label={t('subtotal')} value={formatLKR(total.subtotal_cents)} />
          {total.discount_cents > 0 ? <MoneyLine label={t('discount')} value={`−${formatLKR(total.discount_cents)}`} /> : null}
          {est.tax_bp > 0 ? <MoneyLine label={`${t('tax')} (${formatPercent(est.tax_bp)} %)`} value={formatLKR(total.tax_cents)} /> : null}
          <Divider />
          <Txt eyebrow>{t('total')}</Txt>
          <Txt variant="amountXl" weight="bold" numeric adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1}>
            {formatLKR(total.total_cents)}
          </Txt>
          {!locked ? <Button kind="ghost" compact icon={Percent} label={t('discountAndTax')} onPress={() => router.push(`/estimate/form?id=${est.id}&more=1`)} style={{ alignSelf: 'flex-start' }} /> : null}
        </Card>

        {locked ? (
          <Card tone="warningSoft">
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
              <Lock size={24} color={c.warning} strokeWidth={2} />
              <Txt weight="semibold" color="warning" style={{ flex: 1 }}>
                {t('estimateLockedCaption')}
              </Txt>
            </View>
            <Button kind="secondary" compact icon={RotateCcw} label={t('reopenAsDraft')} onPress={() => setStatus('draft')} />
          </Card>
        ) : null}

        {/* price lines */}
        <SectionTitle title={t('items')} count={items.length} />
        {items.length ? (
          <ListCard>
            {items.map((it) => (
              <ListRow
                key={it.id}
                title={it.description}
                subtitle={`${[formatQty(it.qty_milli), it.unit].filter(Boolean).join(' ')} × ${formatLKR(it.rate_cents)}`}
                value={formatLKR(lineAmount(it.qty_milli, it.rate_cents))}
                onPress={locked ? undefined : () => openItem(it.id)}
              />
            ))}
          </ListCard>
        ) : (
          <Card>
            <EmptyState
              compact
              icon={ListPlus}
              title={t('noItems')}
              hint={t('noItemsHint')}
              action={locked ? undefined : <Button kind="secondary" compact icon={Plus} label={t('addItem')} onPress={() => openItem()} />}
            />
          </Card>
        )}
        {!locked && items.length ? <Button kind="secondary" compact icon={Plus} label={t('addItem')} onPress={() => openItem()} full /> : null}

        {/* payment schedule */}
        <SectionTitle title={t('paymentSchedule')} count={payments.length || undefined} />
        {payments.length ? (
          <ListCard>
            {payments.map((p, i) => (
              <ListRow
                key={p.id}
                title={p.label}
                subtitle={`${formatPercent(p.percent_bp)} %`}
                value={formatLKR(amounts[i] ?? 0, { forceDecimals: stageDecimals })}
                onPress={locked ? undefined : () => openStage(p.id)}
              />
            ))}
          </ListCard>
        ) : (
          <Card>
            <EmptyState
              compact
              icon={ListChecks}
              title={t('noStages')}
              hint={t('noStagesHint')}
              action={
                locked ? undefined : (
                  <View style={{ gap: space.sm }}>
                    <Button kind="secondary" compact icon={ListChecks} label={t('useStandardSchedule')} onPress={standardSchedule} />
                    <Button kind="ghost" compact icon={Plus} label={t('addStage')} onPress={() => openStage()} />
                  </View>
                )
              }
            />
          </Card>
        )}
        {payments.length && unscheduled > 0 ? (
          <Card tone="warningSoft">
            <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
              <AlertTriangle size={24} color={c.warning} strokeWidth={2} />
              <Txt weight="semibold" color="warning" style={{ flex: 1 }}>
                {t('unscheduledPercent', { pct: formatPercent(unscheduled) })}
              </Txt>
            </View>
          </Card>
        ) : null}
        {!locked && payments.length ? (
          <View style={{ gap: space.sm }}>
            <Button kind="secondary" compact icon={Plus} label={t('addStage')} onPress={() => openStage()} full />
            <Button kind="ghost" compact icon={ListChecks} label={t('useStandardSchedule')} onPress={standardSchedule} full />
          </View>
        ) : null}

        {/* where the client pays */}
        <SectionTitle title={t('paymentDetails')} />
        {bank.length ? (
          <Card>
            {bank.map((line) => (
              <MoneyLine key={line.label} label={line.label} value={line.value.trim()} numeric={line.numeric} text />
            ))}
            <Button
              kind="ghost"
              compact
              icon={bankIncomplete ? Landmark : Pencil}
              label={bankIncomplete ? t('addBankDetails') : t('edit')}
              onPress={() => router.push('/company')}
              style={{ alignSelf: 'flex-start' }}
            />
          </Card>
        ) : (
          <ListCard>
            <ListRow icon={Landmark} iconTone="primary" title={t('addBankDetails')} subtitle={t('companyAndBankHint')} onPress={() => router.push('/company')} />
          </ListCard>
        )}

        {/* terms and notes */}
        <SectionTitle title={t('termsAndNotes')} />
        <Card>
          {est.terms ? (
            <View style={{ gap: space.xs }}>
              <Txt eyebrow>{t('terms')}</Txt>
              <Txt>{est.terms}</Txt>
            </View>
          ) : null}
          {est.notes ? (
            <View style={{ gap: space.xs }}>
              <Txt eyebrow>{t('notes')}</Txt>
              <Txt>{est.notes}</Txt>
            </View>
          ) : null}
          {!est.terms && !est.notes ? (
            <Txt variant="caption" color="textMuted">
              {t('noTerms')}
            </Txt>
          ) : null}
        </Card>

        {/* actions */}
        <View style={{ gap: space.md, marginTop: space.md }}>
          <Button icon={Share2} label={t('shareEstimatePdf')} onPress={() => setSheetOpen(true)} full />
          {projectElsewhere ? (
            <Txt variant="caption" color="textMuted">
              {t('projectOnOtherPhone')}
            </Txt>
          ) : null}
          <ListCard inset>{actionRows}</ListCard>
          <Button kind="danger" icon={Trash2} label={t('deleteEstimate')} onPress={remove} full />
        </View>
      </Screen>

      <PdfShareSheet
        visible={sheetOpen}
        busy={sharing}
        letterhead={letterhead}
        lang={pdfLang}
        onLetterhead={(on) => setSetting('estimate_letterhead', on ? '1' : '0')}
        onLang={(l) => setSetting('estimate_lang', l)}
        onShare={() => void share()}
        onClose={() => setSheetOpen(false)}
      />
      {shareSheet.sheet}
    </>
  );
}
