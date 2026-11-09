/**
 * CBN/NIBSS codes of common Nigerian banks, which Paystack uses to address transfers.
 * Names are matched loosely ("GTBank", "Guaranty Trust Bank"). A bank not listed can't be
 * paid through the gateway; the trustee pays it from its bank.
 *
 * The web app keeps the same list (apps/web/src/lib/bankfiles.ts) for payment files.
 */
const BANKS: [code: string, pattern: RegExp][] = [
  ['044', /\baccess\b/],
  ['023', /\bciti/],
  ['050', /\becobank\b/],
  ['070', /\bfidelity\b/],
  ['011', /\bfirst ?bank\b|\bfirst bank of nigeria\b|^fbn\b/],
  ['214', /\bfcmb\b|first city monument/],
  ['058', /\bgt ?bank\b|\bguaranty trust\b|\bgtco\b/],
  ['030', /\bheritage\b/],
  ['301', /\bjaiz\b/],
  ['082', /\bkeystone\b/],
  ['076', /\bpolaris\b/],
  ['101', /\bprovidus\b/],
  ['221', /\bstanbic\b/],
  ['068', /\bstandard chartered\b/],
  ['232', /\bsterling\b/],
  ['100', /\bsuntrust\b/],
  ['102', /\btitan\b/],
  ['032', /\bunion bank\b/],
  ['033', /\buba\b|\bunited bank for africa\b/],
  ['215', /\bunity\b/],
  ['035', /\bwema\b|\balat\b/],
  ['057', /\bzenith\b/],
  // Mobile money and digital banks, where many farmers keep their money.
  ['999992', /\bopay\b|\bpaycom\b/],
  ['999991', /\bpalm ?pay\b/],
  ['50515', /\bmoniepoint\b/],
  ['50211', /\bkuda\b/],
];

export function bankCode(bankName: string | null | undefined): string | null {
  const name = (bankName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return BANKS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 1 &&
        !['ltd', 'limited', 'plc', 'nig', 'nigeria', 'enterprises', 'ent', 'and'].includes(w),
    );

/**
 * Is the account held by the payee? Banks hold names in their own order and spelling
 * ("OKORO ADAEZE C"), so it's a match when two of the payee's words are in the bank's
 * name (or the only one, for a one-word name).
 */
export function sameAccountHolder(expected: string, resolved: string): boolean {
  const want = [...new Set(words(expected))];
  const have = new Set(words(resolved));
  const found = want.filter((w) => have.has(w)).length;
  return want.length > 0 && found >= Math.min(2, want.length);
}
