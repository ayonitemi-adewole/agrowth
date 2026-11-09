/**
 * Paying out through the payment gateway: the trustee's payments sent as transfers from
 * its Paystack balance. Plain TypeScript (fetch and Web Crypto only), shared by the payouts
 * and payments-webhook Edge Functions and the tests.
 */

export interface TransferRequest {
  /** Ours: the transfer's id, which the gateway's reports quote back. */
  reference: string;
  amountKobo: bigint;
  accountNumber: string;
  bankCode: string;
  /** The payee's name as we hold it. */
  accountName: string;
  /** Shown on the payee's statement, e.g. the payment's AGP reference and what it's for. */
  reason: string;
}

export type TransferOutcome =
  /** Accepted; the gateway will report when it arrives. */
  | 'sent'
  /** Arrived (the simulated gateway, or a gateway that settles at once). */
  | 'paid'
  | 'failed'
  /** Reversed after it was reported paid: the money is back in the balance. */
  | 'reversed'
  /** The gateway account asks for an OTP on every transfer; nothing was sent. */
  | 'needs_otp';

export interface TransferResult {
  reference: string;
  outcome: TransferOutcome;
  providerReference: string | null;
  message: string | null;
}

export interface PayoutGateway {
  readonly name: string;
  /** Money available to send, in kobo; null if the gateway won't say. */
  balance(): Promise<bigint | null>;
  /** The name the bank holds for an account, or null if there's no such account. */
  resolveAccount(
    accountNumber: string,
    bankCode: string,
    expectedName: string,
  ): Promise<string | null>;
  sendTransfer(t: TransferRequest): Promise<TransferResult>;
  /**
   * Reads a webhook call: null if it isn't signed by the gateway, 'ignored' for events
   * that aren't about transfers, otherwise the transfer's outcome.
   */
  parseTransferWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<TransferResult | 'ignored' | null>;
}
