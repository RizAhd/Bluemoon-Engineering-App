import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Cloud, CloudRain, NotebookPen, Plus, Sun } from 'lucide-react-native';
import { FlatList, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/feedback';
import { Txt } from '@/components/ui/Txt';
import { useQuery } from '@/db';
import type { Attachment, SiteNote } from '@/db/types';
import { useCurrentProjectId } from '@/hooks/data';
import { useT } from '@/i18n';
import { formatDay, today } from '@/lib/dates';
import { fileFor } from '@/lib/files';
import { radius, space, useColors } from '@/theme';

const WEATHER = { sunny: Sun, cloudy: Cloud, rain: CloudRain } as const;

export default function NotesScreen() {
  const t = useT();
  const c = useColors();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const current = useCurrentProjectId();
  const pid = params.projectId ?? current;
  const notes = useQuery<SiteNote & { project_name: string }>(
    `SELECT n.*, p.name AS project_name FROM site_notes n JOIN projects p ON p.id = n.project_id
     WHERE n.deleted_at IS NULL ${pid ? 'AND n.project_id = ?' : ''} ORDER BY n.day DESC, n.created_at DESC`,
    pid ? [pid] : [],
  );
  const photos = useQuery<Attachment>(
    "SELECT * FROM attachments WHERE owner_table = 'site_notes' AND deleted_at IS NULL AND kind = 'photo' ORDER BY created_at",
  );
  const byNote = new Map<string, Attachment[]>();
  photos.forEach((p) => byNote.set(p.owner_id, [...(byNote.get(p.owner_id) ?? []), p]));

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 120 }}
        ListHeaderComponent={
          notes.length ? (
            <Button icon={Plus} label={t('newNote')} onPress={() => router.push(`/note/form${pid ? `?projectId=${pid}` : ''}`)} />
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon={NotebookPen}
            title={t('noNotes')}
            hint={t('noNotesHint')}
            action={<Button icon={Plus} label={t('newNote')} onPress={() => router.push(`/note/form${pid ? `?projectId=${pid}` : ''}`)} full />}
          />
        }
        renderItem={({ item }) => {
          const W = item.weather ? WEATHER[item.weather as keyof typeof WEATHER] : null;
          const pics = byNote.get(item.id) ?? [];
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/note/form?id=${item.id}`)}
              style={({ pressed }) => ({
                backgroundColor: pressed ? c.muted : c.card,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: c.border,
                padding: space.lg,
                gap: space.sm,
              })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Txt weight="bold" style={{ flex: 1 }}>
                  {item.day === today() ? t('today') : formatDay(item.day)}
                  {pid ? '' : ` · ${item.project_name}`}
                </Txt>
                {W ? <W size={20} color={c.textMuted} /> : null}
              </View>
              <Txt numberOfLines={6}>{item.body}</Txt>
              {pics.length ? (
                <View style={{ flexDirection: 'row', gap: space.xs }}>
                  {pics.slice(0, 4).map((p) => (
                    <Image key={p.id} source={{ uri: fileFor(p).uri }} style={{ width: 64, height: 64, borderRadius: radius.sm }} contentFit="cover" />
                  ))}
                  {pics.length > 4 ? (
                    <View style={{ width: 64, height: 64, borderRadius: radius.sm, backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt weight="bold" numeric>{`+${pics.length - 4}`}</Txt>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
