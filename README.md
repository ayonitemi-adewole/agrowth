# Agrowth 2.0

A platform that makes farm investment verifiable. Money is held by a licensed trustee, released in stages as farm inputs, and repaid from pre-contracted harvest sales. One shared core powers two editions:

- **Investor Edition** — for SEC-registered operators offering farm cycles to investors.
- **Government Edition** — for ministries, agencies and donor programmes running input-credit schemes.

Read the full concept in [`docs/agrowth-2.0-concept.md`](docs/agrowth-2.0-concept.md). The original Agrowth 1.0 app is preserved on the [`legacy-v1`](../../tree/legacy-v1) branch.

## Status

Phase 1 (core platform) is in progress.

| Area                                                                                      | State   |
| ----------------------------------------------------------------------------------------- | ------- |
| Monorepo, API skeleton, config, health check, API docs                                    | Done    |
| Database schema: users, cooperatives, farmers, farms, cycles, milestones, offtake, ledger | Done    |
| Ledger integrity rules in PostgreSQL (balanced, append-only, no cross-cycle money)        | Done    |
| Auth: investor sign-up, login, admin-created staff, role-based access                     | Done    |
| Registry API (farmers, cooperatives, farm mapping)                                        | Next    |
| Cycle builder, offtake contracts, disbursement engine                                     | Planned |

## Repository layout

```
apps/
  api/            NestJS API (TypeScript), PostgreSQL + PostGIS via TypeORM
    src/
      auth/       Sign-up, login, JWT, role guards
      users/      Accounts and staff management
      registry/   Cooperatives, farmers, farms (boundaries in PostGIS)
      cycles/     Funding cycles, milestones, offtake contracts
      ledger/     Double-entry ledger (read-only API; posted by internal flows)
      database/   Migrations, CLI data source, admin seed
    test/         End-to-end tests against a real database
docs/             Concept and design documents
```

## Running locally

You need Node.js 22+ and Docker (or your own PostgreSQL 16 with PostGIS 3).

```bash
npm install
docker compose up -d db

cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET, PII_HASH_PEPPER, SEED_ADMIN_PASSWORD

cd apps/api
npm run migration:run
npm run seed:admin
npm run dev
```

The API runs at `http://localhost:3000/api/v1`. Interactive API docs are at `http://localhost:3000/api/docs`.

## Tests

```bash
npm test                 # unit tests
npm run test:e2e         # end-to-end tests; needs PostgreSQL + PostGIS
```

End-to-end tests wipe and rebuild the database at `TEST_DATABASE_URL` (default `postgres://agrowth:agrowth@localhost:5432/agrowth_test`). Never point it at a database you care about.

## Design rules enforced in code

- **No platform custody.** The ledger records what the trustee holds; the platform never holds funds.
- **Money is integer kobo** (`BIGINT`), never floating point. Amounts go to clients as strings.
- **The ledger is append-only.** PostgreSQL triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on journal tables. Mistakes are fixed with reversing entries.
- **Every entry balances.** Lines must sum to zero, checked by the database when the transaction commits.
- **No recycling.** An entry can only touch its own cycle's accounts (plus platform-level accounts such as fees), so one cycle's money can never pay another cycle's investors.
- **Identity numbers are never stored.** BVN and NIN are kept only as keyed hashes (for deduplication) plus the last four digits.
- **Farm area is computed by the database** from the mapped boundary; invalid polygons are rejected.
- **Every schema change is a reviewed migration.** `synchronize` is always off.
