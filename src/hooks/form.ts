import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { toast } from '@/components/ui/feedback';
import { newId } from '@/db';
import { ValidationError } from '@/db/repo';
import { useT, type TKey } from '@/i18n';
import { discardOrphans } from '@/lib/files';

/**
 * Shared form plumbing: a stable id (so photos can attach before the first save),
 * field errors from ValidationError, success toast + haptic, and orphan-photo
 * cleanup if a new record is abandoned.
 */
export function useRecordForm(table: string, existingId?: string) {
  const t = useT();
  const navigation = useNavigation();
  const [id] = useState(() => existingId ?? newId());
  const [errors, setErrors] = useState<Record<string, TKey>>({});
  const saved = useRef(!!existingId);

  useEffect(() => {
    if (existingId) return;
    return navigation.addListener('beforeRemove', () => {
      if (!saved.current) discardOrphans(table, id);
    });
  }, [navigation, existingId, table, id]);

  function err(field: string): string | null {
    return errors[field] ? t(errors[field]) : null;
  }

  /** Runs the save; on success shows "Saved on phone" and goes back. */
  function submit(fn: () => void) {
    try {
      fn();
      saved.current = true;
      setErrors({});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(t('savedOnPhone'));
      router.back();
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors({ [e.field]: e.key as TKey });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } else {
        Alert.alert(t('somethingWrong'), e instanceof Error ? e.message : String(e));
      }
    }
  }

  function confirmDelete(fn: () => void) {
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          fn();
          toast(t('deleted'));
          router.back();
        },
      },
    ]);
  }

  return { id, isNew: !existingId, err, submit, confirmDelete, clearError: (f: string) => setErrors((e) => ({ ...e, [f]: undefined as never })) };
}
