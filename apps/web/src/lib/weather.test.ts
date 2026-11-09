import { describe, expect, it } from 'vitest';
import { rainAxisMax, shareOfUsual, vsUsual } from './weather';

describe('weather helpers', () => {
  it('compares rain with the usual, when there is a usual', () => {
    expect(shareOfUsual(30, 150)).toBe(0.2);
    expect(shareOfUsual(30, null)).toBeNull();
    expect(shareOfUsual(30, 0)).toBeNull();
    expect(vsUsual(63, 150.4)).toBe('42% of usual (150 mm)');
    expect(vsUsual(63, null)).toBe('');
  });

  it('picks a tidy top for the rain axis', () => {
    expect(rainAxisMax([])).toBe(10);
    expect(rainAxisMax([3, 7.5])).toBe(10);
    expect(rainAxisMax([12, 18])).toBe(20);
    expect(rainAxisMax([61])).toBe(80);
    expect(rainAxisMax([630])).toBe(700);
  });
});
