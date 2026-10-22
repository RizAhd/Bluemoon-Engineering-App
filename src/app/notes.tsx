import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Building2, Cloud, CloudRain, LayoutGrid, NotebookPen, Plus, Sun } from 'lucide-react-native';
import { FlatList, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/feedback';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useQuery } from '@/db';
import type { Attachment, SiteNote } from '@/db/types';
import { useCurrentProjectId, useProject } from '@/hooks/data';
import { useT, type TKey } from '@/i18n';
import { formatDay, today } from '@/lib/dates';
import { fileFor } from '@/lib/files';
import { hairline, radius, space, useColors, useLayout } from '@/theme';

const WEATHER = { sunny: Sun, cloudy: Cloud, rain: CloudRain } as const;
type WeatherKey = keyof typeof WEATHER;
const THUMB = 64;

/** Site notes for the current project (or the project passed in), newest day first. */
export default function NotesScreen() {
  const t = useT();
  const c = useColors();
  const { gutter, maxWidth } = useLayout();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const current = useCurrentProjectId();
  const pid = params.projectId ?? current;
  const project = useProject(pid);
  const notes = useQuery<SiteNote & { project_name: string }>(
    `SELECT n.*, p.name AS project_name FROM site_notes n JOIN projects p ON p.id = n.project_id
     WHERE n.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND n.project_id = ?' : ''} ORDER BY n.day DESC, n.created_at DESC`,
    pid ? [pid] : [],
  );
  const photos = useQuery<Attachment>(
    "SELECT * FROM attachments WHERE owner_table = 'site_notes' AND deleted_at IS NULL AND kind = 'photo' ORDER BY created_at",
  );
  const byNote = new Map<string, Attachment[]>();
  photos.forEach((p) => byNote.set(p.owner_id, [...(byNote.get(p.owner_id) ?? []), p]));

  const openNew = () => router.push({ pathname: '/note/form', params: pid ? { projectId: pid } : {} });
  const ScopeIcon = project ? Building2 : LayoutGrid;
  const scopeName = project?.name ?? t('allProjects');

  return (
    <Screen scroll={false} footer={notes.length ? <Button icon={Plus} label={t('newNote')} onPress={openNew} full /> : undefined}>
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: space.xl, gap: space.md, maxWidth, width: '100%', alignSelf: 'center' }}
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 }} accessibilityRole="header">
            <ScopeIcon size={20} color={project ? c.primary : c.textMuted} strokeWidth={2} />
            <Txt weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
              {scopeName}
            </Txt>
            <Txt variant="caption" color="textMuted" numeric>
              {t('notesCount', { n: notes.length })}
            </Txt>
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon={NotebookPen} title={t('noNotes')} hint={t('noNotesHint')} action={<Button icon={Plus} label={t('newNote')} onPress={openNew} full />} />
        }
        renderItem={({ item }) => {
          const w = item.weather && item.weather in WEATHER ? (item.weather as WeatherKey) : null;
          const W = w ? WEATHER[w] : null;
          const pics = byNote.get(item.id) ?? [];
          const dayText = item.day === today() ? t('today') : formatDay(item.day);
          return (
            <Card onPress={() => router.push(`/note/form?id=${item.id}`)} accessibilityLabel={`${dayText}${pid ? '' : ` · ${item.project_name}`}: ${item.body}`} gap={space.sm}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Txt weight="semibold" numeric>
                    {dayText}
                  </Txt>
                  {pid ? null : (
                    <Txt variant="caption" color="textMuted" numberOfLines={1}>
                      {item.project_name}
                    </Txt>
                  )}
                </View>
                {W && w ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    <W size={18} color={c.textMuted} strokeWidth={2} />
                    <Txt variant="caption" color="textMuted">
                      {t(`weather_${w}` as TKey)}
                    </Txt>
                  </View>
                ) : null}
              </View>
              <Txt numberOfLines={6}>{item.body}</Txt>
              {pics.length ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  {pics.slice(0, 4).map((p) => (
                    <Image
                      key={p.id}
                      source={{ uri: fileFor(p).uri }}
                      style={{ width: THUMB, height: THUMB, borderRadius: radius.md, borderWidth: hairline, borderColor: c.border, backgroundColor: c.surface2 }}
                      contentFit="cover"
                      accessibilityLabel={t('photoProof')}
                    />
                  ))}
                  {pics.length > 4 ? (
                    <View style={{ width: THUMB, height: THUMB, borderRadius: radius.md, borderWidth: hairline, borderColor: c.border, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt weight="semibold" color="textMuted" numeric>{`+${pics.length - 4}`}</Txt>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
