import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, CheckCircle2, FileDown, FileQuestion, Paperclip } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState, toast } from '@/components/ui/feedback';
import { PickerSheet } from '@/components/ui/form';
import { Card, ListCard, ListRow, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import type { DataTable } from '@/db/schema';
import { setCurrentProject, useProjects } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { applyBundle, planImport, type Bundle, type ImportPlan } from '@/lib/bundle';
import { formatDay } from '@/lib/dates';
import { guard, reportError } from '@/lib/errors';
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
  project_workers: 'projectWorkers',
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
    if (params.uri) {
      analyze(params.uri)
        .then(setState)
        .catch((e) => {
          reportError(e, 'import.analyze');
          setState({ step: 'error', key: 'somethingWrong' });
        });
    }
  }, [params.uri]);

  async function pick() {
    const res = await guard('import.pick', t, () => File.pickFileAsync({ mimeTypes: 'application/pdf' }));
    if (!res || res.canceled) return;
    setState({ step: 'reading' });
    setState(await analyze(res.result.uri));
  }

  async function doImport() {
    if (state.step !== 'preview' || busy) return;
    setBusy(true);
    const { bundle, files } = state;
    const plan = await guard('import.apply', t, () => applyBundle(bundle.tables, files));
    setBusy(false);
    if (!plan) return; // the preview stays so the user can try again
    if (bundle.project_id) setCurrentProject(bundle.project_id);
    toast(t('importDone'));
    setState({ step: 'done', plan, projectId: bundle.project_id });
  }

  async function attach(projectId: string) {
    if (state.step !== 'foreign' || busy) return;
    const { uri } = state;
    setBusy(true);
    const ok = await guard('import.attach', t, () => addFile('projects', projectId, uri, 'application/pdf'));
    setBusy(false);
    if (!ok) return;
    toast(t('attached'));
    router.replace(`/project/${projectId}`);
  }

  if (state.step === 'pick' || state.step === 'reading') {
    return (
      <Screen>
        <EmptyState
          icon={FileDown}
          title={t('importPdf')}
          hint={t('importPdfHint')}
          action={<Button icon={FileDown} label={state.step === 'reading' ? t('reading') : t('choosePdf')} loading={state.step === 'reading'} onPress={() => void pick()} full />}
        />
      </Screen>
    );
  }

  if (state.step === 'error') {
    return (
      <Screen>
        <EmptyState icon={AlertTriangle} title={t('errorTitle')} hint={t(state.key)} action={<Button label={t('choosePdf')} onPress={() => void pick()} full />} />
      </Screen>
    );
  }

  if (state.step === 'foreign') {
    return (
      <Screen footer={<Button kind="secondary" label={t('choosePdf')} onPress={() => void pick()} disabled={busy} full />}>
        <EmptyState
          icon={FileQuestion}
          title={t('importPdf')}
          hint={t('notOurPdf')}
          action={<Button icon={Paperclip} label={t('attachToProject')} onPress={() => setAttachOpen(true)} loading={busy} full />}
        />
        <PickerSheet
          visible={attachOpen}
          title={t('attachToProject')}
          value={null}
          items={projects.map((p) => ({ id: p.id, title: p.name, subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · ') }))}
          onClose={() => setAttachOpen(false)}
          onPick={(id) => {
            setAttachOpen(false);
            if (id) void attach(id);
          }}
        />
      </Screen>
    );
  }

  if (state.step === 'done') {
    return (
      <Screen footer={<Button label={t('done')} onPress={() => (state.projectId ? router.replace(`/project/${state.projectId}`) : router.back())} full />}>
        <EmptyState icon={CheckCircle2} title={t('importDone')} hint={summary(state.plan, t)} />
      </Screen>
    );
  }

  const { bundle, plan } = state;
  const nothing = plan.counts.inserted + plan.counts.updated === 0;
  return (
    <Screen
      footer={
        nothing ? (
          <Button kind="secondary" label={t('done')} onPress={() => router.back()} full />
        ) : (
          <Button label={t('importNow')} loading={busy} onPress={() => void doImport()} full />
        )
      }>
      <Card gap={space.xs}>
        <Txt eyebrow>{t('project')}</Txt>
        <Txt variant="title" weight="semibold">
          {bundle.project_name ?? '—'}
        </Txt>
        <Txt variant="caption" color="textMuted" numeric>
          {`${t('fromPhone')}: ${formatDay(bundle.exported_at.slice(0, 10))}`}
        </Txt>
      </Card>

      <SectionTitle title={t('willChange')} />
      <ListCard>
        {Object.entries(plan.perTable).map(([table, n]) => {
          const ins = n?.inserted ?? 0;
          const upd = n?.updated ?? 0;
          const parts = [ins ? `+${ins} ${t('newRecords')}` : '', upd ? `${upd} ${t('updatedRecords')}` : ''].filter(Boolean);
          return (
            <ListRow
              key={table}
              title={t(TABLE_LABEL[table as DataTable] ?? 'records')}
              subtitle={parts.length ? undefined : t('unchanged')}
              value={parts.length ? parts.join(' · ') : undefined}
            />
          );
        })}
      </ListCard>
      {nothing ? (
        <Card tone="successSoft">
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <CheckCircle2 size={24} color={c.success} strokeWidth={2} />
            <Txt color="success" weight="semibold" style={{ flex: 1 }}>
              {t('unchanged')}
            </Txt>
          </View>
        </Card>
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
  } catch (e) {
    reportError(e, 'import.read', { uri });
    return { step: 'error', key: 'somethingWrong' };
  }
}

function summary(plan: ImportPlan, t: (k: TKey) => string): string {
  return `${plan.counts.inserted} ${t('newRecords')} · ${plan.counts.updated} ${t('updatedRecords')} · ${plan.counts.skipped} ${t('unchanged')}`;
}
