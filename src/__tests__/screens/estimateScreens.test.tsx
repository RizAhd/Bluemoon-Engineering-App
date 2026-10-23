/**
 * Render smoke tests for every estimate (quotation) screen: the list, the form, the hub, the line and
 * stage forms, and Company and bank details. Each in English, Sinhala and Tamil, light and dark, on an
 * empty phone and on the demo data (which holds a draft and an accepted estimate). The flows are in
 * estimateFlows.test.tsx.
 */
import '@/test-utils/rnMocks'; // must be first: the jest.mock() calls have to run before any screen is loaded

import { saveCompanyProfile } from '@/lib/company';

import CompanyScreen from '@/app/company';
import EstimateForm from '@/app/estimate/form';
import EstimateHub from '@/app/estimate/[id]';
import EstimatesScreen from '@/app/estimate/index';
import EstimateItemScreen from '@/app/estimate/item';
import EstimatePaymentScreen from '@/app/estimate/payment';
import { setSetting } from '@/db';
import { loadEstimate, saveEstimate, saveEstimateItem, saveEstimatePayment } from '@/db/estimates';
import { formatDay, today } from '@/lib/dates';
import { allocatePayments, formatPercent, formatQty, lineAmount, validUntil } from '@/lib/estimate';
import { formatLKR } from '@/lib/money';
import { rows } from '@/test-utils/screenData';
import { screen, setRouteParams, smokeScreen, visibleText } from '@/test-utils/screenKit';

const DRAFT = 'Boundary wall, Welimada';
const ACCEPTED = 'Retaining wall, Bandarawela';

const idOf = (title: string) => {
  const found = rows<{ id: string }>('SELECT id FROM estimates WHERE title = ? AND deleted_at IS NULL', [title])[0];
  if (!found) throw new Error(`No estimate titled ${title}`);
  return found.id;
};
const loaded = (title: string) => {
  const l = loadEstimate(idOf(title));
  if (!l) throw new Error(`Estimate ${title} is not loadable`);
  return l;
};

// ---------------------------------------------------------------- the list

smokeScreen('estimate/index (demo data)', () => <EstimatesScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'the draft and the accepted estimate, newest first, with totals and statuses',
      expect: (tr) => {
        const draft = loaded(DRAFT);
        const accepted = loaded(ACCEPTED);
        return [
          draft.estimate.client_name,
          DRAFT,
          formatLKR(draft.total.total_cents),
          tr('estStatus_draft'),
          draft.estimate.number,
          formatDay(draft.estimate.issue_day),
          accepted.estimate.client_name,
          ACCEPTED,
          formatLKR(accepted.total.total_cents),
          tr('estStatus_accepted'),
          tr('newEstimate'),
        ];
      },
      // two estimates: neither the status chips (from 6) nor the search box (from 9) are drawn
      absent: (tr) => [tr('search'), tr('noEstimates')],
      check: () => {
        const text = visibleText();
        expect(text.indexOf('Mr. K. Wijesekara')).toBeLessThan(text.indexOf('Nuwara View Hotel'));
      },
    },
  ],
});

smokeScreen('estimate/index (empty phone)', () => <EstimatesScreen />, {
  db: 'empty',
  variants: [
    {
      name: 'the empty state names the first action',
      expect: (tr) => [tr('noEstimates'), tr('noEstimatesHint'), tr('newEstimate')],
    },
  ],
});

// ---------------------------------------------------------------- the form

smokeScreen('estimate/form', () => <EstimateForm />, {
  db: 'demo',
  variants: [
    {
      name: 'new estimate: client, job and site, date and validity in sections, with examples, and a collapsed More details',
      expect: (tr) => [
        tr('newEstimate'),
        tr('secClient'),
        tr('secJob'),
        tr('secDates'),
        tr('phClientName'),
        tr('phPhone'),
        tr('phoneWhatsAppHint'),
        tr('phEstimateTitle'),
        tr('phLocation'),
        tr('phone'),
        tr('address'),
        tr('location'),
        tr('moreDetailsSummary'),
        tr('clientName'),
        tr('estimateTitle'),
        tr('estimateTitleHint'),
        tr('date'),
        tr('today'),
        tr('validFor'),
        tr('daysCount', { n: 15 }),
        tr('daysCount', { n: 30 }),
        tr('daysCount', { n: 60 }),
        tr('daysCount', { n: 90 }),
        tr('numberOfDays'),
        '30',
        tr('validUntilOn', { date: formatDay(validUntil(today(), 30)) }),
        tr('moreDetails'),
        tr('save'),
      ],
      absent: (tr) => [tr('editEstimate'), tr('estimateNumber'), tr('discount'), tr('taxPercent'), tr('delete')],
    },
    {
      name: 'More details opened from the hub: number, phone, address, location, discount, tax, notes and terms',
      prepare: () => setRouteParams({ id: idOf(DRAFT), more: '1' }),
      expect: (tr) => {
        const e = loaded(DRAFT).estimate;
        return [
          tr('editEstimate'),
          e.client_name,
          DRAFT,
          e.number,
          e.client_phone ?? '',
          e.client_address ?? '',
          'Welimada',
          tr('estimateNumber'),
          tr('phone'),
          tr('address'),
          tr('location'),
          tr('discount'),
          /20,?000/, // Rs 20,000 in the discount field (shown with or without the thousands comma)
          tr('taxPercent'),
          tr('notes'),
          e.notes ?? '',
          tr('terms'),
        ];
      },
    },
    {
      name: 'an accepted estimate: discount and tax are locked and say why',
      prepare: () => setRouteParams({ id: idOf(ACCEPTED), more: '1' }),
      expect: (tr) => [tr('editEstimate'), ACCEPTED, '18', tr('fieldLockedAccepted')],
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone' }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- the hub

smokeScreen('estimate/[id] (hub, demo data)', () => <EstimateHub />, {
  db: 'demo',
  variants: [
    {
      name: 'a draft: summary, total card, items, stages with amounts, bank prompt, terms and every action',
      prepare: () => setRouteParams({ id: idOf(DRAFT) }),
      expect: (tr) => {
        const { estimate, items, payments, total } = loaded(DRAFT);
        const amounts = allocatePayments(total.total_cents, payments.map((p) => p.percent_bp));
        return [
          estimate.number,
          tr('estStatus_draft'),
          estimate.client_name,
          DRAFT,
          tr('date'),
          formatDay(estimate.issue_day),
          tr('validUntil'),
          formatDay(validUntil(estimate.issue_day, estimate.valid_days)),
          tr('subtotal'),
          formatLKR(total.subtotal_cents),
          tr('discount'),
          `−${formatLKR(total.discount_cents)}`,
          tr('total'),
          formatLKR(total.total_cents),
          tr('discountAndTax'),
          tr('items'),
          ...items.flatMap((it) => [it.description, `${formatQty(it.qty_milli)} ${it.unit} × ${formatLKR(it.rate_cents)}`, formatLKR(lineAmount(it.qty_milli, it.rate_cents))]),
          tr('addItem'),
          tr('paymentSchedule'),
          ...payments.flatMap((p, i) => [p.label, `${formatPercent(p.percent_bp)} %`, formatLKR(amounts[i])]),
          tr('addStage'),
          tr('useStandardSchedule'),
          tr('paymentDetails'),
          tr('termsAndNotes'),
          estimate.notes ?? '',
          tr('shareEstimatePdf'),
          tr('markAsSent'),
          tr('markAsAccepted'),
          tr('editDetails'),
          tr('duplicateEstimate'),
          tr('deleteEstimate'),
        ];
      },
      absent: (tr) => [tr('estimateLockedCaption'), tr('reopenAsDraft'), tr('createProjectFromEstimate'), tr('openProject')],
      // 30 + 40 + 30 = 100 %: no "not scheduled yet" warning (the words after the number, in every language)
      check: (tr) => expect(visibleText()).not.toContain(tr('unscheduledPercent', { pct: '#' }).split('#')[1]),
    },
    {
      name: 'an accepted estimate is locked: no add or edit controls, one caption with Reopen as draft, Create project is offered',
      prepare: () => setRouteParams({ id: idOf(ACCEPTED) }),
      expect: (tr) => {
        const { estimate, total } = loaded(ACCEPTED);
        return [
          estimate.number,
          tr('estStatus_accepted'),
          estimate.client_name,
          `${tr('tax')} (18 %)`,
          formatLKR(total.tax_cents),
          formatLKR(total.total_cents),
          tr('estimateLockedCaption'),
          tr('reopenAsDraft'),
          tr('createProjectFromEstimate'),
          tr('shareEstimatePdf'),
        ];
      },
      absent: (tr) => [tr('addItem'), tr('addStage'), tr('useStandardSchedule'), tr('discountAndTax'), tr('markAsSent'), tr('markAsAccepted')],
    },
    {
      name: 'an id that does not exist shows a way out',
      prepare: () => setRouteParams({ id: 'no-such-estimate' }),
      expect: (tr) => [tr('errEstimateMissing'), tr('close')],
      absent: (tr) => [tr('shareEstimatePdf')],
    },
  ],
});

smokeScreen('estimate/[id] (hub, empty estimate)', () => <EstimateHub />, {
  db: 'empty',
  setup: () => {
    setSetting('lang', 'en');
    saveEstimate({ client_name: 'Bare Client', title: 'Bare job', issue_day: today() });
  },
  variants: [
    {
      name: 'no items and no stages: both empty states say what to do, the total is Rs 0, bank prompt links to Settings',
      prepare: () => {
        const id = rows<{ id: string }>('SELECT id FROM estimates')[0].id;
        setRouteParams({ id });
        // the company profile starts with only the account name filled in (a default), so the prompt shows
      },
      expect: (tr) => [
        'Bare Client',
        'Bare job',
        tr('noItems'),
        tr('noItemsHint'),
        tr('addItem'),
        tr('noStages'),
        tr('noStagesHint'),
        tr('useStandardSchedule'),
        tr('addStage'),
        'Rs 0',
        tr('noTerms'),
        tr('accountName'), // only the filled bank line (the account name is pre-filled) and a way to add the rest
        tr('addBankDetails'),
      ],
      absent: (tr) => [tr('estimateLockedCaption'), tr('bankName'), tr('accountNo')],
    },
  ],
});

smokeScreen('estimate/[id] (hub, bank details and a part-scheduled estimate)', () => <EstimateHub />, {
  db: 'empty',
  setup: () => {
    saveCompanyProfile({ bank_name: 'Sampath Bank', account_name: 'Bluemoon Engineering (Pvt) Ltd', account_no: '0012-3456-7890', branch: 'Welimada' });
    const id = saveEstimate({ client_name: 'Part Paid', title: 'Part job', issue_day: today(), notes: 'Price excludes the gate.' });
    saveEstimateItem({ estimate_id: id, description: 'Excavation', unit: 'm³', qty_milli: 12_500, rate_cents: 180_000 });
    saveEstimatePayment({ estimate_id: id, label: 'Advance', percent_bp: 3000 });
    saveEstimatePayment({ estimate_id: id, label: 'On completion', percent_bp: 4500 });
  },
  variants: [
    {
      name: 'the bank block shows only the filled lines and an Edit link; a warning row names the unscheduled share',
      prepare: () => setRouteParams({ id: rows<{ id: string }>('SELECT id FROM estimates')[0].id }),
      expect: (tr) => [
        tr('bankName'),
        'Sampath Bank',
        tr('accountNo'),
        '0012-3456-7890',
        tr('branch'),
        'Welimada',
        tr('edit'),
        tr('unscheduledPercent', { pct: '25' }),
        'Price excludes the gate.',
        tr('notes'),
        'Rs 22,500',
        '30 %',
        'Rs 6,750',
        '45 %',
        'Rs 10,125',
      ],
      absent: (tr) => [tr('addBankDetails'), tr('noTerms')],
    },
  ],
});

// ---------------------------------------------------------------- one line

smokeScreen('estimate/item', () => <EstimateItemScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'a new line: description, unit choices, quantity, rate, the live amount and both save buttons',
      prepare: () => setRouteParams({ estimateId: idOf(DRAFT) }),
      expect: (tr) => [
        tr('addItem'),
        tr('description'),
        tr('descriptionHint'),
        tr('unit'),
        'sq.m',
        'cu.m',
        'sq.ft',
        'cube',
        'lin.m',
        'rft',
        'nos',
        'kg',
        'L.S.',
        'perch',
        'day',
        tr('phDescription'),
        tr('phQty'),
        tr('otherUnit'),
        tr('quantity'),
        tr('rate'),
        tr('rs'),
        tr('amount'),
        '—',
        tr('save'),
        tr('saveAndAddAnother'),
      ],
      absent: (tr) => [tr('editItem'), tr('delete')],
    },
    {
      name: 'edit shows the stored line, its amount and a delete button',
      prepare: () => {
        const item = loaded(DRAFT).items[1];
        setRouteParams({ id: item.id, estimateId: idOf(DRAFT) });
      },
      expect: (tr) => {
        const item = loaded(DRAFT).items[1];
        return [tr('editItem'), item.description, item.unit ?? '', formatQty(item.qty_milli), formatLKR(lineAmount(item.qty_milli, item.rate_cents)), tr('save')];
      },
      absent: (tr) => [tr('saveAndAddAnother')],
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone', estimateId: idOf(DRAFT) }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- one stage

smokeScreen('estimate/payment', () => <EstimatePaymentScreen />, {
  db: 'demo',
  variants: [
    {
      name: 'a new stage: the usual names, the share, how much is still free and the amount',
      prepare: () => setRouteParams({ estimateId: idOf(DRAFT) }),
      expect: (tr) => [tr('addStage'), tr('stageName'), 'Advance', 'Progress payment', 'On completion', 'Retention', tr('stagePercent'), tr('percentAvailable', { pct: '0' }), tr('amount'), '—', tr('save')],
      absent: (tr) => [tr('editStage'), tr('delete')],
    },
    {
      name: 'edit shows the stored stage with its amount from the schedule',
      prepare: () => {
        const stage = loaded(DRAFT).payments[1];
        setRouteParams({ id: stage.id, estimateId: idOf(DRAFT) });
      },
      expect: (tr) => {
        const { payments, total } = loaded(DRAFT);
        const amounts = allocatePayments(total.total_cents, payments.map((p) => p.percent_bp));
        return [tr('editStage'), payments[1].label, '40', formatLKR(amounts[1]), tr('percentAvailable', { pct: '40' })];
      },
      check: (tr) => expect(screen.getAllByLabelText(tr('delete'))).toHaveLength(1),
    },
    {
      name: 'an id that does not exist renders nothing',
      prepare: () => setRouteParams({ id: 'gone', estimateId: idOf(DRAFT) }),
      blank: true,
    },
  ],
});

// ---------------------------------------------------------------- company and bank details

smokeScreen('company (a new phone)', () => <CompanyScreen />, {
  db: 'empty',
  variants: [
    {
      name: 'the defaults are filled in, the bank lines are empty and the caption says where it is kept',
      expect: (tr) => [
        tr('companyHint'),
        tr('companyDetails'),
        tr('companyName'),
        'Bluemoon Engineering (Pvt) Ltd',
        tr('registrationNo'),
        'PV 00232701',
        tr('address'),
        'Ambagaha Kumbura, Silmiyapura, Welimada, Badulla',
        tr('phone'),
        '077 337 0056',
        tr('email'),
        'bluemoonengi@gmail.com',
        tr('bankDetails'),
        tr('bankName'),
        tr('accountName'),
        tr('accountNo'),
        tr('branch'),
        tr('defaultValidDays'),
        '30',
        tr('defaultTerms'),
        tr('defaultTermsHint'),
        tr('save'),
      ],
      absent: (tr) => [tr('delete')],
    },
  ],
});

smokeScreen('company (saved details)', () => <CompanyScreen />, {
  db: 'empty',
  setup: () =>
    saveCompanyProfile({
      bank_name: 'Commercial Bank',
      account_no: '8001234567',
      branch: 'Badulla',
      default_valid_days: 45,
      default_terms: 'Prices exclude VAT.',
    }),
  variants: [
    {
      name: 'the stored details come back into the inputs',
      expect: () => ['Commercial Bank', '8001234567', 'Badulla', '45', 'Prices exclude VAT.'],
    },
  ],
});
