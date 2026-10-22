import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Building2, HardHat, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button } from '@/components/ui/Button';
import { AmountField, Field, PickerSheet, Segmented, SelectField } from '@/components/ui/form';
import { EmptyState, toast } from '@/components/ui/feedback';
import { Card, ListCard, ListRow, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { tx } from '@/db';
import { assignWorker, saveWorker, setProjectWorkerRate, unassignWorker, ValidationError } from '@/db/repo';
import { setCurrentProject, useCurrentProjectId, useProject, useProjects, useProjectWorkers, useWorkers } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { centsToInput, formatLKR, parseCents } from '@/lib/money';
import { showError } from '@/lib/errors';

type Mode = 'existing' | 'new';

/**
 * Add a worker to a project with a rate for that project: pick an existing worker or
 * create a new one inline. With `workerId` it edits that worker's rate on the project
 * (and can remove them from it).
 */
export default function AssignWorkerScreen() {
  const params = useLocalSearchParams<{ projectId?: string; workerId?: string }>();
  const pid = useCurrentProjectId();
  const [chosen, setChosen] = useState<string | null>(null);
  const projectId = chosen ?? params.projectId ?? pid;

  if (!projectId) return <ChooseProject onPick={setChosen} />;
  return <Inner key={projectId} projectId={projectId} workerId={params.workerId} />;
}

function ChooseProject({ onPick }: { onPick: (id: string) => void }) {
  const t = useT();
  const projects = useProjects();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Stack.Screen options={{ title: t('addWorkerToProject') }} />
      <Screen>
        <EmptyState
          icon={Building2}
          title={t('noProjectSelected')}
          hint={t('chooseProjectFirstHint')}
          action={<Button icon={Building2} label={t('chooseProject')} onPress={() => setOpen(true)} full />}
        />
      </Screen>
      <PickerSheet
        visible={open}
        title={t('chooseProject')}
        value={null}
        items={projects.map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · ') }))}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          setOpen(false);
          if (id) {
            setCurrentProject(id);
            onPick(id);
          }
        }}
      />
    </>
  );
}

function Inner({ projectId, workerId }: { projectId: string; workerId?: string }) {
  const t = useT();
  const project = useProject(projectId);
  const workers = useWorkers(true);
  const roster = useProjectWorkers(projectId);
  const form = useRecordForm('project_workers');

  const edit = roster.find((r) => r.worker_id === workerId) ?? null;
  const onProject = new Set(roster.map((r) => r.worker_id));
  const available = workers.filter((w) => !onProject.has(w.id));

  const [mode, setMode] = useState<Mode>('existing');
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [trade, setTrade] = useState('');
  const [phone, setPhone] = useState('');
  const [rate, setRate] = useState(edit?.rate_cents ? centsToInput(edit.rate_cents) : '');
  const [rateError, setRateError] = useState<string | null>(null);

  const editing = !!workerId;
  const effective: Mode = editing ? 'existing' : available.length ? mode : 'new';

  function pickWorker(id: string | null) {
    if (!id) return;
    if (onProject.has(id)) {
      toast(t('alreadyOnProject'));
      return;
    }
    setPicked(id);
    const w = workers.find((x) => x.id === id);
    if (w) setRate(w.daily_rate_cents ? centsToInput(w.daily_rate_cents) : '');
    setRateError(null);
    form.clearError('worker_id');
  }

  function onSave() {
    if (!rate.trim()) {
      setRateError(t('rateRequired'));
      return;
    }
    const cents = parseCents(rate);
    if (cents == null) {
      setRateError(t('errAmount'));
      return;
    }
    if (cents <= 0) {
      setRateError(t('rateRequired'));
      return;
    }
    form.submit(() => {
      if (editing) {
        setProjectWorkerRate(projectId, workerId as string, cents);
        return;
      }
      if (effective === 'existing') {
        if (!picked) throw new ValidationError('worker_id', 'errWorker');
        assignWorker({ project_id: projectId, worker_id: picked, rate_cents: cents });
        return;
      }
      // A stable id makes a repeated Save an update of the same worker and assignment, not a second one.
      tx(() => {
        const id = saveWorker({ id: form.id, name, trade, phone, daily_rate_cents: cents });
        assignWorker({ project_id: projectId, worker_id: id, rate_cents: cents });
      });
    });
  }

  function onRemove() {
    // Off the project, the balance leaves every project total: say so, and offer to settle it first.
    const owed = edit?.balance_cents ?? 0;
    const body = owed ? `${t(owed > 0 ? 'weOwe' : 'workerOwes')}: ${formatLKR(Math.abs(owed))}\n${t('removeFromProjectBody')}` : t('removeFromProjectBody');
    Alert.alert(t('removeFromProject'), body, [
      { text: t('cancel'), style: 'cancel' },
      ...(owed > 0
        ? [{ text: t('payNow'), onPress: () => router.push(`/wage/form?workerId=${workerId}&kind=payment&projectId=${projectId}&amount=${owed}`) }]
        : []),
      {
        text: t('removeFromProject'),
        style: 'destructive',
        onPress: () => {
          try {
            unassignWorker(projectId, workerId as string);
          } catch (e) {
            showError(e, 'worker.unassign', t, { projectId, workerId });
            return;
          }
          toast(t('deleted'));
          router.back();
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: t('addWorkerToProject') }} />
      <Screen footer={<Button label={t('save')} onPress={onSave} full />} gap={20}>
        {project ? (
          <Txt variant="caption" color="textMuted">
            {`${t('project')}: ${project.name}`}
          </Txt>
        ) : null}

        {editing ? (
          edit ? (
            <ListCard>
              <ListRow avatar={edit.name} title={edit.name} subtitle={edit.trade ?? undefined} />
            </ListCard>
          ) : null
        ) : (
          <Segmented
            value={effective}
            onChange={setMode}
            options={[
              { value: 'existing', label: t('existingWorker') },
              { value: 'new', label: t('newWorker') },
            ]}
          />
        )}

        {!editing && effective === 'existing' ? (
          <SelectField
            label={t('worker')}
            placeholder={t('worker')}
            items={workers.map((w) => ({
              id: w.id,
              title: w.name,
              subtitle: onProject.has(w.id) ? t('alreadyOnProject') : w.trade ?? undefined,
              icon: HardHat,
            }))}
            value={picked}
            onChange={pickWorker}
            error={form.err('worker_id')}
          />
        ) : null}

        {!editing && effective === 'new' ? (
          <>
            {available.length === 0 && workers.length > 0 ? (
              <Card tone="warningSoft">
                <Txt variant="caption" weight="semibold" color="warning">
                  {t('noneAvailable')}
                </Txt>
              </Card>
            ) : null}
            <Field
              label={t('name')}
              value={name}
              onChangeText={(s) => {
                setName(s);
                form.clearError('name');
              }}
              error={form.err('name')}
              autoFocus
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Field label={t('trade')} optional placeholder={t('tradeHint')} value={trade} onChangeText={setTrade} returnKeyType="next" />
            <Field label={t('phone')} optional value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </>
        ) : null}

        <AmountField
          label={t('rateOnThisProject')}
          value={rate}
          onChangeText={(s) => {
            setRate(s);
            setRateError(null);
            form.clearError('rate');
          }}
          error={rateError ?? form.err('rate')}
          hint={t('perProject')}
        />

        {editing ? <Button kind="danger" icon={Trash2} label={t('removeFromProject')} onPress={onRemove} full /> : null}
      </Screen>
    </>
  );
}
