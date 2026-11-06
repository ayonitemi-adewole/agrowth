/**
 * npm run seed:demo — fills a Supabase project with the demo portfolio.
 *
 * Reads supabase/.env.demo (see .env.demo.example). Use a project set aside for demos:
 * the seed creates accounts that share one password, and its records can't be deleted
 * (the ledger and history are append-only), only wiped with a database reset.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isSeeded, seedDemo } from './seed.ts';
import { supabaseApi } from './supabase-api.ts';

const env = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim() || (fallback && process.env[fallback]?.trim());
  if (!value) {
    console.error(
      `Missing ${name}. Copy supabase/.env.demo.example to supabase/.env.demo and fill it in.`,
    );
    process.exit(1);
  }
  return value;
};

const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
const publishableKey = env('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
const secretKey = env('SUPABASE_SECRET_KEY');
const password = env('DEMO_PASSWORD');
if (password.length < 8) {
  console.error('DEMO_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This adds the demo portfolio and demo accounts to ${url}.\n` +
      'Its records are permanent (only a database reset removes them). Type "seed" to continue: ',
  );
  rl.close();
  if (answer.trim() !== 'seed') {
    console.log('Cancelled.');
    process.exit(0);
  }
}

const api = supabaseApi({ url, publishableKey, secretKey });
if (await isSeeded(api)) {
  console.error(
    'This project already has the demo data. To start again, reset it first:\n' +
      '  npm run demo:reset\n' +
      'then run npm run seed:demo again.',
  );
  process.exit(1);
}

const docs = join(import.meta.dirname, '..', '..', 'docs', 'demo');
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`.padStart(5);

try {
  const result = await seedDemo(api, {
    password,
    offtakePdf: readFileSync(join(docs, 'sample-offtake-agreement.pdf')),
    insurancePdf: readFileSync(join(docs, 'sample-insurance-policy.pdf')),
    log: (message) => console.log(`${elapsed()}  ${message}`),
  });

  console.log(`\nSeeded ${result.farmers} farmers and ${result.cycles.length} cycles:`);
  for (const c of result.cycles)
    console.log(`  ${c.code.padEnd(20)} ${c.stage.replace(/_/g, ' ')}`);
  console.log('\nDemo accounts (all share DEMO_PASSWORD):');
  for (const a of result.accounts)
    console.log(`  ${a.role.padEnd(19)} ${a.email.padEnd(28)} ${a.fullName}`);
  console.log(
    '\nFor one-click sign-in, put these in apps/web/.env.local:\n' +
      `  VITE_DEMO_PASSWORD=${password}\n` +
      `  VITE_DEMO_ACCOUNTS=${result.accounts.map((a) => `${a.role}:${a.email}`).join(',')}`,
  );
} catch (err) {
  console.error(`\nThe seed stopped: ${(err as Error).message}`);
  console.error('Whatever was created before the error stays. Reset the project and run it again.');
  process.exit(1);
}
