import type { CheckStatus, Claimed, FieldResults, ProviderRecord } from './types.ts';

/** Lower case, accents and punctuation removed, split into words. */
export function nameWords(name: string | null | undefined): string[] {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date as YYYY-MM-DD, or null if it can't be read. Providers send dates as
 * 1990-04-21, 21-04-1990, 21/04/1990 or 21-Apr-1990.
 */
export function isoDate(value: string | null | undefined): string | null {
  const s = (value ?? '').trim();
  let y: string, m: string, d: string;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [, y, m, d] = match;
  else if ((match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) [, d, m, y] = match;
  else if ((match = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{4})$/))) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    if (!month) return null;
    [d, m, y] = [match[1], String(month), match[3]];
  } else return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** The last ten digits, so +2348031234567 and 08031234567 compare equal. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

const subset = (words: string[], of: string[]) =>
  words.length > 0 && words.every((w) => of.includes(w));

/**
 * Compares what we hold with the provider's record.
 *
 * - Farmers: the first name must be among the record's first and middle names (people
 *   often enrol under either), and the last name must match.
 * - Investors give one legal name: it must contain the record's first and last names.
 * - Date of birth and phone are compared when both sides have them.
 *
 * Both names match and nothing compared differs: match. A name differs entirely: no_match.
 * Anything in between: partial, for compliance to judge.
 */
export function compare(
  claimed: Claimed,
  record: ProviderRecord,
): { status: CheckStatus; fields: FieldResults } {
  const recFirst = nameWords(record.first_name);
  const recLast = nameWords(record.last_name);
  const recGiven = [...recFirst, ...nameWords(record.middle_name)];

  let first: boolean;
  let last: boolean;
  if (claimed.first_name && claimed.last_name) {
    first = subset(nameWords(claimed.first_name), recGiven);
    last = subset(nameWords(claimed.last_name), recLast);
  } else {
    const full = nameWords(claimed.full_name);
    first = subset(recFirst, full);
    last = subset(recLast, full);
  }

  const claimedDob = isoDate(claimed.date_of_birth);
  const recordDob = isoDate(record.date_of_birth);
  const dob = claimedDob && recordDob ? claimedDob === recordDob : null;

  const claimedPhone = phoneKey(claimed.phone);
  const recordPhones = record.phones.map(phoneKey).filter((p): p is string => p !== null);
  const phone =
    claimedPhone && recordPhones.length > 0 ? recordPhones.includes(claimedPhone) : null;

  const fields: FieldResults = { first_name: first, last_name: last, date_of_birth: dob, phone };
  const status: CheckStatus =
    !first && !last
      ? 'no_match'
      : first && last && dob !== false && phone !== false
        ? 'match'
        : 'partial';
  return { status, fields };
}
