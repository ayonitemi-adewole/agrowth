import { ValueTransformer } from 'typeorm';

/**
 * Money is stored as integer kobo in BIGINT columns. The pg driver returns BIGINT
 * as a string; this keeps it as a JS bigint so arithmetic stays exact.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | null) => (value === null || value === undefined ? value : value.toString()),
  from: (value?: string | null) => (value === null || value === undefined ? value : BigInt(value)),
};

/** NUMERIC columns (hectares, tonnes) come back as strings; convert to number. */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};
