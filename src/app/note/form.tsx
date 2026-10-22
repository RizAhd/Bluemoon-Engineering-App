import { Stack, useLocalSearchParams } from 'expo-router';
import { Building2, Cloud, CloudRain, Sun, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { ShareHeaderButton, useShareSheet } from '@/components/ShareSheet';
import { Button, IconButton } from '@/components/ui/Button';
import { Chips, DateField, Field, SelectField } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveNote } from '@/db/repo';
import type { SiteNote } from '@/db/types';
import { useCurrentProjectId, useProjects } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { today } from '@/lib/dates';
import { useColors } from '@/theme';

type Weather = 'sunny' | 'cloudy' | 'rain';

export default function NoteForm() {
  const params = useLocalSearchParams<{ id?: string; projectId?: string }>();
  const existing = useFirst<SiteNote>('SELECT * FROM site_notes WHERE id = ? AND deleted_at IS NULL', [params.id ?? '']);
  if (params.id && !existing) return null;
  return <Inner key={existing?.id ?? 'new'} existing={existing} projectParam={params.projectId} />;
}

function Inner({ existing, projectParam }: { existing: SiteNote | null; projectParam?: string }) {
  const t = useT();
  const c = useColors();
  const form = useRecordForm('site_notes', existing?.id);
  const allProjects = useProjects();
  const openProjects = allProjects.filter((p) => p.status !== 'completed');
  const current = useCurrentProjectId();
  const [projectId, setProjectId] = useState<string | null>(existing?.project_id ?? projectParam ?? current ?? (openProjects.length === 1 ? openProjects[0].id : null));
  // Completed projects are not offered for new notes, but the one this form opened on (a project hub, the
  // current project, or the note's own) stays in the list, so the field never shows "Choose project" over a saved id.
  const [openedOn] = useState(projectId);
  const projectItems = useMemo(
    () =>
      allProjects
        .filter((p) => p.status !== 'completed' || p.id === openedOn || p.id === projectId)
        .map((p) => ({ id: p.id, title: p.name, icon: Building2, subtitle: [p.location, t(`status_${p.status}`)].filter(Boolean).join(' · ') })),
    [allProjects, openedOn, projectId, t],
  );
  const [day, setDay] = useState(existing?.day ?? today());
  const [body, setBody] = useState(existing?.body ?? '');
  const [weather, setWeather] = useState<Weather | null>((existing?.weather as Weather) ?? null);

  // A saved note is shared as it is saved (its own message: project, day, weather, the whole text).
  const share = useShareSheet({ kind: 'note', id: existing?.id ?? null });

  const chipIcon = (Icon: typeof Sun) => <Icon size={18} color={c.textMuted} strokeWidth={2} />;

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newNote' : 'siteNotes'),
          headerRight: form.isNew
            ? undefined
            : () => (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <ShareHeaderButton onPress={share.open} />
                  <IconButton
                    icon={Trash2}
                    label={t('delete')}
                    tone="danger"
                    size={44}
                    pressedBg="headerDeep"
                    onPress={() => form.confirmDelete(() => deleteRecord('site_notes', form.id))}
                  />
                </View>
              ),
        }}
      />
      <Screen footer={<Button label={t('save')} onPress={() => form.submit(() => saveNote({ id: form.id, project_id: projectId, day, body, weather }))} full />}>
        <SelectField
          label={t('project')}
          items={projectItems}
          value={projectId}
          onChange={(id) => {
            setProjectId(id);
            form.clearError('project_id');
          }}
          error={form.err('project_id')}
          placeholder={t('chooseProject')}
        />
        <DateField label={t('date')} value={day} onChange={setDay} maxDay={today()} error={form.err('day')} />
        <Field
          label={t('whatHappened')}
          value={body}
          onChangeText={(s) => {
            setBody(s);
            if (form.err('body')) form.clearError('body');
          }}
          multiline
          error={form.err('body')}
          autoFocus={form.isNew}
        />
        <Chips
          label={t('weather')}
          value={weather}
          onChange={setWeather}
          options={[
            { value: 'sunny', label: t('weather_sunny'), icon: chipIcon(Sun) },
            { value: 'cloudy', label: t('weather_cloudy'), icon: chipIcon(Cloud) },
            { value: 'rain', label: t('weather_rain'), icon: chipIcon(CloudRain) },
          ]}
        />
        <PhotoStrip ownerTable="site_notes" ownerId={form.id} label={t('photoProof')} />
      </Screen>
      {form.isNew ? null : share.sheet}
    </>
  );
}
