/**
 * The company and bank details printed on estimates: kept per phone in the settings table (keys
 * company_*), defaults for what was never saved, trimmed text, and 1 to 365 default valid days.
 */
import { all, closeDb, getDb, getSetting, setSetting } from '@/db';
import { ValidationError } from '@/db/repo';
import type { CompanyProfile } from '@/db/types';
import { collectAll } from '@/lib/bundle';
import { COMPANY_DEFAULTS, getCompanyProfile, saveCompanyProfile } from '@/lib/company';
import { resetDb } from '@/test-utils';

jest.setTimeout(60_000);

beforeEach(() => resetDb());

const companyKeys = () => all<{ key: string }>("SELECT key FROM settings WHERE key LIKE 'company\\_%' ESCAPE '\\' ORDER BY key").map((r) => r.key);

describe('getCompanyProfile', () => {
  it('is the defaults when nothing was ever saved, and writes nothing', () => {
    expect(getCompanyProfile()).toEqual(COMPANY_DEFAULTS);
    expect(companyKeys()).toEqual([]);
  });

  it('hands out a fresh object each time, so changing it cannot change the defaults', () => {
    const p = getCompanyProfile();
    p.name = 'Changed';
    p.default_valid_days = 1;
    expect(getCompanyProfile()).toEqual(COMPANY_DEFAULTS);
    expect(COMPANY_DEFAULTS.name).toBe('Bluemoon Engineering (Pvt) Ltd');
  });

  it('has the bank details empty by default, to be filled in once', () => {
    expect(getCompanyProfile()).toMatchObject({ bank_name: '', account_no: '', branch: '', default_valid_days: 30 });
  });

  it('starts with standard quotation terms, so a new estimate is never sent without any', () => {
    const terms = getCompanyProfile().default_terms;
    for (const part of ['valid until', 'materials, labour and transport', 'agreed in writing', 'Not included', 'within 7 days of receiving the advance', 'within 7 days of the stage invoice']) {
      expect(terms).toContain(part);
    }
  });
});

describe('saveCompanyProfile', () => {
  it('saves into settings keys company_<field> and reads them back', () => {
    const full: CompanyProfile = {
      name: 'Bluemoon Engineering',
      reg_no: 'PV 1',
      address: '1 Main St',
      phone: '0771111111',
      email: 'a@b.lk',
      bank_name: 'Bank of Ceylon',
      account_name: 'Bluemoon Engineering (Pvt) Ltd',
      account_no: '0012345678',
      branch: 'Welimada',
      default_terms: '50 % advance.',
      default_valid_days: 21,
    };
    saveCompanyProfile(full);
    expect(getCompanyProfile()).toEqual(full);
    expect(companyKeys()).toEqual([
      'company_account_name',
      'company_account_no',
      'company_address',
      'company_bank_name',
      'company_branch',
      'company_default_terms',
      'company_default_valid_days',
      'company_email',
      'company_name',
      'company_phone',
      'company_reg_no',
    ]);
    expect(getSetting('company_bank_name')).toBe('Bank of Ceylon');
    expect(getSetting('company_default_valid_days')).toBe('21');
  });

  it('changes only the fields it is given', () => {
    saveCompanyProfile({ bank_name: 'Sampath', branch: 'Badulla' });
    saveCompanyProfile({ account_no: '99' });
    expect(getCompanyProfile()).toEqual({ ...COMPANY_DEFAULTS, bank_name: 'Sampath', branch: 'Badulla', account_no: '99' });
    expect(companyKeys()).toEqual(['company_account_no', 'company_bank_name', 'company_branch']);
  });

  it('trims the text, including line breaks around the terms', () => {
    saveCompanyProfile({ name: '  Bluemoon  ', default_terms: '\n  Pay in 7 days.\nNo refunds.  \n' });
    expect(getCompanyProfile()).toMatchObject({ name: 'Bluemoon', default_terms: 'Pay in 7 days.\nNo refunds.' });
  });

  it('an emptied text field stays empty: it does not come back as the default', () => {
    saveCompanyProfile({ address: '   ', phone: '' });
    expect(getCompanyProfile()).toMatchObject({ address: '', phone: '' });
    expect(getCompanyProfile().email).toBe(COMPANY_DEFAULTS.email);
  });

  it('keeps the Sinhala and Tamil text exactly', () => {
    saveCompanyProfile({ address: 'අම්බගහ කුඹුර, වැලිමඩ', branch: 'பதுளை' });
    expect(getCompanyProfile()).toMatchObject({ address: 'අම්බගහ කුඹුර, වැලිමඩ', branch: 'பதுளை' });
  });

  it.each([1, 30, 365])('accepts %d default valid days', (days) => {
    saveCompanyProfile({ default_valid_days: days });
    expect(getCompanyProfile().default_valid_days).toBe(days);
  });

  it.each([0, -5, 366, 1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p default valid days and writes nothing, not even the other fields of the same call', (days) => {
    saveCompanyProfile({ default_valid_days: 20, bank_name: 'Before' });
    let caught: unknown;
    try {
      saveCompanyProfile({ default_valid_days: days, bank_name: 'After', name: 'After' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught).toMatchObject({ field: 'default_valid_days', key: 'errValidDays' });
    expect(getCompanyProfile()).toMatchObject({ default_valid_days: 20, bank_name: 'Before', name: COMPANY_DEFAULTS.name });
  });

  it('survives closing and reopening the database (it is stored, not remembered)', () => {
    saveCompanyProfile({ account_no: '555', default_valid_days: 60 });
    closeDb();
    getDb();
    expect(getCompanyProfile()).toMatchObject({ account_no: '555', default_valid_days: 60 });
  });

  it('is per phone: it is not part of the data a backup or a PDF carries', () => {
    saveCompanyProfile({ account_no: '555' });
    expect(JSON.stringify(collectAll())).not.toContain('555');
  });
});

describe('a damaged setting', () => {
  it.each(['abc', '0', '366', '', '2.5', '-3'])('default valid days saved as %j reads as the default', (bad) => {
    setSetting('company_default_valid_days', bad);
    expect(getCompanyProfile().default_valid_days).toBe(30);
  });

  it('a null value counts as never saved', () => {
    setSetting('company_name', null);
    expect(getCompanyProfile().name).toBe(COMPANY_DEFAULTS.name);
  });
});
