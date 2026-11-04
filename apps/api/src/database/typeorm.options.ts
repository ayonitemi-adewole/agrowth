import { join } from 'node:path';
import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from '../common/naming-strategy';

/**
 * Shared by the running app and the migration CLI so both see the same schema.
 * `synchronize` is always off: every schema change goes through a reviewed migration.
 */
export function buildTypeOrmOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    uuidExtension: 'pgcrypto',
    migrationsTransactionMode: 'each',
  };
}
