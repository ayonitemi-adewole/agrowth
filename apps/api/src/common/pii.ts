import { createHmac } from 'node:crypto';

/**
 * Identity numbers (BVN, NIN) are never stored in plain text. We keep a keyed hash
 * for deduplication (one farmer can't enrol twice) and the last four digits for display.
 */
export function hashIdentifier(value: string, pepper: string): string {
  const normalised = value.replace(/\s+/g, '');
  return createHmac('sha256', pepper).update(normalised).digest('hex');
}

export function lastFour(value: string): string {
  return value.replace(/\s+/g, '').slice(-4);
}
