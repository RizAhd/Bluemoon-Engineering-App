import { Stack, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useState } from 'react';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button, IconButton } from '@/components/ui/Button';
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
  const existing = useFirst<Tool>('SELECT * FROM tools WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} />;
}

function Inner({ existing }: { existing: Tool | null }) {
  const t = useT();
  const form = useRecordForm('tools', existing?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const save = () => form.submit(() => saveTool({ id: form.id, name, code, notes }));

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newTool' : 'editTool'),
          headerRight: form.isNew
            ? undefined
            : () => (
                <IconButton icon={Trash2} label={t('delete')} size={44} tone="danger" pressedBg="headerDeep" onPress={() => form.confirmDelete(() => deleteRecord('tools', form.id))} />
              ),
        }}
      />
      <Screen footer={<Button label={t('save')} onPress={save} full />} gap={20}>
        <Field
          label={t('toolName')}
          value={name}
          onChangeText={(s) => {
            setName(s);
            form.clearError('name');
          }}
          error={form.err('name')}
          autoFocus={form.isNew}
          returnKeyType="next"
        />
        <Field label={t('toolCode')} optional value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
        {/* PhotoStrip already wraps capture in try/catch + showError (camera-off → settings / gallery). */}
        <PhotoStrip ownerTable="tools" ownerId={form.id} label={t('photoProof')} />
        <Field label={t('notes')} optional value={notes} onChangeText={setNotes} multiline style={{ marginTop: space.xs }} />
      </Screen>
    </>
  );
}
