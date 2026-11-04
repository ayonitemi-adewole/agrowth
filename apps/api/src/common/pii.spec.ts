import { hashIdentifier, lastFour } from './pii';

const pepper = 'x'.repeat(32);

describe('PII helpers', () => {
  it('hashes the same identifier the same way, ignoring spaces', () => {
    expect(hashIdentifier('1234 5678 901', pepper)).toBe(hashIdentifier('12345678901', pepper));
  });

  it('never returns the raw identifier', () => {
    const hash = hashIdentifier('12345678901', pepper);
    expect(hash).not.toContain('12345678901');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes under a different pepper', () => {
    expect(hashIdentifier('12345678901', pepper)).not.toBe(
      hashIdentifier('12345678901', 'y'.repeat(32)),
    );
  });

  it('keeps only the last four digits for display', () => {
    expect(lastFour('1234 5678 901')).toBe('8901');
  });
});
