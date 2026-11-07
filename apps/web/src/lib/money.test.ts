import { describe, expect, it } from 'vitest';
import { formatNaira, nairaInput, parseNaira, ratio, toKobo } from './money';

describe('parseNaira', () => {
  it.each([
    ['1250000', 125_000_000n],
    ['1,250,000.50', 125_000_050n],
    ['₦ 2,500', 250_000n],
    ['0.5', 50n],
    ['7.05', 705n],
  ])('reads %s as %s kobo', (input, kobo) => {
    expect(parseNaira(input)).toBe(kobo);
  });

  it.each(['', 'abc', '1.234', '-5', '1e6', '1.2m'])('rejects %j', (input) => {
    expect(parseNaira(input)).toBeNull();
  });

  it('stays exact beyond floating-point precision', () => {
    expect(parseNaira('90071992547409.93')).toBe(9_007_199_254_740_993n);
  });
});

describe('formatNaira', () => {
  it('formats whole naira without kobo, and kobo when present', () => {
    expect(formatNaira(125_000_000)).toBe('₦1,250,000');
    expect(formatNaira('125000050')).toBe('₦1,250,000.50');
    expect(formatNaira(5n)).toBe('₦0.05');
  });

  it('shows negatives with a minus sign', () => {
    expect(formatNaira(-250_000n)).toBe('−₦2,500');
  });

  it('abbreviates large amounts when asked', () => {
    expect(formatNaira(9_000_000_000, { compact: true })).toBe('₦90m');
    expect(formatNaira(125_000_000, { compact: true })).toBe('₦1.3m');
    expect(formatNaira(45_000, { compact: true })).toBe('₦450');
  });
});

it('round-trips kobo through an input box', () => {
  expect(nairaInput(125_000_050)).toBe('1250000.50');
  expect(parseNaira(nairaInput(125_000_050))).toBe(125_000_050n);
  expect(nairaInput(null)).toBe('');
});

it('computes funding progress without floating-point drift', () => {
  expect(ratio(50_000_000, 90_000_000)).toBeCloseTo(0.5555, 4);
  expect(ratio(1, 0)).toBe(0);
  expect(toKobo('')).toBe(0n);
});
