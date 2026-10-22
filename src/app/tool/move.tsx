import { Stack, useLocalSearchParams } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Building2, Calendar, Hammer, Trash2, User } from 'lucide-react-native';
import { useMemo, useState } from 'react';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { DateField, Field, SelectField } from '@/components/ui/form';
import { ListCard, ListRow, Screen } from '@/components/ui/layout';
import { useFirst, useQuery } from '@/db';
import { deleteRecord, moveTool, ValidationError } from '@/db/repo';
import type { ToolMovement, ToolStatus, Worker } from '@/db/types';
import { useCurrentProjectId, useProjects, useProjectWorkers, useTools, useWorkers } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { formatDay, today } from '@/lib/dates';

type Kind = 'issue' | 'return';
type Params = { id?: string; toolId?: string; kind?: Kind; projectId?: string };

/** Issue or return a tool. Opened with ?id= it shows a past movement (read-only) and its photos. */
export default function ToolMove() {
  const params = useLocalSearchParams<Params>();
  const existing = useFirst<ToolMovement>('SELECT * FROM tool_movements WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  if (params.id && !existing) return null;
  return existing ? <Existing move={existing} /> : <Inner params={params} />;
}

// ---------------------------------------------------------------- past movement (read-only)

function Existing({ move }: { move: ToolMovement }) {
  const t = useT();
  const form = useRecordForm('tool_movements', move.id);
  const row = useFirst<{ tool_name: string; tool_code: string | null; worker_name: string | null; project_name: string | null }>(
    `SELECT tl.name AS tool_name, tl.code AS tool_code, w.name AS worker_name, p.name AS project_name
     FROM tool_movements m JOIN tools tl ON tl.id = m.tool_id
     LEFT JOIN workers w ON w.id = m.worker_id LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?`,
    [move.id],
  );
  const isIssue = move.kind === 'issue';
  return (
    <>
      <Stack.Screen
        options={{
          title: t(isIssue ? 'issue' : 'return'),
          headerRight: () => (
            <IconButton icon={Trash2} label={t('delete')} size={44} tone="danger" pressedBg="headerDeep" onPress={() => form.confirmDelete(() => deleteRecord('tool_movements', move.id))} />
          ),
        }}
      />
      <Screen>
        <ListCard inset>
          <ListRow
            icon={isIssue ? ArrowUpFromLine : ArrowDownToLine}
            iconTone={isIssue ? 'warning' : 'success'}
            title={t(isIssue ? 'issue' : 'return')}
            badge={<Badge tone={isIssue ? 'warning' : 'success'} label={t(isIssue ? 'out' : 'inStore')} />}
          />
          <ListRow icon={Hammer} title={row ? (row.tool_code ? `${row.tool_name} · ${row.tool_code}` : row.tool_name) : t('tool')} subtitle={t('tool')} />
          <ListRow icon={User} title={row?.worker_name ?? move.taken_by ?? '—'} subtitle={t('takenBy')} />
          <ListRow icon={Building2} title={row?.project_name ?? t('allProjects')} subtitle={t('project')} />
          <ListRow icon={Calendar} title={formatDay(move.day)} subtitle={t('date')} />
          {move.condition ? <ListRow title={move.condition} subtitle={t('condition')} /> : null}
          {move.note ? <ListRow title={move.note} subtitle={t('note')} /> : null}
        </ListCard>
        <PhotoStrip ownerTable="tool_movements" ownerId={move.id} label={t('photoProof')} editable={false} />
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------- new issue / return

function Inner({ params }: { params: Params }) {
  const t = useT();
  const form = useRecordForm('tool_movements');
  const current = useCurrentProjectId();
  const allProjects = useProjects();
  const allWorkers = useWorkers(true);
  const toolCount = useTools().length;
  const kind: Kind = params.kind === 'return' ? 'return' : 'issue';
  const tools = useQuery<ToolStatus>('SELECT * FROM v_tool_status WHERE is_out = ? ORDER BY name COLLATE NOCASE', [kind === 'issue' ? 0 : 1]);

  const [toolId, setToolId] = useState<string | null>(params.toolId ?? null);
  const status = useFirst<ToolStatus>('SELECT * FROM v_tool_status WHERE tool_id = ?', [toolId ?? '']);
  const [projectId, setProjectId] = useState<string | null>(kind === 'return' ? (status?.project_id ?? params.projectId ?? current) : (params.projectId ?? current));
  const [workerId, setWorkerId] = useState<string | null>(kind === 'return' ? (status?.worker_id ?? null) : null);
  const [takenBy, setTakenBy] = useState(kind === 'return' ? (status?.taken_by ?? '') : '');
  const [day, setDay] = useState(today());
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');

  // Returning: when the tool changes, follow where it actually is (the list already carries its status).
  function pickTool(id: string | null) {
    setToolId(id);
    form.clearError('tool_id');
    if (kind !== 'return') return;
    const s = tools.find((x) => x.tool_id === id);
    if (!s) return;
    setProjectId(s.project_id ?? current);
    setWorkerId(s.worker_id ?? null);
    setTakenBy(s.taken_by ?? '');
  }

  // Project picker: completed projects are not offered for new movements, but the one this form opened on
  // (or the one the returning tool is on) stays listed, so the field never shows a blank over a saved id.
  const [openedOn] = useState(projectId);
  const projectItems = useMemo(
    () =>
      allProjects
        .filter((p) => p.status !== 'completed' || p.id === openedOn || p.id === projectId || p.id === status?.project_id)
        .map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: p.location ?? undefined })),
    [allProjects, openedOn, projectId, status?.project_id],
  );

  // Worker picker: the project's roster when a project is chosen and has one, else every active worker.
  // The selected worker is always listed, even one who has since left (not in the active list).
  const roster = useProjectWorkers(projectId);
  const selectedWorker = useFirst<Worker>('SELECT * FROM workers WHERE id = ?', [workerId ?? '']);
  const workerItems = useMemo(() => {
    const base = roster.length
      ? roster.map((w) => ({ id: w.worker_id, title: w.name, subtitle: w.trade ?? undefined }))
      : allWorkers.map((w) => ({ id: w.id, title: w.name, subtitle: w.trade ?? undefined }));
    if (workerId && selectedWorker && !base.some((i) => i.id === workerId)) {
      base.unshift({ id: selectedWorker.id, title: selectedWorker.name, subtitle: selectedWorker.trade ?? undefined });
    }
    return base;
  }, [roster, allWorkers, workerId, selectedWorker]);

  // Make sure a tool passed in the URL is listed even if its status changed.
  const toolItems = useMemo(() => {
    const items = tools.map((x) => ({ id: x.tool_id, title: x.code ? `${x.name} · ${x.code}` : x.name }));
    if (toolId && status && !items.some((i) => i.id === toolId)) items.unshift({ id: toolId, title: status.code ? `${status.name} · ${status.code}` : status.name });
    return items;
  }, [tools, toolId, status]);

  // Why the tool list is empty: no tools at all, every tool is already out (issue), or none are out (return).
  const emptyToolsText = t(toolCount === 0 ? 'noTools' : kind === 'issue' ? 'allToolsOut' : 'noToolsOut');

  const save = () =>
    form.submit(() => {
      if (!toolId) throw new ValidationError('tool_id', 'errTool');
      if (kind === 'issue' && !projectId) throw new ValidationError('project_id', 'errProject');
      moveTool({ id: form.id, tool_id: toolId, kind, worker_id: workerId, taken_by: workerId ? null : takenBy, project_id: projectId, day, condition, note });
    });

  return (
    <>
      <Stack.Screen options={{ title: t(kind === 'issue' ? 'issueTool' : 'returnTool') }} />
      <Screen footer={<Button icon={kind === 'issue' ? ArrowUpFromLine : ArrowDownToLine} label={t('save')} onPress={save} full />} gap={20}>
        <SelectField
          label={t('tool')}
          items={toolItems}
          value={toolId}
          onChange={pickTool}
          error={form.err('tool_id')}
          placeholder={t('tool')}
          hint={toolItems.length === 0 ? emptyToolsText : undefined}
        />
        <SelectField
          label={t('project')}
          items={projectItems}
          value={projectId}
          onChange={(id) => {
            setProjectId(id);
            form.clearError('project_id');
          }}
          error={form.err('project_id')}
          optional={kind === 'return'}
          allowNone={kind === 'return'}
          placeholder={t('chooseProject')}
        />
        <SelectField
          label={t('takenBy')}
          items={workerItems}
          value={workerId}
          onChange={(id) => {
            setWorkerId(id);
            form.clearError('taken_by');
          }}
          error={workerId ? null : form.err('taken_by')}
          allowNone
          optional={kind === 'return'}
          placeholder={t('worker')}
          hint={projectId && roster.length ? t('projectWorkers') : undefined}
        />
        {!workerId ? (
          <Field
            label={t('someoneElse')}
            optional
            value={takenBy}
            onChangeText={(s) => {
              setTakenBy(s);
              form.clearError('taken_by');
            }}
            error={form.err('taken_by')}
            hint={t('takenBy')}
          />
        ) : null}
        <DateField label={t('date')} value={day} onChange={setDay} maxDay={today()} error={form.err('day')} />
        <Field label={t('condition')} optional placeholder={t('conditionHint')} value={condition} onChangeText={setCondition} />
        {/* PhotoStrip wraps capture in try/catch + showError (camera-off → settings / gallery). */}
        <PhotoStrip ownerTable="tool_movements" ownerId={form.id} label={t('photoProof')} />
        <Field label={t('note')} optional value={note} onChangeText={setNote} multiline />
      </Screen>
    </>
  );
}
