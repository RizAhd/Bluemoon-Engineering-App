import { Stack, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { AmountField, Chips, Field } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveProject } from '@/db/repo';
import type { Project, ProjectStatus } from '@/db/types';
import { setCurrentProject } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
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
        start_date: start || null,
        end_date: end || null,
        status,
        notes,
      });
      if (form.isNew) setCurrentProject(id);
    });
  }

  return (
    <>
      <Stack.Screen options={{ title: t(form.isNew ? 'newProject' : 'editProject') }} />
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {!form.isNew ? (
              <Button kind="danger" icon={Trash2} label={t('delete')} onPress={() => form.confirmDelete(() => deleteRecord('projects', form.id))} />
            ) : null}
            <Button label={t('save')} onPress={onSave} style={{ flex: 1 }} />
          </View>
        }>
        <Field label={t('projectName')} value={name} onChangeText={setName} error={form.err('name')} autoFocus={form.isNew} placeholder="e.g. Welimada school building" />
        <Field label={t('client')} optional value={client} onChangeText={setClient} />
        <Field label={t('location')} optional value={location} onChangeText={setLocation} />
        <AmountField label={t('contractValue')} optional value={contract} onChangeText={(s) => { setContract(s); setContractError(null); }} error={contractError} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field label={t('startDate')} optional value={start} onChangeText={setStart} placeholder="2026-10-21" keyboardType="numbers-and-punctuation" error={form.err('start_date')} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('endDate')} optional value={end} onChangeText={setEnd} placeholder="2027-03-31" keyboardType="numbers-and-punctuation" error={form.err('end_date')} />
          </View>
        </View>
        <Chips
          label={t('status')}
          value={status}
          onChange={setStatus}
          options={(['active', 'on_hold', 'completed'] as const).map((s) => ({ value: s, label: t(`status_${s}`) }))}
        />
        <Field label={t('notes')} optional value={notes} onChangeText={setNotes} multiline />
      </Screen>
    </>
  );
}
