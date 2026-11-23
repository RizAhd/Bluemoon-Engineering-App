import { BadgeCheck, Building2, Check, Home, Landmark, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/form';
import { Card, Screen, SectionTitle } from '@/components/ui/layout';
import { Txt } from '@/components/ui/Txt';
import { useRecordForm } from '@/hooks/form';
import { useT } from '@/i18n';
import { saveCompanyProfile, useCompanyProfile } from '@/lib/company';
import { radius, space, useColors } from '@/theme';

/**
 * Company and bank details: printed on every estimate. Kept per phone in the settings table, so there is
 * no record behind this form (the fixed id only keeps the shared form plumbing from treating it as a new record).
 */
export default function CompanyScreen() {
  const t = useT();
  const c = useColors();
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
  // Back with typed values not saved asks before throwing them away.
  form.useLeaveGuard([name, regNo, address, phone, email, bank, accountName, accountNo, branch, validDays, terms]);

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
    <Screen footer={<Button icon={Check} label={t('save')} onPress={onSave} full />}>
      {/* where these details live and where they are printed: a soft blue note, as in the design */}
      <Card tone="primarySoft" padding={space.lg}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <LockKeyhole size={20} color={c.primary} strokeWidth={1.9} />
          </View>
          <Txt color="textMuted" style={{ flex: 1 }}>
            {t('companyHint')}
          </Txt>
        </View>
      </Card>

      <SectionTitle title={t('companyDetails')} first />
      <Field label={t('companyName')} icon={Building2} placeholder={t('phCompanyName')} value={name} onChangeText={setName} returnKeyType="next" />
      <Field label={t('registrationNo')} optional icon={BadgeCheck} placeholder={t('phRegNo')} value={regNo} onChangeText={setRegNo} returnKeyType="next" />
      <Field label={t('address')} optional icon={Home} placeholder={t('phAddress')} value={address} onChangeText={setAddress} multiline />
      <Field label={t('phone')} optional icon={Phone} placeholder={t('phCompanyPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="next" />
      <Field label={t('email')} optional icon={Mail} placeholder={t('phEmail')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} returnKeyType="next" />

      <SectionTitle title={t('bankDetails')} />
      <Field label={t('bankName')} optional icon={Landmark} placeholder={t('phBank')} value={bank} onChangeText={setBank} returnKeyType="next" />
      <Field label={t('accountName')} optional icon={UserRound} placeholder={t('phAccountName')} value={accountName} onChangeText={setAccountName} returnKeyType="next" />
      {/* branch and account number side by side (short values) */}
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Field label={t('branch')} optional placeholder={t('phBranch')} value={branch} onChangeText={setBranch} returnKeyType="next" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Field label={t('accountNo')} optional placeholder={t('phAccountNo')} value={accountNo} onChangeText={setAccountNo} keyboardType="numbers-and-punctuation" returnKeyType="next" />
        </View>
      </View>

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
