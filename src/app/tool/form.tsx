import { Stack, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveTool } from '@/db/repo';
import type { Tool } from '@/db/types';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { space } from '@/theme';

export default function ToolForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const existing = useFirst<Tool>('SELECT * FROM tools WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} />;
}

function Inner({ existing }: { existing: Tool | null }) {
  const t = useT();
  const form = useRecordForm('tools', existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  return (
    <>
      <Stack.Screen options={{ title: t(form.isNew ? 'newTool' : 'editTool') }} />
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {!form.isNew ? (
              <Button kind="danger" icon={Trash2} label={t('delete')} onPress={() => form.confirmDelete(() => deleteRecord('tools', form.id))} />
            ) : null}
            <Button label={t('save')} onPress={() => form.submit(() => saveTool({ id: form.id, name, code, notes }))} style={{ flex: 1 }} />
          </View>
        }>
        <Field label={t('toolName')} value={name} onChangeText={setName} error={form.err('name')} autoFocus={form.isNew} placeholder="e.g. Concrete mixer" />
        <Field label={t('toolCode')} optional value={code} onChangeText={setCode} placeholder="BM-T-012" autoCapitalize="characters" />
        <PhotoStrip ownerTable="tools" ownerId={form.id} label={t('photoProof')} />
        <Field label={t('notes')} optional value={notes} onChangeText={setNotes} multiline />
      </Screen>
    </>
  );
}
