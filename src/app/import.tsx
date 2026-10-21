import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, CheckCircle2, FileDown, FileQuestion, Paperclip } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState, toast } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/form';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import type { DataTable } from '@/db/schema';
import { setCurrentProject, useProjects } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { applyBundle, planImport, type Bundle, type ImportPlan } from '@/lib/bundle';
import { formatDay } from '@/lib/dates';
import { addFile } from '@/lib/files';
import { readProjectPdf } from '@/lib/pdf';
import { space, useColors } from '@/theme';

type State =
  | { step: 'pick' }
  | { step: 'reading' }
  | { step: 'preview'; bundle: Bundle; files: Map<string, Uint8Array>; plan: ImportPlan }
  | { step: 'foreign'; uri: string }
  | { step: 'error'; key: TKey }
  | { step: 'done'; plan: ImportPlan; projectId?: string };

const TABLE_LABEL: Record<DataTable, TKey> = {
  projects: 'projects',
  workers: 'workers',
  tools: 'tools',
  expenses: 'expenses',
  wage_entries: 'wages',
  tool_movements: 'toolRecords',
  site_notes: 'siteNotes',
  attachments: 'receiptPhotos',
};

export default function ImportScreen() {
  const t = useT();
  const c = useColors();
  const params = useLocalSearchParams<{ uri?: string }>();
  const projects = useProjects();
  const [state, setState] = useState<State>(params.uri ? { step: 'reading' } : { step: 'pick' });
  const [busy, setBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);

  // Opened from "Share to Bluemoon" with a file already chosen.
  useEffect(() => {
    if (params.uri) analyze(params.uri).then(setState);
  }, [params.uri]);

  async function pick() {
    const res = await File.pickFileAsync({ mimeTypes: 'application/pdf' });
    if (res.canceled) return;
    setState({ step: 'reading' });
    setState(await analyze(res.result.uri));
  }

  async function doImport() {
    if (state.step !== 'preview') return;
    setBusy(true);
    try {
      const plan = await applyBundle(state.bundle.tables, state.files);
      if (state.bundle.project_id) setCurrentProject(state.bundle.project_id);
      toast(t('importDone'));
      setState({ step: 'done', plan, projectId: state.bundle.project_id });
    } catch {
      setState({ step: 'error', key: 'pdfDamaged' });
    } finally {
      setBusy(false);
    }
  }

  async function attach(projectId: string) {
    if (state.step !== 'foreign') return;
    try {
      await addFile('projects', projectId, state.uri, 'application/pdf');
      toast(t('attached'));
      router.replace(`/project/${projectId}`);
    } catch (e) {
      Alert.alert(t('somethingWrong'), e instanceof Error ? e.message : String(e));
    }
  }

  if (state.step === 'pick' || state.step === 'reading') {
    return (
      <Screen>
        <EmptyState
          icon={FileDown}
          title={t('importPdf')}
          hint={t('importPdfHint')}
          action={<Button icon={FileDown} label={state.step === 'reading' ? t('reading') : t('choosePdf')} loading={state.step === 'reading'} onPress={pick} full />}
        />
      </Screen>
    );
  }

  if (state.step === 'error') {
    return (
      <Screen>
        <EmptyState icon={AlertTriangle} title={t('importPdf')} hint={t(state.key)} action={<Button kind="secondary" label={t('choosePdf')} onPress={pick} full />} />
      </Screen>
    );
  }

  if (state.step === 'foreign') {
    return (
      <Screen>
        <EmptyState
          icon={FileQuestion}
          title={t('importPdf')}
          hint={t('notOurPdf')}
          action={
            <View style={{ gap: space.sm }}>
              <Button icon={Paperclip} label={t('attachToProject')} onPress={() => setAttachOpen(true)} full />
              <Button kind="secondary" label={t('choosePdf')} onPress={pick} full />
            </View>
          }
        />
        <PickerSheet
          visible={attachOpen}
          title={t('attachToProject')}
          value={null}
          items={projects.map((p) => ({ id: p.id, title: p.name }))}
          onClose={() => setAttachOpen(false)}
          onPick={(id) => {
            setAttachOpen(false);
            if (id) attach(id);
          }}
        />
      </Screen>
    );
  }

  if (state.step === 'done') {
    return (
      <Screen
        footer={
          <Button
            label={t('done')}
            onPress={() => (state.projectId ? router.replace(`/project/${state.projectId}`) : router.back())}
          />
        }>
        <EmptyState icon={CheckCircle2} title={t('importDone')} hint={summary(state.plan, t)} />
      </Screen>
    );
  }

  const { bundle, plan } = state;
  return (
    <Screen footer={<Button label={t('importNow')} loading={busy} onPress={doImport} disabled={plan.counts.inserted + plan.counts.updated === 0} />}>
      <Card>
        <Txt variant="caption" color="textMuted" weight="semibold">
          {t('project')}
        </Txt>
        <Txt variant="heading" weight="bold">
          {bundle.project_name ?? '—'}
        </Txt>
        <Txt color="textMuted">
          {t('fromPhone')}: {formatDay(bundle.exported_at.slice(0, 10))}
        </Txt>
      </Card>

      <Txt variant="title" weight="bold">
        {t('willChange')}
      </Txt>
      <Card>
        {Object.entries(plan.perTable).map(([table, n]) => (
          <View key={table} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 }}>
            <Txt weight="semibold" style={{ flex: 1 }}>
              {t(TABLE_LABEL[table as DataTable])}
            </Txt>
            {n!.inserted ? <Txt color="success" weight="bold" numeric>{`+${n!.inserted} ${t('newRecords')}`}</Txt> : null}
            {n!.updated ? <Txt color="warning" weight="bold" numeric>{`${n!.updated} ${t('updatedRecords')}`}</Txt> : null}
            {!n!.inserted && !n!.updated ? <Txt color="textMuted">{t('unchanged')}</Txt> : null}
          </View>
        ))}
      </Card>
      {plan.counts.inserted + plan.counts.updated === 0 ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <CheckCircle2 size={20} color={c.success} />
          <Txt color="success" weight="semibold">
            {t('unchanged')}
          </Txt>
        </View>
      ) : null}
    </Screen>
  );
}

/** Read a PDF and decide which screen to show. Never throws. */
async function analyze(uri: string): Promise<State> {
  try {
    const bytes = await new File(uri).bytes();
    const res = await readProjectPdf(bytes);
    if (res.status === 'ok') return { step: 'preview', bundle: res.bundle, files: res.files, plan: planImport(res.bundle.tables) };
    if (res.status === 'not-ours') return { step: 'foreign', uri };
    return { step: 'error', key: res.status === 'newer' ? 'pdfNewer' : 'pdfDamaged' };
  } catch {
    return { step: 'error', key: 'somethingWrong' };
  }
}

function summary(plan: ImportPlan, t: (k: TKey) => string): string {
  return `${plan.counts.inserted} ${t('newRecords')} · ${plan.counts.updated} ${t('updatedRecords')} · ${plan.counts.skipped} ${t('unchanged')}`;
}
