/**
 * Money is whole kobo everywhere (₦1 = 100 kobo), held as bigint so nothing is lost
 * to floating point. The database returns amounts as numbers or strings; both work here.
 */
export type Kobo = bigint | number | string;

export const toKobo = (value: Kobo | null | undefined): bigint =>
  value === null || value === undefined || value === '' ? 0n : BigInt(String(value).split('.')[0]);

/** Parses what a person types ("1,250,000.50" or "₦1.2m" is not accepted) into kobo. */
export function parseNaira(input: string): bigint | null {
  const clean = input.replace(/[₦,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const [, whole, frac = ''] = match;
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

/** ₦1,250,000.50 — or ₦1.25m with `compact`. */
export function formatNaira(
  value: Kobo | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  const kobo = toKobo(value);
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const sign = negative ? '−' : '';

  if (opts.compact) {
    const naira = Number(abs) / 100;
    const units: [number, string][] = [
      [1e12, 'tn'],
      [1e9, 'bn'],
      [1e6, 'm'],
      [1e3, 'k'],
    ];
    for (const [size, suffix] of units) {
      if (naira >= size) {
        return `${sign}₦${(naira / size).toLocaleString('en-NG', { maximumFractionDigits: 1 })}${suffix}`;
      }
    }
  }

  const whole = abs / 100n;
  const frac = abs % 100n;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Whole naira amounts are shown without ".00"; anything else shows its kobo.
  return `${sign}₦${wholeText}${frac === 0n ? '' : `.${frac.toString().padStart(2, '0')}`}`;
}

/** Kobo as a plain naira string for an input box ("1250000.50"). */
export const nairaInput = (value: Kobo | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const kobo = toKobo(value);
  const frac = kobo % 100n;
  return frac === 0n
    ? (kobo / 100n).toString()
    : `${kobo / 100n}.${frac.toString().padStart(2, '0')}`;
};

/** Share of `part` in `whole`, 0–1. */
export const ratio = (part: Kobo, whole: Kobo) => {
  const w = toKobo(whole);
  return w === 0n ? 0 : Number((toKobo(part) * 10_000n) / w) / 10_000;
};
