import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button } from '@/components/ui/Button';
import { DateField, Field, SelectField } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useFirst, useQuery } from '@/db';
import { moveTool } from '@/db/repo';
import type { ToolMovement, ToolStatus } from '@/db/types';
import { useCurrentProjectId, useProjects, useWorkers } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';

/** Issue or return a tool. Opened with ?id= it shows a past movement and its photos. */
export default function ToolMove() {
  const params = useLocalSearchParams<{ id?: string; toolId?: string; kind?: 'issue' | 'return' }>();
  const existing = useFirst<ToolMovement>('SELECT * FROM tool_movements WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} params={params} />;
}

function Inner({ existing, params }: { existing: ToolMovement | null; params: { toolId?: string; kind?: 'issue' | 'return' } }) {
  const t = useT();
  const form = useRecordForm('tool_movements', existing?.id);
  const workers = useWorkers(true);
  const projects = useProjects(false);
  const current = useCurrentProjectId();
  const kind = existing?.kind ?? params.kind ?? 'issue';
  const tools = useQuery<ToolStatus>(
    `SELECT * FROM v_tool_status WHERE is_out = ? ORDER BY name COLLATE NOCASE`,
    [kind === 'issue' ? 0 : 1],
  );

  const [toolId, setToolId] = useState<string | null>(existing?.tool_id ?? params.toolId ?? null);
  const status = useFirst<ToolStatus>('SELECT * FROM v_tool_status WHERE tool_id = ?', [toolId ?? '']);
  const [workerId, setWorkerId] = useState<string | null>(existing?.worker_id ?? (kind === 'return' ? status?.worker_id ?? null : null));
  const [takenBy, setTakenBy] = useState(existing?.taken_by ?? '');
  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? (kind === 'return' ? status?.project_id ?? current : current));
  const [day, setDay] = useState(existing?.day ?? today());
  const [condition, setCondition] = useState(existing?.condition ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const readOnly = !!existing;

  // Make sure a tool passed in the URL is listed even if its status changed.
  const items = tools.map((x) => ({ id: x.tool_id, title: x.code ? `${x.name} · ${x.code}` : x.name }));
  if (toolId && status && !items.some((i) => i.id === toolId)) items.unshift({ id: toolId, title: status.name });

  return (
    <>
      <Stack.Screen options={{ title: t(kind === 'issue' ? 'issueTool' : 'returnTool') }} />
      <Screen
        footer={
          readOnly ? undefined : (
            <Button
              label={t('save')}
              onPress={() =>
                form.submit(() =>
                  moveTool({
                    tool_id: toolId ?? '',
                    kind,
                    worker_id: workerId,
                    taken_by: takenBy,
                    project_id: projectId,
                    day,
                    condition,
                    note,
                  }),
                )
              }
            />
          )
        }>
        <SelectField label={t('tool')} items={items} value={toolId} onChange={setToolId} error={form.err('tool_id')} placeholder={t('tool')} />
        <SelectField
          label={t('takenBy')}
          items={workers.map((w) => ({ id: w.id, title: w.name, subtitle: w.trade ?? undefined }))}
          value={workerId}
          onChange={setWorkerId}
          error={form.err('taken_by')}
          allowNone
          placeholder={t('worker')}
        />
        {!workerId ? <Field label={t('takenBy')} optional value={takenBy} onChangeText={setTakenBy} placeholder={t('name')} /> : null}
        <SelectField label={t('project')} optional allowNone items={projects.map((p) => ({ id: p.id, title: p.name }))} value={projectId} onChange={setProjectId} placeholder="—" />
        <DateField label={t('date')} value={day} onChange={setDay} />
        <Field label={t('condition')} optional placeholder={t('conditionHint')} value={condition} onChangeText={setCondition} />
        <PhotoStrip ownerTable="tool_movements" ownerId={form.id} label={t('photoProof')} editable={!readOnly} />
        <Field label={t('note')} optional value={note} onChangeText={setNote} />
        {readOnly ? <Txt color="textMuted">{t('savedOnPhone')}</Txt> : null}
      </Screen>
    </>
  );
}
