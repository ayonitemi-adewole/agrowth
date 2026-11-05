import { QueryFailedError } from 'typeorm';

/** PostgreSQL error codes the application reacts to. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

interface PgDriverError {
  code?: string;
  constraint?: string;
  message?: string;
}

/** Returns the PostgreSQL error code for a failed query, or undefined for any other error. */
export function pgError(err: unknown): PgDriverError | undefined {
  if (!(err instanceof QueryFailedError)) return undefined;
  return err.driverError as PgDriverError;
}
