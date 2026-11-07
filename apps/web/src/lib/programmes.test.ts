import { describe, expect, it } from 'vitest';
import { csvNaira, formatPct, repaymentRate, toCsv, yieldPerHa } from './programmes';

describe('repaymentRate and yieldPerHa', () => {
  it('divides recovered by due, and is null when nothing is due', () => {
    expect(repaymentRate({ due_kobo: '80000000', recovered_kobo: '60000000' })).toBe(0.75);
    expect(repaymentRate({ due_kobo: '0', recovered_kobo: '0' })).toBeNull();
  });

  it('measures yield only on harvested land', () => {
    expect(yieldPerHa({ delivered_kg: 5000, harvested_hectares: 2 })).toBe(2.5);
    expect(yieldPerHa({ delivered_kg: 0, harvested_hectares: 0 })).toBeNull();
  });

  it('formats percentages', () => {
    expect(formatPct(0.756)).toBe('76%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('toCsv', () => {
  it('writes a header and quotes what needs quoting', () => {
    const csv = toCsv(
      [
        { name: 'Amina, Ibrahim', note: 'said "fine"', n: 3 },
        { name: 'Bello', note: null, n: -2 },
      ],
      [
        ['Name', (r) => r.name],
        ['Note', (r) => r.note],
        ['N', (r) => r.n],
      ],
    );
    expect(csv).toBe('Name,Note,N\r\n"Amina, Ibrahim","said ""fine""",3\r\nBello,,-2');
  });

  it('defuses spreadsheet formulas', () => {
    expect(toCsv([{ v: '=HYPERLINK("x")' }], [['V', (r) => r.v]])).toBe(
      'V\r\n"\'=HYPERLINK(""x"")"',
    );
  });

  it('writes naira from kobo', () => {
    expect(csvNaira('125000050')).toBe('1250000.50');
    expect(csvNaira(33.4)).toBe('0.33');
  });
});
