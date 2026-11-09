import {
  GatewayError,
  type CheckoutRequest,
  type PaymentGateway,
  type PaymentResult,
} from './types.ts';

/**
 * Paystack (paystack.com), Nigerian payments.
 *
 *   POST /transaction/initialize { email, amount, reference, callback_url, currency, metadata }
 *        → { status, data: { authorization_url, access_code, reference } }
 *   GET  /transaction/verify/:reference
 *        → { status, data: { status: 'success'|'failed'|'abandoned'|…, amount, reference,
 *                             id, channel, paid_at, gateway_response } }
 *   Webhook: POST with x-paystack-signature = HMAC-SHA512(raw body, secret key), hex;
 *            event "charge.success" carries the same data as verify.
 *
 * Authorization: Bearer <secret key>. Amounts are in kobo. Settlement goes to the bank
 * account set on the Paystack business: it must be the trustee's escrow account.
 *
 * Fees (local transactions, check current pricing): 1.5% + ₦100, the ₦100 waived under
 * ₦2,500, capped at ₦2,000. The investor pays the fee, so the trustee receives the pledge
 * in full.
 */
export interface PaystackConfig {
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const PERCENT_BPS = 150n; // 1.5%
const FLAT_KOBO = 100_00n;
const FLAT_WAIVED_UNDER_KOBO = 2_500_00n;
const CAP_KOBO = 2_000_00n;

/** Paystack's fee on a charge of `charge` kobo. */
export function paystackFee(charge: bigint): bigint {
  const flat = charge < FLAT_WAIVED_UNDER_KOBO ? 0n : FLAT_KOBO;
  const fee = (charge * PERCENT_BPS + 9_999n) / 10_000n + flat;
  return fee > CAP_KOBO ? CAP_KOBO : fee;
}

/** The fee to add to `amount` so that, after Paystack's fee, `amount` is left. */
export function paystackFeeFor(amount: bigint): bigint {
  // Solve charge - fee(charge) >= amount for the smallest charge.
  let charge = ((amount + FLAT_KOBO) * 10_000n) / (10_000n - PERCENT_BPS);
  if (charge - amount > CAP_KOBO) charge = amount + CAP_KOBO;
  while (charge - paystackFee(charge) < amount) charge += 1n;
  while (charge > amount && charge - 1n - paystackFee(charge - 1n) >= amount) charge -= 1n;
  return charge - amount;
}

/**
 * The email Paystack is given. Paystack rejects addresses on the reserved test domains
 * (.test, .example, .invalid, .localhost) that demo and test accounts use, so those are
 * given as an address on example.com (reserved too, but accepted) that keeps the original
 * readable: investor@agrowth.test → investor.agrowth.test@example.com. Real addresses
 * are passed as they are; Paystack sends its receipt there.
 */
export function paystackEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  const domain = at > 0 ? trimmed.slice(at + 1).toLowerCase() : '';
  if (domain && !/\.(test|example|invalid|localhost)$|^localhost$/.test(domain)) return trimmed;
  const readable = trimmed
    .toLowerCase()
    .replace(/@/, '.')
    .replace(/[^a-z0-9.+-]/g, '-');
  return `${readable || 'investor'}@example.com`;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA512 of `body` with `key`, as hex. */
export async function hmacSha512(key: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
}

/** Compares in constant time, so the signature check doesn't leak how much matched. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Tx = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function toResult(reference: string, d: Tx): PaymentResult {
  const status = str(d.status);
  const amount =
    typeof d.amount === 'number' || typeof d.amount === 'string' ? BigInt(d.amount) : null;
  return {
    reference,
    succeeded: status === 'success',
    pending:
      status === null ||
      ['ongoing', 'pending', 'processing', 'queued', 'abandoned'].includes(status),
    paidKobo: status === 'success' ? amount : null,
    providerReference: d.id === undefined || d.id === null ? null : String(d.id),
    channel: str(d.channel),
    paidAt: str(d.paid_at) ?? str(d.paidAt),
    message: str(d.gateway_response),
  };
}

export function paystackGateway(config: PaystackConfig): PaymentGateway {
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
    const body = (await res.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: Tx;
    } | null;
    if (res.status === 401)
      throw new GatewayError('Paystack refused the request: check the secret key.');
    return { res, body };
  };

  return {
    name: 'paystack',
    feeFor: paystackFeeFor,

    async startCheckout(req: CheckoutRequest) {
      const { res, body } = await call('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: paystackEmail(req.email),
          amount: req.chargeKobo.toString(),
          currency: 'NGN',
          reference: req.reference,
          callback_url: req.returnUrl,
          metadata: req.metadata,
        }),
      });
      const url = str(body?.data?.authorization_url);
      if (!res.ok || !body?.status || !url) {
        throw new GatewayError(
          `Paystack could not start the payment: ${body?.message ?? `HTTP ${res.status}`}`,
        );
      }
      return { checkoutUrl: url };
    },

    async verify(reference: string) {
      const { res, body } = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
      if (res.status === 404 || (res.ok && body?.status === false)) {
        return { ...toResult(reference, {}), pending: true, message: body?.message ?? 'Not found' };
      }
      if (!res.ok || !body?.data) {
        throw new GatewayError(
          `Paystack could not check the payment (HTTP ${res.status}). Try again.`,
        );
      }
      return toResult(reference, body.data);
    },

    async parseWebhook(rawBody: string, headers: Headers) {
      const signature = headers.get('x-paystack-signature') ?? '';
      if (!sameText(signature.toLowerCase(), await hmacSha512(config.secretKey, rawBody)))
        return null;
      const event = JSON.parse(rawBody) as { event?: string; data?: Tx };
      if (event.event !== 'charge.success' || !event.data) return 'ignored';
      const reference = str(event.data.reference);
      return reference ? toResult(reference, event.data) : 'ignored';
    },
  };
}
