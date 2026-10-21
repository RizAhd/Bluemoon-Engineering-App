import { router } from 'expo-router';
import { Building2, Plus } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { ListCard, ListRow, Screen } from '@/components/ui/layout';
import { useQuery } from '@/db';
import type { ProjectCost } from '@/db/types';
import { useT } from '@/i18n';
import { formatLKR } from '@/lib/money';

export default function ProjectsScreen() {
  const t = useT();
  const rows = useQuery<ProjectCost & { location: string | null }>(
    `SELECT v.*, p.location FROM v_project_cost v JOIN projects p ON p.id = v.project_id
     ORDER BY CASE v.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, v.name COLLATE NOCASE`,
  );

  return (
    <Screen footer={<Button icon={Plus} label={t('newProject')} onPress={() => router.push('/project/form')} />}>
      {rows.length ? (
        <ListCard>
          {rows.map((p) => (
            <ListRow
              key={p.project_id}
              icon={Building2}
              iconTone={p.status === 'active' ? 'primary' : 'slate'}
              title={p.name}
              subtitle={p.location ?? undefined}
              value={formatLKR(p.expense_cents + p.labour_cents)}
              badge={
                <Badge
                  tone={p.status === 'active' ? 'success' : p.status === 'on_hold' ? 'warning' : 'slate'}
                  label={t(`status_${p.status}`)}
                />
              }
              onPress={() => router.push(`/project/${p.project_id}`)}
            />
          ))}
        </ListCard>
      ) : (
        <EmptyState icon={Building2} title={t('noProjects')} hint={t('noProjectsHint')} />
      )}
    </Screen>
  );
}
