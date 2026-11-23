import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Check, Hammer, Hash, Package, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Alert } from 'react-native';

import { PhotoStrip } from '@/components/PhotoStrip';
import { QtyStepper } from '@/components/QtyStepper';
import { Button, IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { Field, Segmented } from '@/components/ui/form';
import { Screen } from '@/components/ui/layout';
import { useFirst } from '@/db';
import { deleteRecord, saveTool, ValidationError } from '@/db/repo';
import type { Tool } from '@/db/types';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { formatQty, parseQty } from '@/lib/estimate';
import { showError } from '@/lib/errors';
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
  // A tool is borrowed and comes back; a material (cement, bolts) is issued and used up. Same list, same forms.
  const [kind, setKind] = useState<'tool' | 'material'>(existing?.is_material ? 'material' : 'tool');
  const [qty, setQty] = useState(existing ? formatQty(existing.quantity_milli) : '1');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([name, code, notes, kind, qty, unit]);

  const save = () =>
    form.submit(() => {
      // a count that is not a number is an error under the box, never quietly one piece or the old total
      const quantity = parseQty(qty);
      if (quantity == null) throw new ValidationError('qty', 'errQty');
      return saveTool({ id: form.id, name, code, notes, quantity_milli: quantity, is_material: kind === 'material', unit: kind === 'material' ? unit : existing?.unit ?? null });
    });

  // Not form.confirmDelete: that goes back one screen, which is this tool's own page, and it has nothing left to show.
  // Edit is only reachable from that page, so leave both and land where the user came from.
  const remove = () =>
    Alert.alert(t('confirmDelete'), t('confirmDeleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          try {
            deleteRecord('tools', form.id);
          } catch (e) {
            showError(e, 'delete', t, { table: 'tools', id: form.id });
            return;
          }
          toast(t('deleted'));
          router.dismiss(2);
        },
      },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: t(form.isNew ? 'newTool' : 'editTool'),
          headerRight: form.isNew
            ? undefined
            : () => (
                <IconButton icon={Trash2} label={t('delete')} size={44} tone="danger" shape="boxed" onPress={remove} />
              ),
        }}
      />
      <Screen footer={<Button icon={Check} label={t('save')} onPress={save} full />} gap={20}>
        {/* Blueprint order: what it is, a photo of it, its name, how many, its number, notes */}
        <Segmented
          options={[
            { value: 'tool', label: t('kindTool') },
            { value: 'material', label: t('kindMaterial') },
          ]}
          value={kind}
          onChange={setKind}
        />
        {/* PhotoStrip already wraps capture in try/catch + showError (camera-off → settings / gallery). */}
        <PhotoStrip ownerTable="tools" ownerId={form.id} label={t('photoProof')} />
        <Field
          label={t('toolName')}
          icon={kind === 'material' ? Package : Hammer}
          placeholder={t('phToolName')}
          value={name}
          onChangeText={(s) => {
            setName(s);
            form.clearError('name');
          }}
          error={form.err('name')}
          autoFocus={form.isNew}
          returnKeyType="next"
        />
        <QtyStepper
          label={t('howMany')}
          placeholder={t('phHowManyTotal')}
          value={qty}
          onChange={(s) => {
            setQty(s);
            form.clearError('qty');
          }}
          decimal={kind === 'material'}
          hint={t('howManyTotalHint')}
          error={form.err('qty')}
        />
        {kind === 'material' ? <Field label={t('unit')} optional placeholder={t('phUnitTool')} value={unit} onChangeText={setUnit} autoCorrect={false} /> : null}
        <Field label={t('toolCode')} optional icon={Hash} placeholder={t('phToolCode')} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
        <Field label={t('notes')} optional placeholder={t('phToolNotes')} value={notes} onChangeText={setNotes} multiline style={{ marginTop: space.xs }} />
      </Screen>
    </>
  );
}
