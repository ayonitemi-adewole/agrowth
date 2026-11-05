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

Phase 1 (core platform)Phase 1 (core platform) is feature-complete: a demo cycle can run from draft to released funds. Next is Phase 2 (investor and government editions, vouchers, offl| Area | State |
| ----------------------------------------------------------------------------------------------- | ----- |
| Accounts and roles: sign-up, admin assigns staff roles, deactivation | Done |
| Registry: cooperatives, farmer enrolment with NIN/BVN dedup, KYC review | Done |
| Farm mapping: draw or GPS-walk boundaries, PostGIS validation, ghost-farm overlap check | Done |
| Cycle builder: budget, yield and price ranges, farms, milestones, offtake, insurance, documents | Done |
| Approval: readiness checklist, compliance review, separation of duties | Done |
| Funding: trustee-confirmed deposits, refunds when a cycle misses its deadline or is cancelled | Done |
| Field verification: GPS check-in inside the boundary, checklist, photos; failures block release | Done |
| Disbursement: staged release instructions, 20% cash cap, trustee-confirmed payments | Done |
| Ledger: double-entry, append-only, balanced, no money moving between cycles | Done |
| Harvest, settlement waterfall, statements | Next |

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

Open http://localhost:5173 and create an account. (To use the app on a phone, run `npm run dev:phone` instead; see [Testing field visits on a phone](#testing-field-visits-on-a-phone).)

### 5. Make yourself an admin

Everyone who signs up starts as an investor, and investors can't see the registry. Promote your own account once, in Supabase's **SQL Editor**:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Reload the app. From then on, use the **Users** page to give other staff their roles (field agent, compliance officer and so on) after they sign up.

> **Email confirmation:** by default Supabase emails a confirmation link on sign-up. For quick local testing you can turn it off in **Authentication → Sign In / Providers → Email → Confirm email**. Turn it back on before real users join.

## Running a demo cycle

The Phase 1 gate is "a demo cycle runs". You need several accounts, because the platform separates duties on purpose: whoever builds a cycle can't approve it, and only the trustee can confirm money. Sign up each one, then give them roles on the **Users** page.

| Account            | Role                 | Does                                                        | Email                       |
| ------------------ | -------------------- | ----------------------------------------------------------- | --------------------------- |
| You                | `admin`              | Assigns roles                                               | agrowth.farmlands@gmail.com |
| Field agent        | `field_agent`        | Enrols farmers, maps farms, records verification visits     | damola@agent.test           |
| Compliance officer | `compliance_officer` | Verifies farmer KYC, approves cycles                        | comply@officer.test         |
| Cycle manager      | `cycle_manager`      | Builds the cycle, requests verification, instructs releases | tolu@manager.test           |
| Trustee            | `trustee`            | Confirms deposits and payments, refunds                     | bank@trustee.test           |

### One-click demo sign-in

Add these to `apps/web/.env.local` (never committed) and restart `npm run dev`. The sign-in page then shows a button per account, and the sidebar gets a **Demo: switch account** menu:

```
VITE_DEMO_PASSWORD=the password the demo accounts share
VITE_ADMIN_DEMO_PASSWORD=optional: a different password for the admin account
VITE_DEMO_ACCOUNTS=admin:agrowth.farmlands@gmail.com,field_agent:damola@agent.test,compliance_officer:comply@officer.test,cycle_manager:tolu@manager.test,trustee:bank@trustee.test
```

Any role can have its own password the same way: `VITE_<ROLE>_DEMO_PASSWORD`, for example `VITE_TRUSTEE_DEMO_PASSWORD`. Otherwise the shared one is used.

> The buttons only appear on the development server (`npm run dev` and `npm run dev:phone`). A production build (`npm run build`) leaves the demo accounts and passwords out entirely.

### Testing field visits on a phone

A field visit passes only if the GPS fix is accurate to 20 m and within 20 m of the mapped boundary. Laptops usually report 20–100 m accuracy, so visits from a laptop will (correctly) fail. Use a phone:

1. Run `npm run dev:phone`. It prints a `Network` address such as `https://192.168.0.81:5173`.
2. On a phone on the same Wi-Fi, open that address. Accept the certificate warning: it's a self-signed certificate for local testing. Browsers only share GPS with secure pages.
3. Map the demo farms **around where you are** (step 3 below), so you're standing at the farms when you visit them.

### The walkthrough

The values below fit together: the target fits the per-hectare budget, the milestones add up to the target, the offtake covers the low-yield harvest, and so on. Dates assume you run the demo in November 2026. If you run it later, move every date forward by the same amount, keeping the funding deadline in the future.

**Step 1 — Field agent: create the cooperative** (Cooperatives → New cooperative)

| Field               | Value                           |
| ------------------- | ------------------------------- |
| Name                | Zaria Maize Growers Cooperative |
| Registration number | KD/COOP/2019/0042               |
| Contact phone       | +2348031234567                  |
| State               | Kaduna                          |
| LGA                 | Zaria                           |
| Ward                | Samaru                          |

**Step 2 — Field agent: enrol three farmers** (Farmers → Enrol farmer). Choose the cooperative above for each, and State and LGA fill in automatically.

| Field         | Farmer 1       | Farmer 2        | Farmer 3        |
| ------------- | -------------- | --------------- | --------------- |
| First name    | Amina          | Musa            | Hauwa           |
| Last name     | Ibrahim        | Bello           | Sani            |
| Phone         | +2348030000001 | +2348030000002  | +2348030000003  |
| Gender        | Female         | Male            | Female          |
| Date of birth | 1985-03-14     | 1979-08-02      | 1990-11-21      |
| NIN           | 10000000001    | 10000000002     | _(leave empty)_ |
| BVN           | 22200000001    | _(leave empty)_ | 22200000003     |
| Ward          | Samaru         | Samaru          | Bomo            |

> Try enrolling a fourth farmer with NIN `10000000001`. It's refused as a duplicate, with a link to Amina's record.

**Step 3 — Field agent: map a farm for each farmer** (open the farmer → Map a farm)

Aim for squares about **100 m × 100 m (≈1 ha)**, so the three farms total about 3 ha. Tap four corners in order around the square. To test visits from a phone, press **Find me** first and draw the farms **next to each other around your position**. Farms may share edges but not overlap, so make them meet at a corner where you're standing.

| Field       | Farm 1     | Farm 2     | Farm 3     |
| ----------- | ---------- | ---------- | ---------- |
| Farm name   | North plot | River plot | East plot  |
| Main crop   | maize      | maize      | maize      |
| Land tenure | Owned      | Family     | Leased     |
| Soil notes  | Sandy loam | Clay loam  | Sandy loam |

> Try drawing a fourth farm on top of an existing one. It's refused as land that's already registered.

**Step 4 — Compliance officer: verify KYC.** Open each of the three farmers and press **Verify**.

**Step 5 — Cycle manager: create the cycle** (Funding cycles → New cycle)

| Field                              | Value                                             |
| ---------------------------------- | ------------------------------------------------- |
| Cycle code                         | DEMO-MAIZE-2026-001                               |
| Crop                               | maize                                             |
| Season                             | 2026/27 dry                                       |
| Funded by                          | Investors                                         |
| Cooperative                        | Zaria Maize Growers Cooperative                   |
| Target amount (₦)                  | 1500000                                           |
| Budget per hectare (₦)             | 600000                                            |
| Yield low / expected / high (t/ha) | 2 / 3 / 4                                         |
| Price low / expected / high (₦/t)  | 380000 / 450000 / 520000                          |
| Funding deadline                   | 2026-11-20                                        |
| Season starts                      | 2026-11-25                                        |
| Expected harvest                   | 2027-03-15                                        |
| Notes                              | Irrigated dry-season maize on three family farms. |

> The target can't exceed budget per hectare × mapped hectares. With ₦600,000/ha you need at least 2.5 ha mapped. If your farms are smaller, the readiness checklist tells you the maximum, and you can lower the target to fit (then scale the amounts below to match).

**Step 6 — Cycle manager: add the farms** (Farms tab → Add farms). Tick all three.

**Step 7 — Cycle manager: add milestones** (Milestones tab → Add milestone). They must add up to the target exactly.

| Order | Name                          | Amount (₦) | Planned date | What it pays for                                 |
| ----- | ----------------------------- | ---------- | ------------ | ------------------------------------------------ |
| 1     | Land preparation and planting | 600000     | 2026-11-28   | Ploughing, harrowing, certified seed, basal NPK  |
| 2     | Mid-season inputs             | 540000     | 2027-01-10   | Urea top-dressing, herbicide, irrigation fuel    |
| 3     | Harvest and logistics         | 360000     | 2027-03-10   | Harvest labour, shelling, bags, haulage to buyer |

**Step 8 — Cycle manager: add the offtake agreement** (Offtake & insurance tab → Add agreement). Upload [`docs/demo/sample-offtake-agreement.pdf`](docs/demo/sample-offtake-agreement.pdf).

| Field                     | Value                             |
| ------------------------- | --------------------------------- |
| Buyer                     | Northern Mills Ltd                |
| Buyer contact             | procurement@northernmills.example |
| Commodity                 | maize                             |
| Volume (tonnes)           | 12                                |
| Price terms               | Market price with a floor         |
| Floor price per tonne (₦) | 380000                            |
| Delivery from / until     | 2027-03-15 / 2027-04-15           |
| Signed on                 | 2026-11-05                        |

> The offtake must cover at least the low-yield harvest: 2 t/ha × your hectares (6 t for 3 ha). 12 t covers up to 6 ha.

**Step 9 — Cycle manager: add the insurance policy** (Add policy). Upload [`docs/demo/sample-insurance-policy.pdf`](docs/demo/sample-insurance-policy.pdf).

| Field           | Value                                   |
| --------------- | --------------------------------------- |
| Insurer         | Pula Assurance Nigeria                  |
| Policy number   | PAN-AYI-2026-0457                       |
| Cover type      | Area yield                              |
| Loss payee      | Trustee, on behalf of the cycle funders |
| Sum insured (₦) | 1500000                                 |
| Premium (₦)     | 45000                                   |
| Cover starts    | 2026-11-25                              |
| Cover ends      | 2027-03-31                              |

**Step 10 — Cycle manager: submit.** On the Overview tab, every readiness check should now be green. Press **Submit for approval**.

**Step 11 — Compliance officer: review.** Open the cycle. To see the return path, first press **Return with note** ("Please confirm the cooperative chairman's signature"). Then sign in as the cycle manager, submit again, and sign back in as compliance to **Approve**. The cycle is now _Open for funding_.

**Step 12 — Trustee: record deposits** (Funding tab → Record deposit)

| Funder       | Type     | Amount (₦) | Bank reference | Received on |
| ------------ | -------- | ---------- | -------------- | ----------- |
| Adaeze Okoro | Investor | 900000     | TRX-DEMO-001   | today       |
| Chidi Nwosu  | Investor | 600000     | TRX-DEMO-002   | today       |

> Try recording ₦1 more, or reusing `TRX-DEMO-001`: both are refused. After the second deposit the cycle is _Funded_.

**Step 13 — Cycle manager: request verification.** Milestones tab → milestone 1 → **Request field verification**.

**Step 14 — Field agent: visit each farm** (Field visits → Visit). Use the phone, standing at the farms, or press **Simulate GPS at this farm** for farms you mapped somewhere you can't go. That button appears only on the development server (`npm run dev` / `dev:phone`) and places a ±5 m fix at the farm's centre.

| Field          | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Check in       | Start GPS and wait for "Precise fix", or Simulate GPS at this farm |
| Crop condition | Good                                                               |
| Checklist      | Tick all four                                                      |
| Photos         | Take one of the ground or crop                                     |
| Notes          | Land ploughed and harrowed; seed and NPK delivered.                |

> To see a release being blocked, submit one visit with **Failed** as the crop condition (or from a laptop, where the GPS isn't precise enough). The milestone shows _Blocked_. A passing revisit unblocks it.

**Step 15 — Cycle manager: instruct the release.** Once all three farms have passed, milestone 1 → **Instruct release**. Add three payees that total ₦600,000:

| Payee type       | Payee name              | Bank and account       | Purpose                       | Amount (₦) |
| ---------------- | ----------------------- | ---------------------- | ----------------------------- | ---------- |
| Input vendor     | Zaria Agro Inputs Ltd   | Access Bank 0123456789 | Certified seed and NPK        | 450000     |
| Service provider | Samaru Tractor Hire     | GTBank 0234567891      | Ploughing and harrowing, 3 ha | 90000      |
| Cash to farmers  | Cooperative labour fund | Zenith Bank 0345678912 | Planting labour allowance     | 60000      |

> Cash to farmers is capped at 20% of a milestone (₦120,000 here). Try ₦150,000 cash to see it refused.

**Step 16 — Trustee: confirm payments.** Milestones tab → **Confirm payment** for each payee, with references `PAY-DEMO-001`, `PAY-DEMO-002` and `PAY-DEMO-003`. After the third, milestone 1 is _Released_ and the cycle is _In progress_.

**Step 17 — Check the ledger** (as trustee or compliance: Ledger → DEMO-MAIZE-2026-001). It shows ₦1,500,000 received, ₦600,000 deployed to farms, ₦900,000 still held, and every entry with its bank reference. Repeat steps 13–16 for milestones 2 and 3.

## Tests

```bash
npm test
```

This runs:

- **Database tests** (`supabase/tests`) — the real migrations on an in-memory PostgreSQL with PostGIS ([PGlite](https://pglite.dev)). They sign in as different roles and prove the rules: who can see what, duplicate farmers and overlapping farms refused, a full cycle from draft to released funds, the ledger can't be edited or unbalanced, and so on. No database server needed.
- **Web tests** (`apps/web`) — money, map and error helpers.

## Repository layout

```
apps/
  web/                 React + TypeScript app
    src/
      pages/           One file per screen (pages/cycle/ holds the cycle detail tabs)
      components/      Layout, map, buttons, inputs
      auth/            Sign-in state
      lib/             Supabase client, types, roles, geometry helpers
supabase/
  migrations/          The database, in order: foundation, registry, ledger, cycle builder, funding and disbursement
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
- **Offtake first, insured downside, verified farmers.** A cycle can't be submitted, or approved, until a signed buyer covers at least the low-yield harvest, insurance covers the budget for the whole season, and every farmer has passed KYC.
- **Separation of duties.** The cycle's own manager can never approve it. Only the trustee confirms deposits, payments and refunds.
- **Money follows verification.** A milestone is released only after every farm passes a field visit (GPS inside the boundary, checklist, photo), in order, and at most 20% may go to farmers as cash. The trustee can't pay out more than it holds for that cycle.
- **Evidence is permanent.** Cycle history and field visits are append-only, and uploaded documents can't be replaced or deleted.
