import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { toast } from '@/components/ui/feedback';
import { newId } from '@/db';
import { ValidationError } from '@/db/repo';
import { useT, type TKey } from '@/i18n';
import { reportError, showError } from '@/lib/errors';
import { discardOrphans } from '@/lib/files';

/**
 * Shared form plumbing: a stable id (so photos can attach before the first save),
 * field errors from ValidationError, success toast + haptic, and orphan-photo
 * cleanup if a new record is abandoned.
 */
export function useRecordForm(table: string, existingId?: string) {
  const t = useT();
  const [id] = useState(() => existingId ?? newId());
  const [errors, setErrors] = useState<Record<string, TKey>>({});
  const saved = useRef(!!existingId);
  // True from the moment Save starts until it fails: a second tap while saving (or after saving, while the screen closes) does nothing.
  const busy = useRef(false);

  // Leaving a new form without saving hides any photos already taken for it.
  useEffect(() => {
    if (existingId) return;
    return () => {
      if (!saved.current) {
        try {
          discardOrphans(table, id);
        } catch (e) {
          reportError(e, 'discardOrphans', { table, id });
        }
      }
    };
  }, [existingId, table, id]);

  function err(field: string): string | null {
    return errors[field] ? t(errors[field]) : null;
  }

  function onSaved() {
    saved.current = true;
    setErrors({});
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast(t('savedOnPhone'));
    router.back();
  }

  function onFailed(e: unknown) {
    busy.current = false;
    if (e instanceof ValidationError) {
      setErrors({ [e.field]: e.key as TKey });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      // The message under the field can be scrolled out of sight, so say it where it cannot be missed too.
      toast(t(e.key as TKey), { tone: 'danger' });
    } else {
      showError(e, 'save', t, { table, id });
    }
  }

  /** Runs the save; on success shows "Saved on phone" and goes back. A second call while it runs, or after it worked, is ignored. */
  function submit(fn: () => void) {
    if (busy.current) return;
    busy.current = true;
    try {
      fn();
      onSaved();
    } catch (e) {
      onFailed(e);
    }
  }

  /** Same flow for multi-step saves (e.g. copy a photo, then write the row). Never rejects. */
  async function submitAsync(fn: () => Promise<void>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
      onSaved();
    } catch (e) {
      onFailed(e);
    }
  }

  /** Asks first, then runs `fn` and leaves the screen: `pop` is how many screens to close (a form opened from a detail screen that is gone too needs 2). */
  function confirmDelete(fn: () => void, pop = 1) {
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          try {
            fn();
          } catch (e) {
            showError(e, 'delete', t, { table, id });
            return;
          }
          toast(t('deleted'));
          if (pop > 1) router.dismiss(pop);
          else router.back();
        },
      },
    ]);
  }

  return {
    id,
    isNew: !existingId,
    err,
    submit,
    submitAsync,
    confirmDelete,
    clearError: (f: string) => setErrors((e) => ({ ...e, [f]: undefined as never })),
    /** Lets the screen go without the unsaved-changes question (a create that replaces the screen with the new record). */
    allowLeave: () => {
      saved.current = true;
    },
    /** Asks before Back (button, gesture, header arrow) throws away typed values. Pass every value the user can change. */
    useLeaveGuard: (values: unknown[]) => useLeaveGuard(values, saved),
  };
}

/**
 * "Discard changes?" before a form is left with typed values not saved. `values` are compared with what the
 * form started with; a saved or untouched form leaves without a question. Works for the Android back button,
 * the back gesture and the header arrow alike (they all remove the screen).
 */
export function useLeaveGuard(values: unknown[], saved?: { current: boolean }) {
  const t = useT();
  // typed loosely: the root navigator's event map does not list 'beforeRemove', every stack screen has it
  const navigation = useNavigation() as unknown as {
    addListener?: (event: 'beforeRemove', cb: (e: { preventDefault: () => void; data: { action: unknown } }) => void) => () => void;
    dispatch: (action: unknown) => void;
  };
  const now = JSON.stringify(values);
  const [start] = useState(now);
  const isDirty = now !== start;
  const dirty = useRef(false);
  useEffect(() => {
    dirty.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    if (!navigation?.addListener) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (!dirty.current || saved?.current) return;
      e.preventDefault();
      Alert.alert(t('discardTitle'), t('discardBody'), [
        { text: t('keepEditing'), style: 'cancel' },
        {
          text: t('discard'),
          style: 'destructive',
          onPress: () => {
            dirty.current = false;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
  }, [navigation, saved, t]);
}
