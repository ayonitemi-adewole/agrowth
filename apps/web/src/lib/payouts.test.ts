import { describe, expect, it } from 'vitest';
import { describeSend, isLive } from './payouts';

describe('gateway payouts', () => {
  it('says how a send went', () => {
    expect(describeSend([{ status: 'paid' }, { status: 'paid' }])).toEqual({
      ok: true,
      message: '2 paid',
    });
    expect(describeSend([{ status: 'sent' }, { status: 'needs_review' }])).toEqual({
      ok: false,
      message: '1 sent, awaiting the bank, 1 held for you to check',
    });
    expect(describeSend([])).toEqual({ ok: true, message: 'Nothing sent' });
  });

  it('treats sending, sent and held transfers as still out', () => {
    expect(['pending', 'sent', 'needs_review'].every((s) => isLive(s as never))).toBe(true);
    expect(isLive('paid')).toBe(false);
    expect(isLive('failed')).toBe(false);
  });
});
