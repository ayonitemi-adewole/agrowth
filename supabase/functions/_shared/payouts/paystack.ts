import { hmacSha512 } from '../payments/paystack.ts';
import { GatewayError } from '../payments/types.ts';
import type { PayoutGateway, TransferRequest, TransferResult } from './types.ts';

/**
 * Paystack transfers, from the account's balance to Nigerian bank accounts.
 *
 *   GET  /balance                                   → { data: [{ currency, balance }] }
 *   GET  /bank/resolve?account_number&bank_code     → { data: { account_name } }
 *   POST /transferrecipient { type: 'nuban', name, account_number, bank_code, currency }
 *                                                   → { data: { recipient_code } }
 *   POST /transfer { source: 'balance', amount, recipient, reference, reason }
 *                                                   → { data: { status, transfer_code } }
 *        status: 'pending' or 'received' (sent), 'success', 'otp' (the account asks for an
 *        OTP on every transfer: switch that off for the platform to send them), 'failed'.
 *   Webhook events: transfer.success, transfer.failed, transfer.reversed, signed as for
 *   charges (x-paystack-signature).
 *
 * The account must be the trustee's own Paystack business, with transfers enabled. Paystack
 * charges a small fee per transfer, taken from the balance.
 */
export interface PaystackPayoutsConfig {
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

type Body = { status?: boolean; message?: string; data?: Record<string, unknown> & unknown[] };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function paystackPayouts(config: PaystackPayoutsConfig): PayoutGateway {
  const base = (config.baseUrl ?? 'https://api.paystack.co').replace(/\/+$/, '');
  const doFetch = config.fetch ?? fetch;
  const call = async (path: string, init?: RequestInit) => {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new GatewayError('Could not reach Paystack. Try again.');
    }
    const body = (await res.json().catch(() => null)) as Body | null;
    if (res.status === 401)
      throw new GatewayError('Paystack refused the request: check the secret key.');
    return { res, body };
  };

  return {
    name: 'paystack',

    async balance() {
      const { res, body } = await call('/balance');
      if (!res.ok || !Array.isArray(body?.data)) return null;
      const ngn = (body!.data as { currency?: string; balance?: number }[]).find(
        (b) => b.currency === 'NGN',
      );
      return ngn && typeof ngn.balance === 'number' ? BigInt(ngn.balance) : null;
    },

    async resolveAccount(accountNumber, bankCode) {
      const q = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
      const { res, body } = await call(`/bank/resolve?${q}`);
      if (res.ok && body?.status) return str((body.data as Record<string, unknown>)?.account_name);
      if (res.status === 422 || res.status === 400 || res.status === 404) return null;
      throw new GatewayError(
        `Paystack could not check the account (HTTP ${res.status}). Try again.`,
      );
    },

    async sendTransfer(t: TransferRequest): Promise<TransferResult> {
      const recipient = await call('/transferrecipient', {
        method: 'POST',
        body: JSON.stringify({
          type: 'nuban',
          name: t.accountName,
          account_number: t.accountNumber,
          bank_code: t.bankCode,
          currency: 'NGN',
        }),
      });
      const code = str(
        (recipient.body?.data as Record<string, unknown> | undefined)?.recipient_code,
      );
      if (!recipient.res.ok || !code) {
        throw new GatewayError(
          `Paystack couldn't add the payee: ${recipient.body?.message ?? `HTTP ${recipient.res.status}`}`,
        );
      }
      const { res, body } = await call('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          source: 'balance',
          amount: t.amountKobo.toString(),
          recipient: code,
          reference: t.reference,
          reason: t.reason.slice(0, 100),
          currency: 'NGN',
        }),
      });
      const data = (body?.data ?? {}) as Record<string, unknown>;
      const providerReference = str(data.transfer_code);
      if (!res.ok || !body?.status) {
        return {
          reference: t.reference,
          outcome: 'failed',
          providerReference,
          message: `Paystack refused the transfer: ${body?.message ?? `HTTP ${res.status}`}`,
        };
      }
      const status = str(data.status);
      return {
        reference: t.reference,
        outcome:
          status === 'success'
            ? 'paid'
            : status === 'otp'
              ? 'needs_otp'
              : status === 'failed'
                ? 'failed'
                : 'sent',
        providerReference,
        message:
          status === 'otp'
            ? 'Paystack asks for an OTP on each transfer. Turn that off in Paystack (Settings → Preferences) for the platform to send transfers.'
            : null,
      };
    },

    async parseTransferWebhook(rawBody, headers) {
      const signature = (headers.get('x-paystack-signature') ?? '').toLowerCase();
      if (signature !== (await hmacSha512(config.secretKey, rawBody))) return null;
      const event = JSON.parse(rawBody) as { event?: string; data?: Record<string, unknown> };
      const outcome =
        event.event === 'transfer.success'
          ? 'paid'
          : event.event === 'transfer.failed'
            ? 'failed'
            : event.event === 'transfer.reversed'
              ? 'reversed'
              : null;
      const reference = str(event.data?.reference);
      if (!outcome || !reference) return 'ignored';
      return {
        reference,
        outcome,
        providerReference: str(event.data?.transfer_code),
        message:
          str(event.data?.reason) && outcome !== 'paid'
            ? `Paystack: ${str(event.data?.reason)}`
            : null,
      };
    },
  };
}
