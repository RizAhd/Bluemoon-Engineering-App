import { Image } from 'expo-image';
import { Camera, FileText, ImagePlus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/ui/Button';
import { Txt } from '@/components/ui/Txt';
import type { Attachment } from '@/db/types';
import { useAttachments } from '@/hooks/data';
import { useT } from '@/i18n';
import { errorMessage, guard, reportError, showError } from '@/lib/errors';
import { addPhotos, fileFor, removeAttachment, type PhotoSource } from '@/lib/files';
import { hairline, photoChrome, radius, sizes, space, useColors } from '@/theme';

const THUMB = sizes.thumb;

/** Photos for one record: thumbnails, camera and gallery buttons, tap to view full size. */
export function PhotoStrip({
  ownerTable,
  ownerId,
  label,
  editable = true,
  context = 'photos',
}: {
  ownerTable: string;
  ownerId: string;
  label: string;
  editable?: boolean;
  /** Error-log context prefix, so a screen can tag photo failures as its own (default `photos`). */
  context?: string;
}) {
  const c = useColors();
  const t = useT();
  const items = useAttachments(ownerTable, ownerId);
  const [busy, setBusy] = useState<PhotoSource | null>(null);
  const [view, setView] = useState<Attachment | null>(null);

  async function add(source: PhotoSource) {
    if (busy) return;
    setBusy(source);
    try {
      await addPhotos(ownerTable, ownerId, source);
    } catch (e) {
      if (errorMessage(e) === 'camera-permission') {
        reportError(e, `${context}.camera-permission`, { ownerTable });
        Alert.alert(t('errorTitle'), t('cameraOff'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('fromGallery'), onPress: () => void add('gallery') },
          { text: t('settings'), onPress: () => Linking.openSettings().catch((err) => reportError(err, `${context}.open-settings`)) },
        ]);
      } else {
        showError(e, `${context}.${source}`, t, { ownerTable });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="caption" weight="semibold">
        {label}
      </Txt>
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {items.map((a, i) => (
            <Pressable
              key={a.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${label} ${i + 1}`}
              onPress={() => setView(a)}
              // the photo covers the pressed colour, so the ripple is drawn over it
              android_ripple={{ color: c.muted, foreground: true }}
              style={({ pressed }) => ({
                width: THUMB,
                height: THUMB,
                borderRadius: radius.md,
                overflow: 'hidden',
                borderWidth: hairline,
                borderColor: c.border,
                backgroundColor: pressed ? c.muted : c.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              })}>
              {a.kind === 'photo' ? (
                <Image source={{ uri: fileFor(a).uri }} recyclingKey={a.id} cachePolicy="memory-disk" style={{ width: THUMB, height: THUMB }} contentFit="cover" />
              ) : (
                <FileText size={36} color={c.textMuted} strokeWidth={2} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {editable ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button kind="secondary" compact icon={Camera} label={t('takePhoto')} loading={busy === 'camera'} disabled={busy === 'gallery'} onPress={() => void add('camera')} style={{ flex: 1 }} />
          <Button kind="secondary" compact icon={ImagePlus} label={t('fromGallery')} loading={busy === 'gallery'} disabled={busy === 'camera'} onPress={() => void add('gallery')} style={{ flex: 1 }} />
        </View>
      ) : null}
      <Viewer
        att={view}
        onClose={() => setView(null)}
        onDelete={
          editable && view
            ? () => {
                Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('delete'),
                    style: 'destructive',
                    onPress: () => {
                      void guard(`${context}.remove`, t, () => {
                        removeAttachment(view.id);
                        setView(null);
                      });
                    },
                  },
                ]);
              }
            : undefined
        }
      />
    </View>
  );
}

function Viewer({ att, onClose, onDelete }: { att: Attachment | null; onClose: () => void; onDelete?: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  if (!att) return null;
  const file = fileFor(att);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* Photo chrome is always black (photoChrome tokens), whatever the scheme. */}
      <View style={{ flex: 1, backgroundColor: photoChrome.bg }}>
        {att.kind === 'photo' ? (
          <Image source={{ uri: file.uri }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel={att.file_name ?? ''} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl }}>
            <FileText size={64} color={photoChrome.fg} strokeWidth={2} />
            <Button kind="secondary" label={t('open')} onPress={() => void guard('photos.preview', t, () => file.preview())} />
          </View>
        )}
        <View
          style={{
            position: 'absolute',
            top: insets.top + space.sm,
            left: space.sm,
            right: space.sm,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}>
          <View style={{ backgroundColor: photoChrome.control, borderRadius: 24 }}>
            <IconButton icon={X} label={t('close')} onPress={onClose} />
          </View>
          {onDelete ? (
            <View style={{ backgroundColor: photoChrome.control, borderRadius: 24 }}>
              <IconButton icon={Trash2} label={t('delete')} tone="danger" onPress={onDelete} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
