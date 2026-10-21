import { Image } from 'expo-image';
import { Camera, FileText, ImagePlus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/ui/Button';
import { Txt } from '@/components/ui/Txt';
import type { Attachment } from '@/db/types';
import { useAttachments } from '@/hooks/data';
import { useT } from '@/i18n';
import { addPhotos, fileFor, removeAttachment, type PhotoSource } from '@/lib/files';
import { radius, space, useColors } from '@/theme';

const THUMB = 96;

/** Photos for one record: thumbnails, camera and gallery buttons, tap to view full size. */
export function PhotoStrip({
  ownerTable,
  ownerId,
  label,
  editable = true,
}: {
  ownerTable: string;
  ownerId: string;
  label: string;
  editable?: boolean;
}) {
  const c = useColors();
  const t = useT();
  const items = useAttachments(ownerTable, ownerId);
  const [busy, setBusy] = useState<PhotoSource | null>(null);
  const [view, setView] = useState<Attachment | null>(null);

  async function add(source: PhotoSource) {
    setBusy(source);
    try {
      await addPhotos(ownerTable, ownerId, source);
    } catch (e) {
      Alert.alert(t('somethingWrong'), e instanceof Error && e.message === 'camera-permission' ? t('cameraOff') : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <Txt weight="semibold">{label}</Txt>
      {items.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {items.map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={label}
              onPress={() => setView(a)}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: radius.md,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.muted,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {a.kind === 'photo' ? (
                <Image source={{ uri: fileFor(a).uri }} style={{ width: THUMB, height: THUMB }} contentFit="cover" />
              ) : (
                <FileText size={36} color={c.textMuted} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {editable ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button kind="secondary" icon={Camera} label={t('takePhoto')} loading={busy === 'camera'} onPress={() => add('camera')} style={{ flex: 1 }} />
          <Button kind="secondary" icon={ImagePlus} label={t('fromGallery')} loading={busy === 'gallery'} onPress={() => add('gallery')} style={{ flex: 1 }} />
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
                      removeAttachment(view.id);
                      setView(null);
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
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {att.kind === 'photo' ? (
          <Image source={{ uri: file.uri }} style={{ flex: 1 }} contentFit="contain" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl }}>
            <FileText size={64} color="#fff" />
            <Button kind="secondary" label={t('open')} onPress={() => file.preview().catch(() => {})} />
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
          <View style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 24 }}>
            <IconButton icon={X} label={t('close')} onPress={onClose} />
          </View>
          {onDelete ? (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 24 }}>
              <IconButton icon={Trash2} label={t('delete')} onPress={onDelete} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
