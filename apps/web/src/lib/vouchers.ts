/** "ABCDEFGHJKLM" → "ABCD-EFGH-JKLM", the way codes are printed and read out. */
export const formatVoucherCode = (code: string) =>
  normaliseVoucherCode(code).replace(/(.{4})(?=.)/g, '$1-');

/** Accepts codes as typed at the counter: any case, with spaces or dashes. */
export const normaliseVoucherCode = (input: string) =>
  input.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A complete code is 12 letters and digits, without 0, O, 1 or I. */
export const isVoucherCode = (input: string) =>
  /^[A-HJ-NP-Z2-9]{12}$/.test(normaliseVoucherCode(input));
