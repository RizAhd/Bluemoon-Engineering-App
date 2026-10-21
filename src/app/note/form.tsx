import { Stack, useLocalSearchParams } from 'expo-router';
import { Cloud, CloudRain, Sun, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { Button } from '@/components/ui/Button';
import { Chips, DateField, Field, SelectField } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveNote } from '@/db/repo';
import type { SiteNote } from '@/db/types';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { space, useColors } from '@/theme';

type Weather = 'sunny' | 'cloudy' | 'rain';

export default function NoteForm() {
  const params = useLocalSearchParams<{ id?: string; projectId?: string }>();
  const existing = useFirst<SiteNote>('SELECT * FROM site_notes WHERE id = ?', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner existing={existing} projectParam={params.projectId} />;
}

function Inner({ existing, projectParam }: { existing: SiteNote | null; projectParam?: string }) {
  const t = useT();
  const c = useColors();
  const form = useRecordForm('site_notes', existing?.id);
  const projects = useProjects(false);
  const current = useCurrentProjectId();
  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? projectParam ?? current ?? (projects.length === 1 ? projects[0].id : null));
  const [day, setDay] = useState(existing?.day ?? today());
  const [body, setBody] = useState(existing?.body ?? '');
  const [weather, setWeather] = useState<Weather | null>((existing?.weather as Weather) ?? null);

  return (
    <>
      <Stack.Screen options={{ title: t(form.isNew ? 'newNote' : 'siteNotes') }} />
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {!form.isNew ? (
              <Button kind="danger" icon={Trash2} label={t('delete')} onPress={() => form.confirmDelete(() => deleteRecord('site_notes', form.id))} />
            ) : null}
            <Button
              label={t('save')}
              onPress={() => form.submit(() => saveNote({ id: form.id, project_id: projectId, day, body, weather }))}
              style={{ flex: 1 }}
            />
          </View>
        }>
        <SelectField
          label={t('project')}
          items={projects.map((p) => ({ id: p.id, title: p.name }))}
          value={projectId}
          onChange={setProjectId}
          error={form.err('project_id')}
          placeholder={t('chooseProject')}
        />
        <DateField label={t('date')} value={day} onChange={setDay} />
        <Field label={t('whatHappened')} value={body} onChangeText={setBody} multiline error={form.err('body')} autoFocus={form.isNew} />
        <Chips
          label={t('weather')}
          value={weather}
          onChange={setWeather}
          options={[
            { value: 'sunny', label: t('weather_sunny'), icon: <Sun size={16} color={c.text} /> },
            { value: 'cloudy', label: t('weather_cloudy'), icon: <Cloud size={16} color={c.text} /> },
            { value: 'rain', label: t('weather_rain'), icon: <CloudRain size={16} color={c.text} /> },
          ]}
        />
        <PhotoStrip ownerTable="site_notes" ownerId={form.id} label={t('photoProof')} />
      </Screen>
    </>
  );
}
