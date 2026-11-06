import { describe, expect, it } from 'vitest';
import { formatVoucherCode, isVoucherCode, normaliseVoucherCode } from './vouchers';

describe('voucher codes', () => {
  it('groups codes in fours', () => {
    expect(formatVoucherCode('ABCDEFGHJKLM')).toBe('ABCD-EFGH-JKLM');
    expect(formatVoucherCode('abcd efgh')).toBe('ABCD-EFGH');
  });

  it('accepts codes typed any way', () => {
    expect(normaliseVoucherCode(' abcd-efgh jklm ')).toBe('ABCDEFGHJKLM');
    expect(isVoucherCode('abcd-efgh-jklm')).toBe(true);
  });

  it('rejects incomplete codes and confusable characters', () => {
    expect(isVoucherCode('ABCD-EFGH')).toBe(false);
    expect(isVoucherCode('ABCD-EFGH-JKL0')).toBe(false);
    expect(isVoucherCode('ABCD-EFGH-JKLI')).toBe(false);
  });
});
