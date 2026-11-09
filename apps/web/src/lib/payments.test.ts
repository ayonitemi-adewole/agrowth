import { describe, expect, it } from 'vitest';
import { returnedReference } from './payments';

describe('coming back from the payment gateway', () => {
  it('finds our payment reference however the gateway names it', () => {
    expect(returnedReference('?payment=AGC-0123456789AB')).toBe('AGC-0123456789AB');
    // Paystack appends ?trxref=…&reference=…
    expect(returnedReference('?trxref=AGC-0123456789AB&reference=AGC-0123456789AB')).toBe(
      'AGC-0123456789AB',
    );
  });

  it('ignores anything that is not one of our references', () => {
    expect(returnedReference('')).toBeNull();
    expect(returnedReference('?reference=T123456')).toBeNull();
    expect(returnedReference('?payment=AGC-<script>')).toBeNull();
  });
});
