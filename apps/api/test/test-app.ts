import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildTypeOrmOptions } from '../src/database/typeorm.options';
import { setupApp } from '../src/setup-app';

/**
 * End-to-end tests run against a real PostgreSQL + PostGIS database, because the most
 * important rules (balanced, append-only ledger) live in the database itself.
 * Set TEST_DATABASE_URL to a throwaway database — it is wiped on every run.
 * Environment defaults are set in env-setup.ts, before any module is imported.
 */
export async function resetDatabase(): Promise<void> {
  const ds = new DataSource(buildTypeOrmOptions(process.env.TEST_DATABASE_URL!));
  await ds.initialize();
  try {
    await ds.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.runMigrations();
  } finally {
    await ds.destroy();
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return app;
}
