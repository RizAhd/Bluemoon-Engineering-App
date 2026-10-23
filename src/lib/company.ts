import { useMemo } from 'react';

import { all, setSetting, tx, useQuery } from '@/db';
import { ValidationError } from '@/db/repo';
import type { CompanyProfile } from '@/db/types';

/** What the profile starts as, before the owner edits it. */
export const COMPANY_DEFAULTS: CompanyProfile = {
  name: 'Bluemoon Engineering (Pvt) Ltd',
  reg_no: 'PV 00232701',
  address: 'Ambagaha Kumbura, Silmiyapura, Welimada, Badulla',
  phone: '077 337 0056',
  email: 'bluemoonengi@gmail.com',
  bank_name: '',
  account_name: 'Bluemoon Engineering (Pvt) Ltd',
  account_no: '',
  branch: '',
  // Standard terms of a Sri Lankan building quotation; copied into each new estimate and editable there.
  default_terms: [
    '1. This estimate is valid until the date shown above.',
    '2. Rates include materials, labour and transport unless stated otherwise.',
    '3. Any change to the work is charged at the rates above, or as agreed in writing before it is done.',
    '4. Not included: authority approvals, water and electricity connections, and any work not listed above.',
    '5. Work starts within 7 days of receiving the advance payment.',
    '6. Each stage payment is due within 7 days of the stage invoice.',
  ].join('\n'),
  default_valid_days: 30,
};

type TextField = Exclude<keyof CompanyProfile, 'default_valid_days'>;

const TEXT_FIELDS: readonly TextField[] = [
  'name',
  'reg_no',
  'address',
  'phone',
  'email',
  'bank_name',
  'account_name',
  'account_no',
  'branch',
  'default_terms',
];

/** The settings key of a profile field: company_name, company_bank_name, company_default_valid_days ... */
const keyOf = (field: keyof CompanyProfile) => `company_${field}`;

const ALL_KEYS = [...TEXT_FIELDS, 'default_valid_days' as const].map(keyOf);

function validDays(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 365;
}

/** Build the profile from the settings rows. A key that was never saved falls back to its default; a saved empty text stays empty. */
function fromRows(rows: readonly { key: string; value: string | null }[]): CompanyProfile {
  const saved = new Map(rows.map((r) => [r.key, r.value]));
  const out: CompanyProfile = { ...COMPANY_DEFAULTS };
  for (const f of TEXT_FIELDS) {
    const v = saved.get(keyOf(f));
    if (v != null) out[f] = v;
  }
  const days = Number(saved.get(keyOf('default_valid_days')));
  // a value that is not a whole number of days 1 to 365 (hand-edited, damaged) is ignored
  if (saved.get(keyOf('default_valid_days')) != null && validDays(days)) out.default_valid_days = days;
  return out;
}

const SELECT = `SELECT key, value FROM settings WHERE key IN (${ALL_KEYS.map(() => '?').join(', ')})`;

/** The company and bank details printed on estimates. Kept per phone in the settings table (keys company_*). */
export function getCompanyProfile(): CompanyProfile {
  return fromRows(all<{ key: string; value: string | null }>(SELECT, ALL_KEYS));
}

/**
 * Save the given fields (the others stay as they are). Text is trimmed; an emptied text field is
 * saved as empty, so it does not come back as the default. Default valid days must be 1 to 365.
 * Nothing is written when any field is refused.
 */
export function saveCompanyProfile(p: Partial<CompanyProfile>): void {
  const writes: [string, string][] = [];
  for (const f of TEXT_FIELDS) {
    const v = p[f];
    if (v !== undefined) writes.push([keyOf(f), String(v ?? '').trim()]);
  }
  if (p.default_valid_days !== undefined) {
    if (!validDays(p.default_valid_days)) throw new ValidationError('default_valid_days', 'errValidDays');
    writes.push([keyOf('default_valid_days'), String(p.default_valid_days)]);
  }
  tx(() => writes.forEach(([key, value]) => setSetting(key, value)));
}

/** Reactive: re-renders when the profile is saved. */
export function useCompanyProfile(): CompanyProfile {
  const rows = useQuery<{ key: string; value: string | null }>(SELECT, ALL_KEYS);
  return useMemo(() => fromRows(rows), [rows]);
}
