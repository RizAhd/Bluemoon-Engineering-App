import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FileOutput, NotebookPen, Pencil, Star } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { CategoryBars, ContractBar, Stat } from '@/components/Stats';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { Card, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import type { ProjectCost } from '@/db/types';
import { setCurrentProject, useCurrentProjectId, useProject } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { formatLKR } from '@/lib/money';
import { exportProjectPdf } from '@/lib/pdf';
import { space, useColors } from '@/theme';

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const c = useColors();
  const project = useProject(id);
  const current = useCurrentProjectId();
  const cost = useFirst<ProjectCost>('SELECT * FROM v_project_cost WHERE project_id = ?', [id]);
  const cats = useQuery<{ category: string; s: number }>(
    'SELECT category, SUM(amount_cents) AS s FROM expenses WHERE project_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY s DESC',
    [id],
  );
  const noteCount = useFirst<{ n: number }>('SELECT COUNT(*) AS n FROM site_notes WHERE project_id = ? AND deleted_at IS NULL', [id])?.n ?? 0;
  const [includePhotos, setIncludePhotos] = useState(true);
  const [exporting, setExporting] = useState(false);

  if (!project || !cost) return null;
  const total = cost.expense_cents + cost.labour_cents;

  async function onExport() {
    setExporting(true);
    try {
      const file = await exportProjectPdf(project!.id, { includePhotos });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: project!.name, UTI: 'com.adobe.pdf' });
    } catch (e) {
      Alert.alert(t('somethingWrong'), e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: project.name,
          headerRight: () => <IconButton icon={Pencil} label={t('editProject')} onPress={() => router.push(`/project/form?id=${project.id}`)} />,
        }}
      />
      <Screen>
        <View style={{ gap: space.sm }}>
          <Badge
            tone={project.status === 'active' ? 'success' : project.status === 'on_hold' ? 'warning' : 'slate'}
            label={t(`status_${project.status}`)}
          />
          {project.client || project.location ? (
            <Txt color="textMuted">{[project.client, project.location].filter(Boolean).join(' · ')}</Txt>
          ) : null}
          {current !== project.id ? (
            <Button kind="ghost" compact icon={Star} label={t('setCurrent')} onPress={() => setCurrentProject(project.id)} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </View>

        <Card>
          <Txt color="textMuted" weight="semibold">
            {t('totalCost')}
          </Txt>
          <Txt variant="amountXl" weight="bold" numeric adjustsFontSizeToFit numberOfLines={1}>
            {formatLKR(total)}
          </Txt>
          {project.contract_cents ? <ContractBar spent={total} contract={project.contract_cents} /> : null}
          {project.contract_cents ? (
            <Txt color={project.contract_cents - total < 0 ? 'danger' : 'textMuted'} numeric>
              {t('balanceToContract')}: {formatLKR(project.contract_cents - total)}
            </Txt>
          ) : null}
        </Card>

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Stat label={t('materialsAndOther')} value={formatLKR(cost.expense_cents)} onPress={() => { setCurrentProject(project.id); router.push('/(tabs)/expenses'); }} />
          <Stat label={t('labour')} value={formatLKR(cost.labour_cents)} onPress={() => { setCurrentProject(project.id); router.push('/(tabs)/workers'); }} />
        </View>
        <Stat label={t('labourPaid')} value={formatLKR(cost.labour_paid_cents)} />

        {cats.length ? (
          <>
            <SectionTitle title={t('byCategory')} />
            <Card>
              <CategoryBars rows={cats.map((r) => ({ label: t(`cat_${r.category}` as TKey), cents: r.s }))} />
            </Card>
          </>
        ) : null}

        <Button kind="secondary" icon={NotebookPen} label={`${t('siteNotes')} (${noteCount})`} onPress={() => router.push(`/notes?projectId=${project.id}`)} />

        <SectionTitle title={t('exportPdf')} />
        <Card>
          <Txt color="textMuted">{t('exportPdfHint')}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
            <Txt weight="semibold" style={{ flex: 1 }}>
              {t('includePhotos')}
            </Txt>
            <Switch
              value={includePhotos}
              onValueChange={setIncludePhotos}
              accessibilityLabel={t('includePhotos')}
              trackColor={{ true: c.primary, false: c.borderStrong }}
              thumbColor={c.card}
            />
          </View>
          <Button icon={FileOutput} label={exporting ? t('exporting') : t('exportPdf')} loading={exporting} onPress={onExport} />
        </Card>

        <PhotoStrip ownerTable="projects" ownerId={project.id} label={t('projectDocs')} />
      </Screen>
    </>
  );
}
