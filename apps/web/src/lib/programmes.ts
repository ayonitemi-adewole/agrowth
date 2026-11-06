import type { ProgrammeFigures, ProgrammeKind, ProgrammeStatus, RepaymentMode } from './types';

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

export const PROGRAMME_KIND: Record<ProgrammeKind, string> = {
  input_loan: 'Input loan',
  grant: 'Grant',
};

export const PROGRAMME_STATUS: Record<ProgrammeStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'green' },
  closed: { label: 'Closed', tone: 'violet' },
};

export const REPAYMENT_MODE: Record<RepaymentMode, string> = {
  produce: 'In produce, through the offtaker',
  cash: 'In cash',
  either: 'In produce or cash',
};

/** Recovered ÷ due, 0–1 (or above 1 if more came back), or null when nothing is due yet. */
export function repaymentRate(f: Pick<ProgrammeFigures, 'due_kobo' | 'recovered_kobo'>) {
  const due = Number(f.due_kobo);
  return due > 0 ? Number(f.recovered_kobo) / due : null;
}

/** Tonnes per hectare across farms whose season is over, or null if none is. */
export function yieldPerHa(f: Pick<ProgrammeFigures, 'delivered_kg' | 'harvested_hectares'>) {
  return f.harvested_hectares > 0 ? f.delivered_kg / 1000 / f.harvested_hectares : null;
}

export const formatPct = (v: number | null, digits = 0) =>
  v === null ? '—' : `${(v * 100).toLocaleString('en-NG', { maximumFractionDigits: digits })}%`;

/** Comma-separated values, quoting what needs it, with a header row from `columns`. */
export function toCsv<T>(rows: T[], columns: [header: string, value: (row: T) => unknown][]) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Quote fields with separators or quotes, and defuse spreadsheet formulas.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [
    columns.map(([h]) => cell(h)).join(','),
    ...rows.map((r) => columns.map(([, get]) => cell(get(r))).join(',')),
  ].join('\r\n');
}

/** Saves text as a file in the browser. */
export function download(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  // A byte-order mark so Excel reads ₦ and accented names correctly.
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Kobo (number or string) as plain naira for a spreadsheet: "1250000.50". */
export const csvNaira = (kobo: number | string) => (Math.round(Number(kobo)) / 100).toFixed(2);
