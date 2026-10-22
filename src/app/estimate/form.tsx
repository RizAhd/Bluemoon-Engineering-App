import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';

import { PresetField } from '@/components/EstimateBits';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/feedback';
import { AmountField, DateField, Field } from '@/components/ui/form';
import { ListCard, ListRow, Screen } from '@/components/ui/layout';
import { saveEstimate, suggestEstimateNumber, type EstimateInput } from '@/db/estimates';
import type { Estimate } from '@/db/types';
import { useEstimate } from '@/hooks/data';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { useCompanyProfile } from '@/lib/company';
import { today } from '@/lib/dates';
import { formatPercent, parsePercent } from '@/lib/estimate';
import { centsToInput, parseCents } from '@/lib/money';

/** How long a quote usually stands, as one-tap choices. The text field takes any number of days from 1 to 365. */
const VALID_PRESETS = [15, 30, 60, 90];

export default function EstimateForm() {
  const params = useLocalSearchParams<{ id?: string; more?: string }>();
  const existing = useEstimate(params.id);
  // Wait for the row before building the form, so the inputs start with its values.
  if (params.id && !existing) return null;
  return <EstimateFormInner key={existing?.id ?? 'new'} existing={existing} openMore={params.more === '1'} />;
}

function EstimateFormInner({ existing, openMore }: { existing: Estimate | null; openMore: boolean }) {
  const t = useT();
  const company = useCompanyProfile();
  const form = useRecordForm('estimates', existing?.id);
  // An accepted estimate's discount and tax are locked (the lines too, but they are not on this form).
  const locked = existing?.status === 'accepted';

  const [client, setClient] = useState(existing?.client_name ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [day, setDay] = useState(existing?.issue_day ?? today());
  const [validDays, setValidDays] = useState(String(existing?.valid_days ?? company.default_valid_days));
  const [more, setMore] = useState(openMore);
  // A new estimate starts with the next number from this phone's counter; it can be changed under More details.
  const [number, setNumber] = useState(() => existing?.number ?? suggestEstimateNumber());
  const [phone, setPhone] = useState(existing?.client_phone ?? '');
  const [address, setAddress] = useState(existing?.client_address ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [discount, setDiscount] = useState(existing?.discount_cents ? centsToInput(existing.discount_cents) : '');
  const [tax, setTax] = useState(existing?.tax_bp ? formatPercent(existing.tax_bp) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  // New estimates start with the standard terms from Company and bank details.
  const [terms, setTerms] = useState(existing ? (existing.terms ?? '') : company.default_terms);

  // Creating leaves by replacing this screen with the new estimate, which the shared form plumbing cannot do: it always goes back.
  const creating = useRef(false);

  // A message inside the collapsed group must never stay hidden. Typing in the group counts as having it open,
  // so the fields do not fold away under the user's fingers when their message goes.
  const groupError = form.err('number') ?? form.err('discount') ?? form.err('tax');
  const moreOpen = more || !!groupError;
  const edited = (field: string) => {
    setMore(true);
    form.clearError(field);
  };

  function input(): EstimateInput {
    const days = /^\d+$/.test(validDays.trim()) ? Number(validDays.trim()) : null;
    return {
      id: form.id,
      number,
      client_name: client,
      title,
      issue_day: day,
      valid_days: days,
      client_phone: phone,
      client_address: address,
      location,
      notes,
      terms,
      // typed text that is not a number goes to the repo as null, which answers with the field's own message
      ...(locked ? {} : { discount_cents: discount.trim() ? parseCents(discount) : 0, tax_bp: tax.trim() ? parsePercent(tax) : 0 }),
    };
  }

  function onSave() {
    if (!form.isNew) {
      form.submit(() => {
        saveEstimate(input());
      });
      return;
    }
    if (creating.current) return;
    creating.current = true;
    let id: string;
    try {
      id = saveEstimate(input());
    } catch (e) {
      creating.current = false;
      // the shared plumbing shows the field message and the toast, and counts the failed try
      form.submit(() => {
        throw e;
      });
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast(t('savedOnPhone'));
    router.replace(`/estimate/${id}`);
  }

  return (
    <>
      <Stack.Screen options={{ title: t(form.isNew ? 'newEstimate' : 'editEstimate') }} />
      <Screen footer={<Button label={t('save')} onPress={onSave} full />}>
        <Field
          label={t('clientName')}
          value={client}
          onChangeText={(s) => {
            setClient(s);
            form.clearError('client_name');
          }}
          error={form.err('client_name')}
          autoFocus={form.isNew}
          returnKeyType="next"
        />
        <Field
          label={t('estimateTitle')}
          hint={t('estimateTitleHint')}
          value={title}
          onChangeText={(s) => {
            setTitle(s);
            form.clearError('title');
          }}
          error={form.err('title')}
          returnKeyType="next"
        />
        <DateField
          label={t('date')}
          value={day}
          onChange={(d) => {
            setDay(d);
            form.clearError('issue_day');
          }}
          error={form.err('issue_day')}
        />
        <PresetField
          label={t('validFor')}
          fieldLabel={t('numberOfDays')}
          presets={VALID_PRESETS.map((n) => ({ value: String(n), label: t('daysCount', { n }) }))}
          value={validDays}
          onChangeText={(s) => {
            setValidDays(s);
            form.clearError('valid_days');
          }}
          error={form.err('valid_days')}
          keyboardType="number-pad"
        />

        <ListCard>
          <ListRow title={t('moreDetails')} expanded={moreOpen} onPress={() => setMore(!moreOpen)} />
        </ListCard>
        {moreOpen ? (
          <>
            <Field
              label={t('estimateNumber')}
              value={number}
              onChangeText={(s) => {
                setNumber(s);
                edited('number');
              }}
              error={form.err('number')}
              autoCapitalize="characters"
              returnKeyType="next"
            />
            <Field label={t('phone')} optional value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="next" />
            <Field label={t('address')} optional value={address} onChangeText={setAddress} multiline />
            <Field label={t('location')} optional value={location} onChangeText={setLocation} returnKeyType="next" />
            <AmountField
              label={t('discount')}
              optional
              value={discount}
              onChangeText={(s) => {
                setDiscount(s);
                edited('discount');
              }}
              error={form.err('discount')}
              hint={locked ? t('fieldLockedAccepted') : undefined}
              disabled={locked}
            />
            <Field
              label={t('taxPercent')}
              optional
              value={tax}
              onChangeText={(s) => {
                setTax(s);
                edited('tax');
              }}
              error={form.err('tax')}
              hint={locked ? t('fieldLockedAccepted') : t('taxHint')}
              keyboardType="decimal-pad"
              disabled={locked}
            />
            <Field label={t('notes')} optional value={notes} onChangeText={setNotes} multiline />
            <Field label={t('terms')} optional value={terms} onChangeText={setTerms} multiline />
          </>
        ) : null}
      </Screen>
    </>
  );
}
