import { describe, expect, it } from 'vitest';
import {
  formatVoucherCode,
  isVoucherCode,
  normaliseVoucherCode,
  scanTokenFrom,
  voucherScanUrl,
} from './vouchers';

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

describe('scanning voucher slips', () => {
  it('puts the voucher link in the QR code and reads it back', () => {
    const url = voucherScanUrl('ABCDEFGHJKLMNPQRSTUVWXYZ', 'https://agrowth.example');
    expect(url).toBe('https://agrowth.example/redeem?v=ABCDEFGHJKLMNPQRSTUVWXYZ');
    expect(scanTokenFrom(url)).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ');
    expect(scanTokenFrom(' abcdefghjklmnpqrstuvwxyz ')).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ');
  });

  it('ignores QR codes that are not voucher slips', () => {
    expect(scanTokenFrom('https://example.com/menu')).toBeNull();
    expect(scanTokenFrom('https://agrowth.example/redeem?v=short')).toBeNull();
    expect(scanTokenFrom('WIFI:S:Shop;P:secret;;')).toBeNull();
  });
});
