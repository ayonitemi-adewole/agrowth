import { describe, expect, it } from 'vitest';
import { isOpen, stepReached } from './claims';

describe('claim progress', () => {
  const claim = (status: Parameters<typeof isOpen>[0], notified = false, assessed = false) => ({
    status,
    notified_on: notified ? '2026-11-01' : null,
    assessed_on: assessed ? '2026-11-05' : null,
  });

  it('ticks each step the claim has reached', () => {
    expect(stepReached(claim('reported'))).toBe(0);
    expect(stepReached(claim('notified', true))).toBe(1);
    expect(stepReached(claim('assessed', true, true))).toBe(2);
    expect(stepReached(claim('paid', true, true))).toBe(3);
  });

  it('stops a closed claim where it got to', () => {
    expect(stepReached(claim('withdrawn'))).toBe(0);
    expect(stepReached(claim('rejected', true))).toBe(1);
    expect(isOpen('rejected')).toBe(false);
    expect(isOpen('notified')).toBe(true);
  });
});
