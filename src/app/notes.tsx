import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Building2, Cloud, CloudRain, LayoutGrid, NotebookPen, Plus, Sun } from 'lucide-react-native';
import { memo, useMemo } from 'react';
import { FlatList, Platform, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/feedback';
import { Card, Screen } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useQuery } from '@/db';
import type { Attachment, SiteNote } from '@/db/types';
import { useCurrentProjectId, useProject } from '@/hooks/data';
import { useListSearch } from '@/hooks/search';
import { useT, type TKey } from '@/i18n';
import { formatDay, today } from '@/lib/dates';
import { fileFor } from '@/lib/files';
import { hairline, listTuning, radius, space, useColors, useLayout } from '@/theme';

const WEATHER = { sunny: Sun, cloudy: Cloud, rain: CloudRain } as const;
type WeatherKey = keyof typeof WEATHER;
const THUMB = 64;

/** Site notes for the current project (or the project passed in), newest day first. */
export default function NotesScreen() {
  const t = useT();
  const c = useColors();
  const { gutter, column, short } = useLayout();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const current = useCurrentProjectId();
  const pid = params.projectId ?? current;
  const project = useProject(pid);
  const notes = useQuery<SiteNote & { project_name: string }>(
    `SELECT n.*, p.name AS project_name FROM site_notes n JOIN projects p ON p.id = n.project_id
     WHERE n.deleted_at IS NULL AND p.deleted_at IS NULL ${pid ? 'AND n.project_id = ?' : ''} ORDER BY n.day DESC, n.created_at DESC`,
    pid ? [pid] : [],
  );
  // Found by the text, the project and the weather as the card words it; the box is drawn with the notes only.
  const search = useListSearch(notes, (n) => [n.body, n.project_name, n.weather && n.weather in WEATHER ? t(`weather_${n.weather as WeatherKey}`) : null], { shown: notes.length > 0 });
  // Only the photos of the notes on screen (this project's, or every live project's), not every note photo on the phone.
  const photos = useQuery<Attachment>(
    `SELECT a.* FROM attachments a JOIN site_notes n ON n.id = a.owner_id AND n.deleted_at IS NULL JOIN projects p ON p.id = n.project_id AND p.deleted_at IS NULL
     WHERE a.owner_table = 'site_notes' AND a.deleted_at IS NULL AND a.kind = 'photo' ${pid ? 'AND n.project_id = ?' : ''} ORDER BY a.created_at`,
    pid ? [pid] : [],
  );
  const byNote = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    photos.forEach((p) => {
      const list = map.get(p.owner_id);
      if (list) list.push(p);
      else map.set(p.owner_id, [p]);
    });
    return map;
  }, [photos]);

  const openNew = () => router.push({ pathname: '/note/form', params: pid ? { projectId: pid } : {} });
  const ScopeIcon = project ? Building2 : LayoutGrid;
  const scopeName = project?.name ?? t('allProjects');
  const newButton = notes.length ? <Button icon={Plus} label={t('newNote')} onPress={openNew} full /> : undefined;

  return (
    // On a short window (landscape, split screen) the New note button scrolls with the notes instead of covering them.
    <Screen scroll={false} footer={short ? undefined : newButton}>
      <FlatList
        data={search.filtered}
        keyExtractor={noteKey}
        keyboardShouldPersistTaps="handled"
        {...listTuning}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={[column, { paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: space.xl, gap: space.md }]}
        ListFooterComponent={short && newButton ? <View style={{ paddingTop: space.sm }}>{newButton}</View> : undefined}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            {search.node}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 }} accessibilityRole="header">
              <ScopeIcon size={20} color={project ? c.primary : c.textMuted} strokeWidth={2} />
              <Txt weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                {scopeName}
              </Txt>
              <Txt variant="caption" color="textMuted" numeric>
                {t('notesCount', { n: search.filtered.length })}
              </Txt>
            </View>
          </View>
        }
        ListEmptyComponent={
          search.noResults ?? <EmptyState icon={NotebookPen} title={t('noNotes')} hint={t('noNotesHint')} action={<Button icon={Plus} label={t('newNote')} onPress={openNew} full />} />
        }
        renderItem={({ item }) => <NoteCard item={item} pics={byNote.get(item.id) ?? NO_PICS} showProject={!pid} />}
      />
    </Screen>
  );
}

type Note = SiteNote & { project_name: string };

const NO_PICS: Attachment[] = [];
const noteKey = (n: Note) => n.id;

/** One note: day (and project), weather, the text, up to four photo thumbnails (fixed size, cached). */
const NoteCard = memo(function NoteCard({ item, pics, showProject }: { item: Note; pics: Attachment[]; showProject: boolean }) {
  const t = useT();
  const c = useColors();
  const w = item.weather && item.weather in WEATHER ? (item.weather as WeatherKey) : null;
  const W = w ? WEATHER[w] : null;
  const dayText = item.day === today() ? t('today') : formatDay(item.day);
  return (
    <Card onPress={() => router.push(`/note/form?id=${item.id}`)} accessibilityLabel={`${dayText}${showProject ? ` · ${item.project_name}` : ''}: ${item.body}`} gap={space.sm}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="semibold" numeric>
            {dayText}
          </Txt>
          {showProject ? (
            <Txt variant="caption" color="textMuted" numberOfLines={1}>
              {item.project_name}
            </Txt>
          ) : null}
        </View>
        {W && w ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0 }}>
            <W size={18} color={c.textMuted} strokeWidth={2} />
            <Txt variant="caption" color="textMuted">
              {t(`weather_${w}` as TKey)}
            </Txt>
          </View>
        ) : null}
      </View>
      <Txt numberOfLines={6}>{item.body}</Txt>
      {pics.length ? (
        // Four 64 dp thumbnails and a "+n" tile need 352 dp: on a 320 phone they wrap instead of running off the card.
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {pics.slice(0, 4).map((p) => (
            <Image
              key={p.id}
              source={{ uri: fileFor(p).uri }}
              recyclingKey={p.id}
              cachePolicy="memory-disk"
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
});
