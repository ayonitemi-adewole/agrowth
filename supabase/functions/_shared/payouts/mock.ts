import type { PayoutGateway } from './types.ts';

/**
 * The simulated gateway's transfers, for demos and development. Every account belongs to
 * whoever it's meant to, except account numbers ending in 0000 (no such account) and 1111
 * (someone else's), and every transfer arrives at once. Nothing is sent. The database
 * refuses these unless an admin allows simulated payments.
 */
export const mockPayouts: PayoutGateway = {
  name: 'mock',
  async balance() {
    return 50_000_000_00n;
  },
  async resolveAccount(accountNumber, _bankCode, expectedName) {
    if (accountNumber.endsWith('0000')) return null;
    if (accountNumber.endsWith('1111')) return 'CHIDINMA OKONKWO-BELLO';
    return expectedName.toUpperCase();
  },
  async sendTransfer(t) {
    return {
      reference: t.reference,
      outcome: 'paid',
      providerReference: `SIMTRF${t.reference.replace(/-/g, '').slice(0, 10).toUpperCase()}`,
      message: 'Transferred (simulated)',
    };
  },
  async parseTransferWebhook() {
    return null;
  },
};
