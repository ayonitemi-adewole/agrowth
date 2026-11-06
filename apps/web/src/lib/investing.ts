import { formatNaira, toKobo } from './money';
import type { InvestorClass, Listing, MyPledge, PledgeStatus } from './types';

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

export const INVESTOR_CLASS: Record<InvestorClass, string> = {
  retail: 'Retail',
  high_net_worth: 'High-net-worth',
  institutional: 'Institutional',
};

export const PLEDGE_STATUS: Record<PledgeStatus | 'refunded', { label: string; tone: Tone }> = {
  pending: { label: 'Awaiting payment', tone: 'amber' },
  paid: { label: 'Invested', tone: 'green' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  lapsed: { label: 'Lapsed', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'red' },
};

export type Scenario = 'low' | 'expected' | 'high';

export interface Projection {
  scenario: Scenario;
  /** Harvest sales: hectares × yield × price, in naira. */
  revenue: number;
  /** What funders get back in total (capital plus return), in naira. */
  toFunders: number;
  /** Return on capital, e.g. 0.12 = +12%, −0.3 = lost 30%. */
  returnPct: number;
}

/**
 * What funders would receive if the harvest came in at each of the cycle's assumptions.
 * Mirrors the database's settlement waterfall (compute_settlement): the management fee first,
 * then capital back, then the funders' share of what is left. Ignores insurance, so the
 * low case shows the loss before any claim.
 */
export function project(l: Listing, scenario: Scenario): Projection {
  const yields = { low: l.yield_low, expected: l.yield_expected, high: l.yield_high };
  const prices = {
    low: l.price_low_kobo,
    expected: l.price_expected_kobo,
    high: l.price_high_kobo,
  };
  const capital = Number(l.target_kobo) / 100;
  const revenue =
    Number(l.hectares) * Number(yields[scenario]) * (Number(prices[scenario] ?? 0) / 100);
  const fee = Math.min(revenue, (capital * l.management_fee_bps) / 10_000);
  const capitalBack = Math.min(revenue - fee, capital);
  const profit = revenue - fee - capitalBack;
  const toFunders = capitalBack + (profit * l.funder_profit_share_bps) / 10_000;
  return {
    scenario,
    revenue,
    toFunders,
    returnPct: capital > 0 ? toFunders / capital - 1 : 0,
  };
}

export const projections = (l: Listing) =>
  (['low', 'expected', 'high'] as const).map((s) => project(l, s));

/** +12.5% / −30% */
export const formatReturn = (pct: number) => {
  const v = Math.round(pct * 1000) / 10;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-NG')}%`;
};

/** Months from the start of the season to harvest, rounded. */
export function durationMonths(l: Pick<Listing, 'start_date' | 'expected_harvest_date'>) {
  if (!l.start_date || !l.expected_harvest_date) return null;
  const days =
    (new Date(l.expected_harvest_date).getTime() - new Date(l.start_date).getTime()) / 86_400_000;
  return Math.max(1, Math.round(days / 30.44));
}

export interface RiskFactor {
  /** true = this lowers the risk; false = it adds to it. */
  good: boolean;
  text: string;
}

export interface RiskScore {
  /** 1 (lower risk) to 5 (higher risk). */
  score: number;
  label: 'Lower' | 'Moderate' | 'Higher';
  tone: Tone;
  factors: RiskFactor[];
}

/**
 * A plain-language risk score from what the listing shows. It is a guide for comparing
 * cycles, not a rating: every cycle can lose money.
 */
export function riskScore(l: Listing): RiskScore {
  const factors: RiskFactor[] = [];
  let points = 0;

  const low = project(l, 'low');
  if (low.returnPct < -0.2) {
    points += 2;
    factors.push({
      good: false,
      text: `If yields and prices both come in low, funders lose about ${Math.round(-low.returnPct * 100)}% of their capital before any insurance claim.`,
    });
  } else if (low.returnPct < 0) {
    points += 1;
    factors.push({
      good: false,
      text: `In the low case funders get back slightly less than they put in (${formatReturn(low.returnPct)}).`,
    });
  } else {
    factors.push({
      good: true,
      text: 'Even the low case returns funders their capital.',
    });
  }

  const cover = Number(l.target_kobo) > 0 ? Number(l.sum_insured_kobo) / Number(l.target_kobo) : 0;
  if (cover >= 1) {
    factors.push({
      good: true,
      text: `Insured for ${Math.round(cover * 100)}% of the amount raised${l.insurers.length ? ` with ${l.insurers.join(', ')}` : ''}, with the trustee as loss payee.`,
    });
  } else {
    points += 1;
    factors.push({
      good: false,
      text: `Insurance covers only ${Math.round(cover * 100)}% of the amount raised.`,
    });
  }

  const guaranteed = l.offtake_price_terms.some((t) => t === 'fixed' || t === 'floor');
  if (guaranteed) {
    factors.push({
      good: true,
      text: `${l.offtakers.join(', ') || 'The offtaker'} has signed to buy the harvest at a fixed or minimum price.`,
    });
  } else {
    points += 1;
    factors.push({
      good: false,
      text: 'The offtake price follows a market formula, so a price fall reaches funders.',
    });
  }

  if (l.farm_count < 3) {
    points += 1;
    factors.push({
      good: false,
      text: `Only ${l.farm_count} farm${l.farm_count === 1 ? '' : 's'}: one bad field affects the whole cycle.`,
    });
  } else {
    factors.push({
      good: true,
      text: `Spread across ${l.farm_count} mapped and verified farms.`,
    });
  }

  const score = Math.min(5, 1 + points);
  const label = score <= 2 ? 'Lower' : score === 3 ? 'Moderate' : 'Higher';
  return {
    score,
    label,
    tone: label === 'Lower' ? 'green' : label === 'Moderate' ? 'amber' : 'red',
    factors,
  };
}

/** Share of the cycle that is paid or reserved by pledges, 0–1. */
export const subscribed = (l: Pick<Listing, 'raised_kobo' | 'reserved_kobo' | 'target_kobo'>) =>
  Number(l.target_kobo) > 0
    ? Math.min(1, (Number(l.raised_kobo) + Number(l.reserved_kobo)) / Number(l.target_kobo))
    : 0;

/** Money still open to new pledges, in kobo. */
export const openKobo = (l: Pick<Listing, 'raised_kobo' | 'reserved_kobo' | 'target_kobo'>) =>
  BigInt(l.target_kobo) - BigInt(l.raised_kobo) - BigInt(l.reserved_kobo);

/** A line of an investment's statement. Positive = money to the investor. */
export interface StatementLine {
  date: string;
  text: string;
  amount?: bigint;
}

/** The money history of one investment, oldest first. */
export function statement(p: MyPledge): StatementLine[] {
  const lines: StatementLine[] = [
    { date: p.pledged_at, text: `Pledged ${formatNaira(p.amount_kobo)} (${p.reference})` },
  ];
  if (p.received_on) {
    lines.push({
      date: p.received_on,
      text: `Paid to the trustee (ref. ${p.trustee_reference})`,
      amount: -toKobo(p.amount_kobo),
    });
  }
  if (p.refunded && p.refunded_at) {
    lines.push({ date: p.refunded_at, text: 'Refunded in full', amount: toKobo(p.amount_kobo) });
  }
  for (const payout of p.payouts) {
    const capital = toKobo(payout.capital_kobo);
    const ret = toKobo(payout.amount_kobo) - capital;
    const when = payout.paid_at ?? payout.created_at;
    const pending = payout.status !== 'executed';
    if (capital > 0n) {
      lines.push({
        date: when,
        text: pending ? 'Capital returned (being paid)' : 'Capital returned',
        amount: capital,
      });
    }
    if (ret > 0n) {
      lines.push({
        date: when,
        text: pending ? 'Return (being paid)' : 'Return',
        amount: ret,
      });
    }
  }
  return lines;
}
