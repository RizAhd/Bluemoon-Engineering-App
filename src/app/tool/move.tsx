import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ArrowDownToLine, ArrowUpFromLine, Building2, Calendar, ClipboardCheck, Hammer, Plus, Ruler, Trash2, User } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { QtyStepper } from '@/components/QtyStepper';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/feedback';
import { DateField, Field, SelectField } from '@/components/ui/form';
import { Initials } from '@/components/ui/kit';
import { Card, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { all, useFirst, useQuery } from '@/db';
import { deleteRecord, moveTool, ValidationError } from '@/db/repo';
import type { ToolHolder, ToolMovement, ToolStock, Worker } from '@/db/types';
import { useCurrentProjectId, useProjects, useProjectWorkers, useTools, useWorkers } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { formatDay, today } from '@/lib/dates';
import { formatQty, parseQty } from '@/lib/estimate';
import { isSinglePiece, qtyText } from '@/lib/toolStock';
import { hairline, radius, space, useColors } from '@/theme';

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
  const row = useFirst<{ tool_name: string; tool_code: string | null; unit: string | null; worker_name: string | null; project_name: string | null }>(
    `SELECT tl.name AS tool_name, tl.code AS tool_code, tl.unit AS unit, w.name AS worker_name, p.name AS project_name
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
            <IconButton icon={Trash2} label={t('delete')} size={44} tone="danger" shape="boxed" onPress={() => form.confirmDelete(() => deleteRecord('tool_movements', move.id))} />
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
          {move.qty_milli !== 1000 ? <ListRow icon={Ruler} title={qtyText(move.qty_milli, row?.unit)} subtitle={t('howMany')} /> : null}
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
  // what can be issued is what has some in store, what can be returned is what has some out
  const tools = useQuery<ToolStock>(
    `SELECT * FROM v_tool_stock WHERE ${kind === 'issue' ? 'in_store_milli' : 'out_milli'} > 0 ORDER BY name COLLATE NOCASE`,
  );

  const [toolId, setToolId] = useState<string | null>(params.toolId ?? null);
  const status = useFirst<ToolStock>('SELECT * FROM v_tool_stock WHERE tool_id = ?', [toolId ?? '']);
  // Returning: the one who has most of it is the usual one coming back, so the form starts with them and their count.
  const holder = useFirst<ToolHolder>('SELECT * FROM v_tool_holders WHERE tool_id = ? ORDER BY qty_milli DESC LIMIT 1', [toolId ?? '']);
  const [projectId, setProjectId] = useState<string | null>(kind === 'return' ? (holder?.project_id ?? params.projectId ?? current) : (params.projectId ?? current));
  const [workerId, setWorkerId] = useState<string | null>(kind === 'return' ? (holder?.worker_id ?? null) : null);
  const [takenBy, setTakenBy] = useState(kind === 'return' ? (holder?.taken_by ?? '') : '');
  const [qty, setQty] = useState(kind === 'return' && holder ? formatQty(holder.qty_milli) : '1');
  const [day, setDay] = useState(today());
  const [condition, setCondition] = useState('');
  const [note, setNote] = useState('');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([toolId, projectId, workerId, takenBy, qty, day, condition, note]);

  // Returning: when the tool changes, follow where it actually is (the list already carries its status).
  function pickTool(id: string | null) {
    setToolId(id);
    form.clearError('tool_id');
    setQty('1');
    form.clearError('qty');
    if (kind !== 'return' || !id) return;
    const h = all<ToolHolder>('SELECT * FROM v_tool_holders WHERE tool_id = ? ORDER BY qty_milli DESC LIMIT 1', [id])[0];
    if (!h) return;
    setProjectId(h.project_id ?? current);
    setWorkerId(h.worker_id ?? null);
    setTakenBy(h.taken_by ?? '');
    setQty(formatQty(h.qty_milli));
  }

  // Project picker: completed projects are not offered for new movements, but the one this form opened on
  // (or the one the returning tool is on) stays listed, so the field never shows a blank over a saved id.
  const [openedOn] = useState(projectId);
  const projectItems = useMemo(
    () =>
      allProjects
        .filter((p) => p.status !== 'completed' || p.id === openedOn || p.id === projectId || p.id === holder?.project_id)
        .map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: p.location ?? undefined })),
    [allProjects, openedOn, projectId, holder?.project_id],
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
      // the box is only there for several pieces or a material; a count that is not a number is an error under it, never one piece
      const counted = !!status && !isSinglePiece(status);
      const quantity = counted ? parseQty(qty) : null;
      if (counted && quantity == null) throw new ValidationError('qty', 'errQty');
      moveTool({ id: form.id, tool_id: toolId, kind, qty_milli: quantity, worker_id: workerId, taken_by: workerId ? null : takenBy, project_id: projectId, day, condition, note });
    });

  return (
    <>
      <Stack.Screen options={{ title: t(kind === 'issue' ? (status?.is_material ? 'issueMaterial' : 'issueTool') : 'returnTool') }} />
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
        {workerItems.length ? (
          <GivenTo
            items={workerItems}
            value={workerId}
            onPick={(id) => {
              setWorkerId(id);
              form.clearError('taken_by');
            }}
            someoneElse={kind === 'issue' && !!workerId ? t('otherPersonName') : undefined}
          />
        ) : null}
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
          placeholder={t('chooseWorker')}
          hint={projectId && roster.length ? t('projectWorkers') : undefined}
        />
        {!workerId ? (
          <Field
            label={t('otherPersonName')}
            optional
            icon={User}
            placeholder={t('phOtherPerson')}
            autoCapitalize="words"
            value={takenBy}
            onChangeText={(s) => {
              setTakenBy(s);
              form.clearError('taken_by');
            }}
            error={form.err('taken_by')}
            hint={t('otherPersonHint')}
          />
        ) : null}
        {/* only for a tool with several pieces or a material: a single piece reads as it always did */}
        {status && !isSinglePiece(status) ? (
          <QtyStepper
            label={t('howMany')}
            value={qty}
            onChange={(s) => {
              setQty(s);
              form.clearError('qty');
            }}
            decimal={!!status.is_material}
            aside={t(kind === 'issue' ? 'inStoreCount' : 'outCount', { n: qtyText(kind === 'issue' ? status.in_store_milli : status.out_milli, status.unit) })}
            error={form.err('qty')}
          />
        ) : null}
        <DateField label={t('date')} value={day} onChange={setDay} maxDay={today()} error={form.err('day')} />
        <Field label={t('condition')} optional icon={ClipboardCheck} placeholder={t('conditionHint')} value={condition} onChangeText={setCondition} />
        {/* PhotoStrip wraps capture in try/catch + showError (camera-off → settings / gallery). */}
        <PhotoStrip ownerTable="tool_movements" ownerId={form.id} label={t('photoProof')} />
        <Field label={t('note')} optional placeholder={t(kind === 'return' ? 'phToolMoveNote' : 'phToolIssueNote')} value={note} onChangeText={setNote} multiline />
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------- "Taken by" quick pick

/** How many people the avatar row offers before the full list (the Taken by field under it) takes over. */
const QUICK_PICK = 8;

/**
 * Blueprint "Given to": the project's people as avatars in one row, the chosen one ringed in blue. A tap picks, a
 * second tap clears. Everyone (and anyone left out of the row) stays in the Taken by list below.
 */
function GivenTo({
  items,
  value,
  onPick,
  someoneElse,
}: {
  items: { id: string; title: string; subtitle?: string }[];
  value: string | null;
  onPick: (id: string | null) => void;
  /** Label of the "someone not on the list" button; shown only while a worker is picked. */
  someoneElse?: string;
}) {
  const c = useColors();
  const chosenFirst = value && items.findIndex((i) => i.id === value) >= QUICK_PICK ? [items.find((i) => i.id === value)!, ...items] : items;
  const shown = chosenFirst.slice(0, QUICK_PICK);
  return (
    <Card padding={space.md} gap={space.md}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.xs }}>
        {shown.map((w) => {
          const on = w.id === value;
          return (
            <Pressable
              key={w.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={w.subtitle ? `${w.title}, ${w.subtitle}` : w.title}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onPick(on ? null : w.id);
              }}
              style={{ width: 68, alignItems: 'center', gap: 6, paddingVertical: space.xs }}>
              <View style={{ padding: 2, borderRadius: 32, borderWidth: 2, borderColor: on ? c.primary : 'transparent' }}>
                <Initials name={w.title} size={52} />
              </View>
              <Txt variant="caption" weight={on ? 'bold' : 'semibold'} color={on ? 'primary' : 'text'} numberOfLines={1} center>
                {w.title.split(/\s+/)[0]}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
      {someoneElse ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onPick(null)}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.sm,
            borderRadius: radius.md,
            borderWidth: hairline,
            borderStyle: 'dashed',
            borderColor: c.borderStrong,
            backgroundColor: pressed ? c.muted : 'transparent',
          })}>
          <Plus size={16} color={c.textMuted} strokeWidth={2.2} />
          <Txt weight="semibold" color="textMuted" numberOfLines={1}>
            {someoneElse}
          </Txt>
        </Pressable>
      ) : null}
    </Card>
  );
}
