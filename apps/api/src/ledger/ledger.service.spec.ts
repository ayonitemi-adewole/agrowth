import { BadRequestException } from '@nestjs/common';
import { validatePosting } from './ledger.service';

const a = '00000000-0000-0000-0000-00000000000a';
const b = '00000000-0000-0000-0000-00000000000b';

describe('validatePosting', () => {
  it('accepts a balanced two-line entry', () => {
    expect(() =>
      validatePosting([
        { accountId: a, amountKobo: 500_000n },
        { accountId: b, amountKobo: -500_000n },
      ]),
    ).not.toThrow();
  });

  it('accepts a balanced multi-line split', () => {
    expect(() =>
      validatePosting([
        { accountId: a, amountKobo: 1_000_000n },
        { accountId: b, amountKobo: -700_000n },
        { accountId: b, amountKobo: -300_000n },
      ]),
    ).not.toThrow();
  });

  it('rejects a single line', () => {
    expect(() => validatePosting([{ accountId: a, amountKobo: 1n }])).toThrow(BadRequestException);
  });

  it('rejects an unbalanced entry and reports the difference', () => {
    expect(() =>
      validatePosting([
        { accountId: a, amountKobo: 500_000n },
        { accountId: b, amountKobo: -499_999n },
      ]),
    ).toThrow('lines sum to 1 kobo');
  });

  it('rejects zero-value lines', () => {
    expect(() =>
      validatePosting([
        { accountId: a, amountKobo: 0n },
        { accountId: b, amountKobo: 0n },
      ]),
    ).toThrow('cannot be zero');
  });

  it('rejects non-bigint amounts (no floating-point money)', () => {
    expect(() =>
      validatePosting([
        { accountId: a, amountKobo: 10.5 as unknown as bigint },
        { accountId: b, amountKobo: -10.5 as unknown as bigint },
      ]),
    ).toThrow('whole kobo');
  });
});
