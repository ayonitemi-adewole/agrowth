import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = await NestFactory.create(AppModule);
  setupApp(app, { swagger: process.env.NODE_ENV !== 'production' });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Agrowth API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
