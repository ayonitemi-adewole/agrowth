export const formatHectares = (ha: number | string) =>
  `${Number(ha).toLocaleString('en-NG', { maximumFractionDigits: 2 })} ha`;

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : '—';

export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

/** Quotes a value for a PostgREST filter, so commas and brackets in search text are safe. */
export const filterValue = (s: string) => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;
