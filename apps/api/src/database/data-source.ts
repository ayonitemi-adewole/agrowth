import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm.options';

// Used by the TypeORM CLI (migrations). Reads DATABASE_URL from .env if present.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set');
}

export default new DataSource(buildTypeOrmOptions(url));
