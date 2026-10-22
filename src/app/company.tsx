import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/form';
import { Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { saveCompanyProfile, useCompanyProfile } from '@/lib/company';

/**
 * Company and bank details: printed on every estimate. Kept per phone in the settings table, so there is
 * no record behind this form (the fixed id only keeps the shared form plumbing from treating it as a new record).
 */
export default function CompanyScreen() {
  const t = useT();
  const profile = useCompanyProfile();
  const form = useRecordForm('company_profile', 'profile');
  const [name, setName] = useState(profile.name);
  const [regNo, setRegNo] = useState(profile.reg_no);
  const [address, setAddress] = useState(profile.address);
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.email);
  const [bank, setBank] = useState(profile.bank_name);
  const [accountName, setAccountName] = useState(profile.account_name);
  const [accountNo, setAccountNo] = useState(profile.account_no);
  const [branch, setBranch] = useState(profile.branch);
  const [validDays, setValidDays] = useState(String(profile.default_valid_days));
  const [terms, setTerms] = useState(profile.default_terms);

  function onSave() {
    form.submit(() =>
      saveCompanyProfile({
        name,
        reg_no: regNo,
        address,
        phone,
        email,
        bank_name: bank,
        account_name: accountName,
        account_no: accountNo,
        branch,
        // anything that is not a whole number of days goes on as NaN, which the profile refuses with the days message
        default_valid_days: /^\d+$/.test(validDays.trim()) ? Number(validDays.trim()) : Number.NaN,
        default_terms: terms,
      }),
    );
  }

  return (
    <Screen footer={<Button label={t('save')} onPress={onSave} full />}>
      <Txt color="textMuted">{t('companyHint')}</Txt>

      <SectionTitle title={t('companyDetails')} first />
      <Field label={t('companyName')} value={name} onChangeText={setName} returnKeyType="next" />
      <Field label={t('registrationNo')} optional value={regNo} onChangeText={setRegNo} returnKeyType="next" />
      <Field label={t('address')} optional value={address} onChangeText={setAddress} multiline />
      <Field label={t('phone')} optional value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="next" />
      <Field label={t('email')} optional value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="next" />

      <SectionTitle title={t('bankDetails')} />
      <Field label={t('bankName')} optional value={bank} onChangeText={setBank} returnKeyType="next" />
      <Field label={t('accountName')} optional value={accountName} onChangeText={setAccountName} returnKeyType="next" />
      <Field label={t('accountNo')} optional value={accountNo} onChangeText={setAccountNo} keyboardType="numbers-and-punctuation" returnKeyType="next" />
      <Field label={t('branch')} optional value={branch} onChangeText={setBranch} returnKeyType="next" />

      <SectionTitle title={t('estimates')} />
      <Field
        label={t('defaultValidDays')}
        value={validDays}
        onChangeText={(s) => {
          setValidDays(s);
          form.clearError('default_valid_days');
        }}
        error={form.err('default_valid_days')}
        keyboardType="number-pad"
      />
      <Field label={t('defaultTerms')} optional hint={t('defaultTermsHint')} value={terms} onChangeText={setTerms} multiline />
    </Screen>
  );
}
