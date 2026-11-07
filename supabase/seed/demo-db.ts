/**
 * npm run demo:push   — applies new migrations to the demo project.
 * npm run demo:reset  — wipes the demo project back to the migrations, ready to re-seed.
 *
 * Both target SUPABASE_DB_URL from supabase/.env.demo (the demo project's session pooler
 * URL), never the project the Supabase CLI is linked to, so they can't touch dev data.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const action = process.argv[2];
if (action !== 'push' && action !== 'reset') {
  console.error('Usage: demo-db.ts push|reset');
  process.exit(1);
}

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) {
  console.error(
    'Missing SUPABASE_DB_URL in supabase/.env.demo.\n' +
      'In the demo project: Connect → Connection String → Session pooler. Put in the database password.',
  );
  process.exit(1);
}
const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).host;

if (action === 'reset' && !process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This deletes ALL data in the demo database at ${host} and re-applies the migrations.\n` +
      'Type "reset" to continue: ',
  );
  rl.close();
  if (answer.trim() !== 'reset') {
    console.log('Cancelled.');
    process.exit(0);
  }
}

const args =
  action === 'push'
    ? ['supabase', 'db', 'push', `--remote=${url}`, '--yes']
    : ['supabase', 'db', 'reset', `--remote=${url}`, '--no-seed', '--yes'];

console.log(
  `${action === 'push' ? 'Pushing migrations to' : 'Resetting'} the demo database at ${host}`,
);
// No shell: database passwords often contain characters a shell would rewrite (^ & % on
// Windows). On Windows npx is a .cmd file that can't run without one, so run npm's own
// npx script with Node instead.
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const [command, prefix] =
  process.platform === 'win32' && existsSync(npxCli) ? [process.execPath, [npxCli]] : ['npx', []];
const result = spawnSync(command, [...prefix, ...args], {
  stdio: 'inherit',
  env: { ...process.env, SUPABASE_YES: '1' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
if (action === 'reset') console.log('\nDone. Now run: npm run seed:demo');
