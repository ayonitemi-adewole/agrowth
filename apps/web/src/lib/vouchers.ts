/** "ABCDEFGHJKLM" → "ABCD-EFGH-JKLM", the way codes are printed and read out. */
export const formatVoucherCode = (code: string) =>
  normaliseVoucherCode(code).replace(/(.{4})(?=.)/g, '$1-');

/** Accepts codes as typed at the counter: any case, with spaces or dashes. */
export const normaliseVoucherCode = (input: string) =>
  input.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A complete code is 12 letters and digits, without 0, O, 1 or I. */
export const isVoucherCode = (input: string) =>
  /^[A-HJ-NP-Z2-9]{12}$/.test(normaliseVoucherCode(input));

/**
 * What a voucher slip's QR code holds: a link to the Redeem page with the voucher's scan
 * token, so a phone's own camera opens the voucher straight away.
 */
export const voucherScanUrl = (token: string, origin: string) =>
  `${origin}/redeem?v=${encodeURIComponent(token)}`;

/**
 * The scan token in whatever a scanner read: the slip's link (from any address) or the
 * bare token. Null for anything else, such as a QR code that isn't a voucher.
 */
export function scanTokenFrom(scanned: string): string | null {
  const text = scanned.trim();
  let token: string | null = null;
  try {
    token = new URL(text).searchParams.get('v');
  } catch {
    token = text;
  }
  return token && /^[A-Za-z0-9]{24}$/.test(token) ? token.toUpperCase() : null;
}
