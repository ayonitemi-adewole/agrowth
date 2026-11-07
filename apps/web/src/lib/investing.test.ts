import { describe, expect, it } from 'vitest';
import { formatReturn, openKobo, project, riskScore, statement, subscribed } from './investing';
import type { Listing } from './types';

/** ₦900k raised for 2 ha; yields 2/3/4 t/ha at ₦300k/₦380k/₦450k a tonne. */
const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'c1',
  code: 'KD-MAIZE-001',
  crop: 'maize',
  season: '2027 wet',
  status: 'open_for_funding',
  funding_source: 'investor',
  description: null,
  target_kobo: '90000000',
  raised_kobo: '30000000',
  reserved_kobo: '15000000',
  funders: 1,
  funding_deadline: '2027-04-01',
  start_date: '2027-04-15',
  expected_harvest_date: '2027-10-15',
  farm_count: 4,
  hectares: 2,
  yield_low: 2,
  yield_expected: 3,
  yield_high: 4,
  price_low_kobo: '30000000',
  price_expected_kobo: '38000000',
  price_high_kobo: '45000000',
  management_fee_bps: 200,
  funder_profit_share_bps: 3000,
  cooperative: null,
  sum_insured_kobo: '90000000',
  insurers: ['Pula Assurance'],
  offtakers: ['Northern Mills Ltd'],
  offtake_volume_t: 10,
  offtake_price_terms: ['floor'],
  offtake_floor_kobo: '30000000',
  ...over,
});

describe('project', () => {
  it('runs the waterfall: fee, then capital, then the funders’ share of the profit', () => {
    // Expected: 2 ha × 3 t × ₦380k = ₦2.28m. Fee 2% of ₦900k = ₦18k. Capital ₦900k back.
    // Profit ₦1.362m, 30% to funders = ₦408.6k. Return 408.6/900 = 45.4%.
    const p = project(listing(), 'expected');
    expect(p.revenue).toBe(2_280_000);
    expect(p.toFunders).toBeCloseTo(1_308_600);
    expect(p.returnPct).toBeCloseTo(0.454);
  });

  it('shows a capital loss when the harvest does not cover it', () => {
    // Low: 1 ha × 2 t × ₦300k = ₦600k. Fee ₦18k, ₦582k of ₦900k back: −35.3%.
    const p = project(listing({ hectares: 1 }), 'low');
    expect(p.toFunders).toBe(582_000);
    expect(p.returnPct).toBeCloseTo(-0.3533, 3);
  });

  it('treats a missing price as no revenue', () => {
    expect(project(listing({ price_low_kobo: null }), 'low').toFunders).toBe(0);
  });
});

describe('riskScore', () => {
  it('rates a diversified, insured, price-floored cycle with a safe low case as lower risk', () => {
    const r = riskScore(listing());
    expect(r).toMatchObject({ score: 1, label: 'Lower', tone: 'green' });
    expect(r.factors.every((f) => f.good)).toBe(true);
  });

  it('adds a point for each weakness, up to 5', () => {
    const r = riskScore(
      listing({
        hectares: 1,
        farm_count: 1,
        sum_insured_kobo: '45000000',
        offtake_price_terms: ['formula'],
      }),
    );
    expect(r.score).toBe(5);
    expect(r.label).toBe('Higher');
    expect(r.factors.filter((f) => !f.good)).toHaveLength(4);
    expect(r.factors[0].text).toMatch(/lose about 35%/);
  });
});

describe('helpers', () => {
  it('formats returns with a sign', () => {
    expect(formatReturn(0.454)).toBe('+45.4%');
    expect(formatReturn(-0.3533)).toBe('−35.3%');
    expect(formatReturn(0)).toBe('0%');
  });

  it('counts pledges as taken', () => {
    expect(subscribed(listing())).toBe(0.5);
    expect(openKobo(listing())).toBe(45_000_000n);
  });
});

describe('statement', () => {
  const base = {
    id: 'p1',
    reference: 'AGR-ABCD2345',
    cycle_id: 'c1',
    amount_kobo: '40000000',
    status: 'paid' as const,
    pledged_at: '2027-03-01T10:00:00Z',
    cooling_off_ends_at: '2027-03-03T10:00:00Z',
    pay_by: '2027-03-08',
    disclosure_version: 1,
    disclosure_acknowledged_at: '2027-03-01T10:00:00Z',
    received_on: '2027-03-04',
    trustee_reference: 'BANK-1',
    refunded: false,
    refunded_at: null,
    payouts: [],
  };

  it('splits a settlement payout into capital and return', () => {
    const lines = statement({
      ...base,
      payouts: [
        {
          amount_kobo: '52000000',
          capital_kobo: '40000000',
          status: 'executed',
          paid_at: '2027-11-02T09:00:00Z',
          created_at: '2027-11-01T09:00:00Z',
        },
      ],
    });
    expect(lines.map((l) => [l.text, l.amount])).toEqual([
      ['Pledged ₦400,000 (AGR-ABCD2345)', undefined],
      ['Paid to the trustee (ref. BANK-1)', -40_000_000n],
      ['Capital returned', 40_000_000n],
      ['Return', 12_000_000n],
    ]);
  });

  it('shows a refund, and a loss as capital only', () => {
    expect(
      statement({ ...base, refunded: true, refunded_at: '2027-04-01T00:00:00Z' }).at(-1),
    ).toMatchObject({ text: 'Refunded in full', amount: 40_000_000n });
    const loss = statement({
      ...base,
      payouts: [
        {
          amount_kobo: '30000000',
          capital_kobo: '30000000',
          status: 'instructed',
          paid_at: null,
          created_at: '2027-11-01T09:00:00Z',
        },
      ],
    });
    expect(loss.at(-1)).toMatchObject({
      text: 'Capital returned (being paid)',
      amount: 30_000_000n,
    });
  });
});
