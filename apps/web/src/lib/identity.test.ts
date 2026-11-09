import { describe, expect, it } from 'vitest';
import {
  describeOutcomes,
  identityConfirmed,
  latestAnswered,
  type IdentityCheck,
  type IdentityCheckStatus,
  type NumberType,
} from './identity';

let n = 0;
const check = (type: NumberType, status: IdentityCheckStatus, at: string): IdentityCheck => ({
  id: String(n++),
  subject: 'farmer',
  farmer_id: 'f',
  investor_id: null,
  number_type: type,
  provider: 'mock',
  status,
  fields: null,
  provider_reference: null,
  error_message: null,
  requested_by: 'u',
  requested_at: at,
  completed_at: status === 'pending' ? null : at,
});

describe('identity checks', () => {
  it('counts the newest answered check of each number', () => {
    const checks = [
      check('nin', 'no_match', '2026-11-01T10:00:00Z'),
      check('nin', 'match', '2026-11-02T10:00:00Z'),
      check('nin', 'pending', '2026-11-03T10:00:00Z'),
    ];
    expect(latestAnswered(checks).nin?.status).toBe('match');
    expect(latestAnswered(checks).bvn).toBeUndefined();
  });

  it('needs a match on every number on record', () => {
    const nin = check('nin', 'match', '2026-11-02T10:00:00Z');
    expect(identityConfirmed(['nin'], [nin])).toBe(true);
    expect(identityConfirmed(['nin', 'bvn'], [nin])).toBe(false);
    expect(
      identityConfirmed(['nin', 'bvn'], [nin, check('bvn', 'partial', '2026-11-02T11:00:00Z')]),
    ).toBe(false);
    expect(identityConfirmed([], [nin])).toBe(false);
  });

  it('ignores checks from before an investor resubmitted', () => {
    const old = check('nin', 'match', '2026-11-01T10:00:00Z');
    expect(identityConfirmed(['nin'], [old], '2026-11-02T00:00:00Z')).toBe(false);
  });

  it('summarises outcomes for a notice', () => {
    expect(
      describeOutcomes([
        {
          number_type: 'nin',
          check_id: 'c',
          provider: 'mock',
          status: 'match',
          fields: null,
          error_message: null,
        },
      ]),
    ).toEqual({ ok: true, message: 'Identity confirmed (NIN: match)' });
    expect(
      describeOutcomes([{ number_type: 'bvn', refused: 'This BVN is not the one on record' }]),
    ).toEqual({ ok: false, message: 'Identity check: BVN: This BVN is not the one on record' });
  });
});
