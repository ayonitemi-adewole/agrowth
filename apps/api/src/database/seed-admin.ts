import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Role } from '../common/role.enum';
import { UsersService } from '../users/users.service';

/**
 * Creates the first admin account. Everyone else is created by that admin
 * (staff) or signs up themselves (investors).
 */
async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 10) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (10+ characters) first');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const users = app.get(UsersService);
    if (await users.findByEmailWithPassword(email)) {
      console.log(`Admin ${email} already exists — nothing to do.`);
      return;
    }
    await users.create({ email, password, fullName: 'Platform Admin', role: Role.Admin });
    console.log(`Created admin ${email}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
