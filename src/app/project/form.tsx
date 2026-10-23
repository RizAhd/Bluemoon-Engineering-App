import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Building2, MapPin, Trash2, UserRound } from 'lucide-react-native';

import { Button, HeaderButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { AmountField, DatePickerField, Field, Segmented } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveProject } from '@/db/repo';
import type { Project, ProjectStatus } from '@/db/types';
import { setCurrentProject } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { showError } from '@/lib/errors';
import { centsToInput, parseCents } from '@/lib/money';
import { space } from '@/theme';

export default function ProjectForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const existing = useFirst<Project>('SELECT * FROM projects WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} />;
}

function Inner({ existing }: { existing: Project | null }) {
  const t = useT();
  const form = useRecordForm('projects', existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [client, setClient] = useState(existing?.client ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [contract, setContract] = useState(existing?.contract_cents ? centsToInput(existing.contract_cents) : '');
  const [start, setStart] = useState(existing?.start_date ?? '');
  const [end, setEnd] = useState(existing?.end_date ?? '');
  const [status, setStatus] = useState<ProjectStatus>(existing?.status ?? 'active');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [contractError, setContractError] = useState<string | null>(null);
  form.useLeaveGuard([name, client, location, contract, start, end, status, notes]);

  function onSave() {
    const cents = contract.trim() ? parseCents(contract) : null;
    if (contract.trim() && cents == null) {
      setContractError(t('errAmount'));
      return;
    }
    form.submit(() => {
      const id = saveProject({
        id: form.id,
        name,
        client,
        location,
        contract_cents: cents,
        start_date: start.trim() || null,
        end_date: end.trim() || null,
        status,
        notes,
      });
      if (form.isNew) setCurrentProject(id);
    });
  }

  // Same confirm as form.confirmDelete, but it leaves two screens: this form is only opened from the
  // project's hub, and once the project is deleted the hub has nothing left to show.
  function onDelete() {
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          try {
            deleteRecord('projects', form.id);
          } catch (e) {
            showError(e, 'delete', t, { table: 'projects', id: form.id });
            return;
          }
          toast(t('deleted'));
          router.dismiss(2);
        },
      },
    ]);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newProject' : 'editProject'),
          headerRight: form.isNew ? undefined : () => <HeaderButton icon={Trash2} tone="danger" label={t('delete')} onPress={onDelete} />,
        }}
      />
      <Screen footer={<Button label={t('save')} onPress={onSave} full />}>
        <Field
          label={t('projectName')}
          icon={Building2}
          placeholder={t('phProjectName')}
          autoCapitalize="words"
          value={name}
          onChangeText={(s) => {
            setName(s);
            form.clearError('name');
          }}
          error={form.err('name')}
          autoFocus={form.isNew}
          returnKeyType="next"
        />
        <Field label={t('client')} optional autoCorrect={false} autoCapitalize="words" icon={UserRound} placeholder={t('phClientName')} value={client} onChangeText={setClient} returnKeyType="next" />
        <Field label={t('location')} optional icon={MapPin} placeholder={t('phLocation')} value={location} onChangeText={setLocation} returnKeyType="next" />
        <AmountField
          label={t('contractValue')}
          optional
          value={contract}
          onChangeText={(s) => {
            setContract(s);
            setContractError(null);
          }}
          error={contractError}
        />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <DatePickerField
              label={t('startDate')}
              optional
              value={start}
              onChange={(d) => {
                setStart(d);
                form.clearError('start_date');
              }}
              maxDay={end || undefined}
              error={form.err('start_date')}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <DatePickerField
              label={t('endDate')}
              optional
              value={end}
              onChange={(d) => {
                setEnd(d);
                form.clearError('end_date');
              }}
              minDay={start || undefined}
              error={form.err('end_date')}
            />
          </View>
        </View>
        <Segmented
          label={t('status')}
          value={status}
          onChange={setStatus}
          options={(['active', 'on_hold', 'completed'] as const).map((s) => ({ value: s, label: t(`status_${s}`) }))}
        />
        <Field label={t('notes')} optional placeholder={t('phProjectNotes')} value={notes} onChangeText={setNotes} multiline />
      </Screen>
    </>
  );
}
