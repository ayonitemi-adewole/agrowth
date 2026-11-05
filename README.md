# Agrowth 2.0

A platform that makes farm investment verifiable. Money is held by a licensed trustee, released in stages as farm inputs, and repaid from pre-contracted harvest sales. One shared core powers two editions:

- **Investor Edition** — for SEC-registered operators offering farm cycles to investors.
- **Government Edition** — for ministries, agencies and donor programmes running input-credit schemes.

Read the full concept in [`docs/agrowth-2.0-concept.md`](docs/agrowth-2.0-concept.md). The original Agrowth 1.0 app is preserved on the [`legacy-v1`](../../tree/legacy-v1) branch.

## How it's built

| Part           | Technology                                           | Where                 |
| -------------- | ---------------------------------------------------- | --------------------- |
| Web app        | React + TypeScript, Vite, Tailwind, React Router     | `apps/web`            |
| Maps           | Leaflet (OpenStreetMap and satellite imagery)        | `apps/web`            |
| Database       | Supabase (PostgreSQL + PostGIS)                      | `supabase`            |
| Sign-in        | Supabase Auth (email and password)                   | —                     |
| Business rules | SQL migrations: tables, security policies, functions | `supabase/migrations` |

The browser talks to Supabase directly. That's safe because **every rule lives in the database**: row-level security decides what each role can see or change, and the important actions (enrolling a farmer, mapping a farm, posting money) are database functions that check permissions and data before writing anything.

## Status

Phase 1 (core platform) is in progress.

| Area                                                                                    | State   |
| --------------------------------------------------------------------------------------- | ------- |
| Accounts and roles: sign-up, admin assigns staff roles, deactivation                    | Done    |
| Registry: cooperatives, farmer enrolment with NIN/BVN dedup, KYC review                 | Done    |
| Farm mapping: draw or GPS-walk boundaries, PostGIS validation, ghost-farm overlap check | Done    |
| Ledger: double-entry, append-only, balanced, no money moving between cycles             | Done    |
| Cycle builder, offtake contracts                                                        | Next    |
| Disbursement engine                                                                     | Planned |

## Getting started

You need **Node.js 22 or newer** and a free **Supabase** account. No local database or Docker is needed.

### 1. Create a Supabase project

1. Sign in at [supabase.com](https://supabase.com) and click **New project**.
2. Pick a name and region, and set a **database password** — save it somewhere safe.
3. When the project is ready, open **Project Settings → General** and copy the **Project ID** (a short code like `abcdefghijklmnop`).

### 2. Set up the database

From the repo root:

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_ID     # asks for the database password
npx supabase db push                                # creates all tables, rules and functions
```

> If you prefer clicking: open **SQL Editor** in Supabase and run each file in `supabase/migrations` in order (oldest first). `db push` is better, because it remembers which migrations have already run.

### 3. Connect the web app

```bash
cp apps/web/.env.example apps/web/.env.local
```

In Supabase, open **Project Settings → API Keys** and copy the **Project URL** and the **publishable key** into `apps/web/.env.local`.

### 4. Run it

```bash
npm run dev
```

Open http://localhost:5173 and create an account.

### 5. Make yourself an admin

Everyone who signs up starts as an investor, and investors can't see the registry. Promote your own account once, in Supabase's **SQL Editor**:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Reload the app. From then on, use the **Users** page to give other staff their roles (field agent, compliance officer and so on) after they sign up.

> **Email confirmation:** by default Supabase emails a confirmation link on sign-up. For quick local testing you can turn it off in **Authentication → Sign In / Providers → Email → Confirm email**. Turn it back on before real users join.

## Tests

```bash
npm test
```

This runs:

- **Database tests** (`supabase/tests`) — the real migrations on an in-memory PostgreSQL with PostGIS ([PGlite](https://pglite.dev)). They sign in as different roles and prove the rules: who can see what, duplicate farmers refused, overlapping farms refused, the ledger can't be edited or unbalanced, and so on. No database server needed.
- **Web tests** (`apps/web`) — map and error helpers.

## Repository layout

```
apps/
  web/                 React + TypeScript app
    src/
      pages/           One file per screen
      components/      Layout, map, buttons, inputs
      auth/            Sign-in state
      lib/             Supabase client, types, roles, geometry helpers
supabase/
  migrations/          The database, in order: foundation, registry, cycles and ledger
  tests/               Tests that run the migrations and check every rule
  config.toml          Supabase CLI settings
docs/                  Concept and design documents
```

## Changing the database

Never edit a migration that has already been pushed. Add a new file instead:

```bash
npx supabase migration new describe_your_change    # creates supabase/migrations/<timestamp>_describe_your_change.sql
# write the SQL, add a test in supabase/tests, run npm test
npx supabase db push
```

## Design rules enforced in the database

- **No platform custody.** The ledger records what the trustee holds; the platform never holds funds.
- **Money is integer kobo** (`bigint`), never floating point. Balances are returned as text so no precision is lost.
- **The ledger is append-only.** Triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on journal tables, even for the database owner. Mistakes are fixed with reversing entries.
- **Every entry balances.** Lines must sum to zero, checked when the transaction commits.
- **No recycling.** An entry can only touch its own cycle's accounts (plus platform-level accounts such as fees), so one cycle's money can never pay another cycle's investors.
- **Nobody posts money through the API**, not even admins. Only internal functions (funding, disbursement, settlement) can.
- **Identity numbers are never stored.** BVN and NIN are kept only as keyed hashes (key held in Supabase Vault) plus the last four digits. The hashes are in a schema the API can't reach.
- **One farmer, one record; one piece of land, one farm.** Enrolment needs a NIN or BVN, and a repeat is refused. A boundary that overlaps a registered farm by more than 5% of the smaller farm is refused.
- **Farm area is computed by the database** from the mapped boundary; invalid polygons are rejected.
- **Boundaries are locked while a cycle is live**, from approval through harvest.
- **Roles come from the database, never the browser.** Sign-up always creates an investor; only an admin can grant staff roles, and nobody can change their own.
