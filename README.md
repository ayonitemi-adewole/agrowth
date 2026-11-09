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

Phase 1 (core platform) is feature-complete: a demo cycle runs from draft through harvest to a settled, closed ledger. Phase 2 has added the vendor network, input vouchers, the Investor Edition portal, the Government Edition's programmes and dashboards, and an installable agent app that records field visits offline. Live integrations are under way: identity checks, the trustee's bank files, online pledge payments and weather per farm are built. USSD/SMS and the security audit have moved to Phase 3, which is on hold.

| Area                                                                                                                                                                               | State |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Accounts and roles: sign-up, admin assigns staff roles, deactivation                                                                                                               | Done  |
| Registry: cooperatives, farmer enrolment with NIN/BVN dedup, KYC review                                                                                                            | Done  |
| Identity checks: NIN and BVN looked up with an identity provider (Dojah adapter, or simulated), KYC verification needs a match or a written reason                                 | Done  |
| Farm mapping: draw or GPS-walk boundaries, PostGIS validation, ghost-farm overlap check                                                                                            | Done  |
| Cycle builder: budget, yield and price ranges, farms, milestones, offtake, insurance, documents                                                                                    | Done  |
| Approval: readiness checklist, compliance review, separation of duties                                                                                                             | Done  |
| Funding: trustee-confirmed deposits, refunds when a cycle misses its deadline or is cancelled                                                                                      | Done  |
| Field verification: GPS check-in inside the boundary, checklist, photos; failures block release                                                                                    | Done  |
| Disbursement: staged release instructions, 20% cash cap, trustee-confirmed payments                                                                                                | Done  |
| Ledger: double-entry, append-only, balanced, no money moving between cycles                                                                                                        | Done  |
| Weather per farm: daily rainfall and temperatures from Open-Meteo for every farm in a live cycle, against the 10-year normal; dry, wet, heavy-rain and heat flags                  | Done  |
| Online payments: investors pay pledges through Paystack (or a simulated gateway), settled to the trustee and confirmed by webhook                                                  | Done  |
| Trustee bank files: bulk-payment files for the trustee's bank, statement imports that confirm payments and pledge payments by reference                                            | Done  |
| Harvest: weighed and graded deliveries per farm, voids with a reason                                                                                                               | Done  |
| Settlement: offtake and insurance receipts, fee → capital → profit-share waterfall, payouts, funder statements                                                                     | Done  |
| Vendors: agro-dealer registry, compliance approval, re-review on bank changes, counter sign-ins                                                                                    | Done  |
| Vouchers: issued per farm by area, redeemed by code + phone, vendors paid on redemption, unused value returned                                                                     | Done  |
| Investor Edition: investor KYC and classification, retail cap, risk disclosure, pledges with cooling-off, live tracker, statements, certificates                                   | Done  |
| Government Edition: programmes with eligibility and budgets, dashboards by state, LGA, ward, commodity and cooperative, repayment, agent visit record, audit and open-data exports | Done  |
| Offline agent app: installable on a phone's home screen, work list saved on the phone, visits and photos queued with no signal and sent when back in coverage                      | Done  |

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

Then deploy the identity check, the Edge Function that looks up NINs and BVNs:

```bash
npx supabase functions deploy identity-check
```

Out of the box it uses a **simulated provider**, so no keys are needed, and the app labels its answers _Simulated_. It treats every number as belonging to the person who gave it, except numbers ending in `0000` (not found), `1111` (someone else's), `2222` (name matches, date of birth and phone don't) and `9999` (provider unavailable). To use **Dojah**, copy `supabase/functions/.env.example` to `supabase/functions/.env`, set `IDENTITY_PROVIDER=dojah` and your keys (`DOJAH_BASE_URL=https://sandbox.dojah.io` for sandbox keys), then:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

Without the function, enrolment and KYC still work; the checks just can't run, so compliance must write down why it's verifying anyone.

**Online payments** (optional) let investors pay a pledge by card, bank transfer or USSD through a payment gateway instead of a bank transfer. They are off until `PAYMENTS_PROVIDER` is set in `supabase/functions/.env`:

- `PAYMENTS_PROVIDER=mock` uses a simulated gateway, a checkout page in the app where no money moves. The database also refuses simulated payments until an admin allows them: `update public.investor_settings set allow_simulated_payments = true;` (the demo seed does this).
- `PAYMENTS_PROVIDER=paystack` with `PAYSTACK_SECRET_KEY` (`sk_test_…` to test) uses Paystack. In the Paystack dashboard, set the **settlement account to the trustee's escrow account**, so the money never sits with the platform, and set the webhook URL to `https://YOUR_PROJECT_ID.supabase.co/functions/v1/payments-webhook`.

```bash
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy payments
npx supabase functions deploy payments-webhook --no-verify-jwt
```

The gateway's fee is added on top of the pledge, so the trustee receives it in full.

**Weather** for every farm in a live cycle comes from [Open-Meteo](https://open-meteo.com), which needs no key or sign-up:

```bash
npx supabase functions deploy weather-sync
```

Then refresh it daily. In Supabase, open **Integrations → Cron → Create job**, run it once a day (e.g. `0 5 * * *`), and choose **Supabase Edge Function** → `weather-sync` (POST, body `{}`). Staff can also press **Refresh weather** on a cycle's Weather tab. Open-Meteo's free API is for non-commercial use: for a commercial operation, take a subscription and set `OPEN_METEO_API_KEY` as a secret.

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

## The demo portfolio (one command)

For showing Agrowth to customers, one command fills a Supabase project with a lived-in portfolio, so every screen has something real on it:

- 4 cooperatives in Kaduna, Kano and Benue, 43 farmers with mapped farms, KYC verified, pending and rejected, each with simulated identity checks (matches, partial matches awaiting review, and a number that belongs to someone else)
- 9 funding cycles, one at every stage, and a state wheat programme running two of them:

| Stage             | Cycle                        | What it shows                                                                                              |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Settled           | Zaria maize, wet season      | A full season closed: funders +16%, farmers paid their surplus by kilogram                                 |
| Settled           | Makurdi soybean, wet season  | A drought year: the insurance claim returned the funders' capital, +0.9%                                   |
| Settled           | Kura wheat, last dry season  | The wheat programme's first season: input credit repaid in full; one farm short after a pump failure       |
| Harvested         | Kura rice, wet season        | Harvest in and paid for; the trustee runs the settlement live                                              |
| In progress       | Zaria maize, dry season      | Inputs paid as vouchers redeemed at an agro-dealer; a release blocked by a check-in 270 m outside the farm |
| Funded            | Kura wheat, dry season       | The same farms' second programme season; field visits under way                                            |
| Open for funding  | Makurdi soybean, next season | 55% raised; a retail investor's pledge in cooling-off; the trustee records a deposit live                  |
| Awaiting approval | Ikara sorghum, next season   | Blended funding; compliance approves it live                                                               |
| Draft             | Makurdi soybean expansion    | The readiness checklist with two checks failing                                                            |

Every record goes through the same database functions and security rules as the app, signed in as the demo user whose job it is. The seed is also a test (`supabase/tests/seed.test.ts`), so it can't drift from the rules.

**Use a separate Supabase project for this.** The demo accounts share one password, and the records are permanent: the ledger and history are append-only, so only a database reset removes them.

1. Create a new Supabase project (see [Getting started](#getting-started)). Don't `supabase link` it: the CLI stays linked to your development project, and the demo commands below find the demo project from its own settings.
2. Copy `supabase/.env.demo.example` to `supabase/.env.demo` and fill in the demo project's URL, publishable key and **secret key** (Project Settings → API Keys), its **session pooler URL** (Connect → Connection String → Session pooler, with the database password filled in), and a password for the demo accounts. The file is git-ignored; never commit it.
3. Create the tables, rules and functions, and deploy the Edge Functions. On the demo, identity checks and online payments run simulated, so visitors can try them without any keys; the weather is real:
   ```bash
   npm run demo:push
   npx supabase secrets set PAYMENTS_PROVIDER=mock --project-ref DEMO_PROJECT_ID
   npx supabase functions deploy identity-check --project-ref DEMO_PROJECT_ID
   npx supabase functions deploy payments --project-ref DEMO_PROJECT_ID
   npx supabase functions deploy payments-webhook --no-verify-jwt --project-ref DEMO_PROJECT_ID
   npx supabase functions deploy weather-sync --project-ref DEMO_PROJECT_ID
   ```
   After seeding, open any live cycle's **Weather** tab and press **Refresh weather** once (or set up the daily job described under Getting started).
4. Run:
   ```bash
   npm run seed:demo
   ```
   It asks you to confirm, takes a few minutes, and prints the accounts and the lines to paste into `apps/web/.env.local` for one-click sign-in.

The demo accounts are `manager@agrowth.test` (cycle manager), `agent@agrowth.test` and `agent.benue@agrowth.test` (field agents), `compliance@agrowth.test`, `trustee@agrowth.test`, `auditor@agrowth.test`, `vendor@agrowth.test` (the counter at Zaria Agro Inputs, an approved agro-dealer), `programme@agrowth.test` (programme manager for the Kano wheat programme) and `admin@agrowth.test`. Five agro-dealers are registered; one is waiting for compliance approval.

Three investor accounts use the Investor Edition portal. `investor@agrowth.test` (Adaeze Okoro, high-net-worth) invested in both Zaria maize cycles through the portal, so she has a paid-out statement and a live cycle to track. `investor.retail@agrowth.test` (Funmilayo Adeleke, retail, capped at 10% of income) has a pledge to the open soybean cycle that is still in its 48-hour cooling-off. `investor.new@agrowth.test` (Emeka Obi) is waiting for compliance to check his KYC.

Dates are relative to the day you seed, so the demo always looks current. Business dates (deposits, deliveries, receipts, planned dates) tell a realistic season; the History tab shows when the seed ran. To start again: `npm run demo:reset` (it asks you to type `reset`), then `npm run seed:demo`. After adding a migration, `npm run demo:push` applies it to the demo project. These commands only ever touch the demo project; never use `--linked` or `--remote` on their own for the demo, because they point at your development project.

The field visit photos are labelled illustrations with the visit's GPS stamp, not real photographs.

### A hosted demo link

To give prospects a link they can open themselves, deploy the web app against the demo project. The repo includes a `vercel.json`, so on [Vercel](https://vercel.com): **Add New → Project**, import this repository, and set these environment variables:

| Variable                        | Value                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | The demo project's URL                                                                                                                                                                              |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The demo project's publishable key (never the secret key)                                                                                                                                           |
| `VITE_DEMO_MODE`                | `true`                                                                                                                                                                                              |
| `VITE_DEMO_PASSWORD`            | The demo accounts' password                                                                                                                                                                         |
| `VITE_DEMO_ACCOUNTS`            | `cycle_manager:manager@agrowth.test,field_agent:agent@agrowth.test,compliance_officer:compliance@agrowth.test,trustee:trustee@agrowth.test,auditor:auditor@agrowth.test,vendor:vendor@agrowth.test` |

`VITE_DEMO_MODE=true` makes a production build keep the role buttons and **Simulate GPS at this farm**, lead the sign-in page with "Explore the demo", hide self sign-up, and show a "sample portfolio" banner. A build without it contains no demo accounts or passwords.

Leave the admin account out of a public demo: an admin can change other accounts' roles. Visitors share one environment and see each other's changes; reset and re-seed before an important meeting.

## Running a demo cycle

This walks one cycle through its whole life by hand, on an empty project. (For a ready-made portfolio, use the [demo seed](#the-demo-portfolio-one-command) instead.) You need several accounts, because the platform separates duties on purpose: whoever builds a cycle can't approve it, and only the trustee can confirm money. Sign up each one, then give them roles on the **Users** page.

| Account            | Role                 | Does                                                        | Email                       |
| ------------------ | -------------------- | ----------------------------------------------------------- | --------------------------- |
| You                | `admin`              | Assigns roles                                               | agrowth.farmlands@gmail.com |
| Field agent        | `field_agent`        | Enrols farmers, maps farms, records verification visits     | damola@agent.test           |
| Compliance officer | `compliance_officer` | Verifies farmer KYC, approves cycles                        | comply@officer.test         |
| Cycle manager      | `cycle_manager`      | Builds the cycle, requests verification, instructs releases | tolu@manager.test           |
| Trustee            | `trustee`            | Confirms deposits and payments, refunds                     | bank@trustee.test           |
| Agro-dealer        | `vendor`             | Redeems farmers' input vouchers at the shop counter         | counter@zariaagro.test      |

### One-click demo sign-in

Add these to `apps/web/.env.local` (never committed) and restart `npm run dev`. The sign-in page then shows a button per account, and the sidebar gets a **Demo: switch account** menu:

```
VITE_DEMO_PASSWORD=the password the demo accounts share
VITE_ADMIN_DEMO_PASSWORD=optional: a different password for the admin account
VITE_DEMO_ACCOUNTS=admin:agrowth.farmlands@gmail.com,field_agent:damola@agent.test,compliance_officer:comply@officer.test,cycle_manager:tolu@manager.test,trustee:bank@trustee.test,vendor:counter@zariaagro.test
```

Any role can have its own password the same way: `VITE_<ROLE>_DEMO_PASSWORD`, for example `VITE_TRUSTEE_DEMO_PASSWORD`. Otherwise the shared one is used.

> The buttons only appear on the development server (`npm run dev` and `npm run dev:phone`). A production build (`npm run build`) leaves the demo accounts and passwords out entirely.

### Testing field visits on a phone

A field visit passes only if the GPS fix is accurate to 20 m and within 20 m of the mapped boundary. Laptops usually report 20–100 m accuracy, so visits from a laptop will (correctly) fail. Use a phone:

1. Run `npm run dev:phone`. It prints a `Network` address such as `https://192.168.0.81:5173`.
2. On a phone on the same Wi-Fi, open that address. Accept the certificate warning: it's a self-signed certificate for local testing. Browsers only share GPS with secure pages.
3. Map the demo farms **around where you are** (step 3 below), so you're standing at the farms when you visit them.

### Installing the app and working offline

Agrowth installs like an app: on Android, open the site in Chrome and choose **Install app** (or **Add to Home screen**); on an iPhone, Safari → Share → **Add to Home Screen**. It opens full-screen with the Agrowth icon.

For field agents it then works without a connection:

- **Field visits** saves the agent's work list on the phone every time it opens online: the farms to visit, their boundaries and the farmers' names.
- With no signal, the app still opens, the list and each farm's boundary still show, and GPS still works. Map imagery needs a connection (the tile providers don't allow bulk offline copies), so the boundary and your position are drawn on a plain background.
- A visit recorded offline is saved on the phone with its photos and sent automatically when coverage returns (on reconnect, and every minute while visits are waiting). The menu shows **Online/Offline** and how many visits are waiting.
- The database judges it exactly as an online visit, using the time the agent was at the farm. Each visit carries the phone's own id, so a resend after a dropped connection can't record it twice. Staff see "recorded offline, received …" on visits that arrived late.
- If the database refuses a queued visit (say the milestone was verified by someone else meanwhile), it shows as **Not accepted** with the reason, and the agent can remove it.
- Signing out removes the saved work list from the phone. Unsent visits stay, and send when the same agent signs in again.

Offline support is in production builds only. To try it on a phone, run `npm run preview:phone` (a production build over HTTPS on your network), open the `Network` address on the phone, sign in as the field agent and open **Field visits**. Then turn on flight mode and record a visit.

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

**Step 4 — Compliance officer: verify KYC.** Open each of the three farmers. Their numbers were checked when they were enrolled: under **Identity checks**, each NIN and BVN shows **Match** (marked _Simulated_ until a real provider is set up). Press **Verify**.

> Enrol a farmer with a NIN ending in `1111` and the check comes back **No match**. **Verify** then stays disabled until you write a note saying how you confirmed who they are. If the identity-check function isn't deployed, every farmer is in that position.

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
| Management fee (% of capital)      | 2                                                 |
| Funders' share of profit (%)       | 30                                                |
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

**Or invest through the investor portal** instead of one of the deposits above:

1. Sign up a new account (it starts as an investor) → **Profile and KYC**. Fill it in with any 11-digit NIN and BVN and attach an image as the ID.
2. As compliance (or admin): **Investors** → **Review** → **Verify**. Pick the classification: a retail investor can invest at most 10% of the income they declared, minus what they invest elsewhere.
3. As the investor: **Marketplace** → the cycle → **Invest**. Read the risk disclosure, tick it, enter ₦900,000 and pledge. The pledge reserves its share of the target and shows the trustee's escrow account and a payment reference.
4. The trustee can't add the money until the 48-hour cooling-off has passed. For a demo, as admin: **Investors** → **Investor settings** → set cooling-off to 0 hours.
5. As the trustee: Funding tab → **Investor pledges** → **Confirm payment**. The deposit is recorded against the investor, whose **My investments** page now shows it, with a certificate.

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

**Step 15 — Cycle manager: instruct the release.** Once all three farms have passed, milestone 1 → **Instruct release**. Add three lines that total ₦600,000. Seed and fertiliser go out as input vouchers, so farmers pick them up at an approved shop and no cash changes hands:

| Payee type       | Payee name              | Bank and account       | Purpose                       | Amount (₦) |
| ---------------- | ----------------------- | ---------------------- | ----------------------------- | ---------- |
| Input vouchers   | _(none needed)_         | _(none needed)_        | Certified seed and NPK        | 450000     |
| Service provider | Samaru Tractor Hire     | GTBank 0234567891      | Ploughing and harrowing, 3 ha | 90000      |
| Cash to farmers  | Cooperative labour fund | Zenith Bank 0345678912 | Planting labour allowance     | 60000      |

> Cash to farmers is capped at 20% of a milestone (₦120,000 here). Try ₦150,000 cash to see it refused.

**Step 16 — Trustee: issue the vouchers and confirm payments.** Milestones tab → milestone 1:

1. **Issue vouchers** on the input-vouchers line and keep the suggested expiry. This ring-fences ₦450,000 of the cycle's cash and issues one voucher per farm, split by farm area (about ₦150,000 each for three 1 ha farms).
2. **Confirm payment** for the two bank payees, with references `PAY-DEMO-001` and `PAY-DEMO-002`.

Milestone 1 is now _Released_ and the cycle is _In progress_. The cycle has a new **Vouchers** tab.

**Step 17 — Set up the agro-dealer.**

1. Field agent: **Vendors → Register vendor**:

   | Field                    | Value                  |
   | ------------------------ | ---------------------- |
   | Business name            | Zaria Agro Inputs Ltd  |
   | Type                     | Agro-dealer            |
   | CAC or dealer licence no | RC-1234567             |
   | Phone                    | +2348035550101         |
   | State / LGA              | Kaduna / Zaria         |
   | Shop address             | Samaru Market, Shop 14 |
   | Bank                     | Access Bank            |
   | Account number           | 0123456789             |
   | Account name             | Zaria Agro Inputs Ltd  |

2. Compliance: open the vendor and press **Approve**. Whoever registered a vendor can't approve it.
3. Sign up `counter@zariaagro.test`. As admin, give it the **Vendor** role on the Users page, then open the vendor and link it under **Counter sign-in**.

> Edit an approved vendor's account number to see it go back to _Awaiting approval_: new bank details always need a fresh review.

**Step 18 — Vendor: redeem the vouchers.** As the cycle manager, open the Vouchers tab and press **Print slips**. In real use a field agent hands each farmer their slip. Then sign in as the agro-dealer → **Redeem vouchers**. For each farmer, enter the code from their slip and the last four digits of their phone (Amina `0001`, Musa `0002`, Hauwa `0003`). Press **Check voucher**, enter "2 bags NPK 15-15-15, 25 kg certified maize seed" and the full amount left on the voucher, then **Redeem**.

> Enter the wrong phone digits: the shop is told only that nothing matches, not which part was wrong. After 5 wrong tries in 15 minutes the counter is locked for 15 minutes. A voucher can also be used in parts, across several visits or shops.

**Step 19 — Trustee: pay the agro-dealer.** Cycle → Vouchers tab → **Pay vendor** for each redemption, with references `VEN-DEMO-001` to `VEN-DEMO-003`. The confirmation shows the vendor's registered account; the trustee pays only that account.

> Any voucher value left unused can be returned to the cycle with **Close** (or **Close expired** once vouchers pass their expiry date). The harvest can't be completed while a voucher is open or a vendor is unpaid.

**Step 20 — Check the ledger** (as trustee or compliance: Ledger → DEMO-MAIZE-2026-001). It shows ₦1,500,000 received, ₦600,000 deployed to farms, ₦900,000 still held, and every entry with its bank reference. Between steps 16 and 19, the voucher money sits in _Cash ring-fenced for input vouchers_. It's still held by the trustee but can't be spent on anything else. Repeat steps 13–16 for milestones 2 and 3 (bank payments only is fine).

**Step 21 — Field agent: record the harvest** (open the cycle → Harvest tab → Record delivery). One row per load, as the offtaker weighs and grades it. The offtake agreement is Northern Mills Ltd for every load.

| Farm       | Weight (kg) | Grade    | Moisture (%) | Waybill     |
| ---------- | ----------- | -------- | ------------ | ----------- |
| North plot | 2000        | Grade A  | 13.5         | WB-DEMO-001 |
| North plot | 1200        | Grade B  | 14           | WB-DEMO-002 |
| River plot | 2700        | Grade A  | 13           | WB-DEMO-003 |
| East plot  | 3100        | Grade B  | 14.5         | WB-DEMO-004 |
| East plot  | 350         | Rejected | 19           | WB-DEMO-005 |

> To see a correction, record a sixth load (North plot, 1000 kg, `WB-DEMO-006`) and press **Void** with the reason "Entered twice". It stays in the list, struck out, and stops counting. Reusing a waybill number is refused.

The tab now shows 9 t accepted (3 t/ha, the expected yield). The rejected load is kept on record but earns nothing.

**Step 22 — Cycle manager: complete the harvest.** Harvest tab → **Complete harvest**. It's refused while any milestone is unreleased, any voucher is still open, or any vendor is unpaid. The cycle is now _Harvested_ and no more loads can be recorded.

**Step 23 — Trustee: record the offtaker's payment** (Settlement tab → Record receipt)

| Field          | Value                                |
| -------------- | ------------------------------------ |
| From           | Harvest payment · Northern Mills Ltd |
| Amount (₦)     | 4050000                              |
| Received on    | today                                |
| Bank reference | RCV-DEMO-001                         |
| Notes          | 9 t at ₦450,000/t                    |

> An insurer's claim payout is recorded the same way (choose **Insurance payout**). It joins the same waterfall, so funders and farmers see exactly what was recovered.

**Step 24 — Trustee: run the settlement.** The Settlement tab previews the waterfall. Each step is paid in full before the next:

| Step                                          | Amount (₦) |
| --------------------------------------------- | ---------- |
| Cash held by the trustee                      | 4,050,000  |
| 1. Management fee (2% of ₦1,500,000 capital)  | 30,000     |
| 2. Funders' capital back                      | 1,500,000  |
| 3. Funders' return (30% of ₦2,520,000 profit) | 756,000    |
| 4. Farmer surplus (by kg delivered)           | 1,764,000  |

Funders are paid in proportion to what they put in: Adaeze Okoro ₦1,353,600 and Chidi Nwosu ₦902,400, +50.4% each. Farmers are paid by kilograms accepted: Amina Ibrahim ₦627,200 (3.2 t), Musa Bello ₦529,200 (2.7 t) and Hauwa Sani ₦607,600 (3.1 t). Press **Run settlement**. That fixes the six payouts.

> If your cycle was approved before settlement terms existed, its fee is 0% and its funders' share is 30%. The total paid out is the same, but there's no fee line and the screen shows the exact split.

**Step 25 — Trustee: make the payouts.** Settlement tab → **Confirm payment** for each, with references `SET-DEMO-001` to `SET-DEMO-006`. After the last one the cycle is _Settled_.

**Step 26 — Check the result.** The **Funder statements** card shows each funder's money in, capital back, return and result. In the Ledger, the trustee's cash, funder capital and farm deployment are all ₦0. The income and expense accounts show where every naira went: ₦4,050,000 harvest proceeds against ₦1,500,000 cost of production, ₦30,000 fee, ₦756,000 funder returns and ₦1,764,000 farmer surplus.

### The Government Edition

A programme is a ministry's, agency's or donor's scheme: what it funds, where, for whom, and what must come back.

1. As a programme manager (or admin): **Programmes** → **New programme**. Set the commodities, target states and LGAs, the hectare limit, the input package and its value per hectare, the budget, and whether it's an input loan (with the share farmers repay) or a grant. It's saved as a draft; **Activate** fixes the terms.
2. As the cycle manager: create a cycle with **Funded by** set to a programme or blended, and choose the programme. The readiness checklist now includes the programme's rules: the crop, every farmer inside the target area and under the hectare limit, cooperative membership, the package value, and the programme's dates. Try a farmer from another state to see the check fail.
3. Run the cycle as usual. When the trustee records a programme deposit, it counts against the programme's budget; one that would overspend it is refused.
4. The programme's page shows farmers reached (and how many are women), hectares, budget used, inputs delivered, harvest and yield, and the repayment rate once a season settles. Switch the breakdown between state, LGA, ward, commodity and cooperative. Farms that delivered less than the low-yield estimate are listed for follow-up, next to each extension agent's visit record. **Beneficiaries (audit)** downloads every farm with names for auditors and donors; **Open data** downloads totals by LGA with no personal data, safe to publish.

## Tests

```bash
npm test
```

This runs:

- **Database tests** (`supabase/tests`) — the real migrations on an in-memory PostgreSQL with PostGIS ([PGlite](https://pglite.dev)). They sign in as different roles and prove the rules: who can see what, duplicate farmers and overlapping farms refused, a full cycle from draft to released funds, harvest and settlement (profit and loss), vouchers redeemed and vendors paid, investor KYC, identity checks (only the number on record, results written only by the identity service, verification needing a match or a reason), bank files (a payment in one file at a time, statements confirming payments and pledges by reference, wrong amounts and second payments flagged, re-imports skipped), weather (one reading per 11 km square, written only by the weather service, flags against the 10-year normal), online payments (only the payments service records a result, the first report counts, late or wrong payments flagged for refund, simulated payments refused unless allowed), caps, pledges and cooling-off, programme eligibility, budgets and dashboard figures, offline visits sent twice, guessing locked out, the ledger can't be edited or unbalanced, and so on. No database server needed.
- **Demo seed test** — runs the whole demo seed through the migrations and checks every cycle reaches its stage and the books close.
- **Provider tests** — identity matching and the Dojah adapter, and the Paystack adapter (fees, checkout, verification, webhook signatures), against canned responses.
- **Web tests** (`apps/web`) — money, map, error, return-projection, identity-check, weather and CSV export helpers, the payment gateway's return, reading bank statements in the usual layouts, and the offline sync queue.

## Repository layout

```
apps/
  web/                 React + TypeScript app
    src/
      pages/           One file per screen (pages/cycle/ holds the cycle detail tabs, pages/invest/ the investor portal, pages/programme/ the Government Edition)
      components/      Layout, map, buttons, inputs
      auth/            Sign-in state
      lib/             Supabase client, types, roles, geometry helpers
supabase/
  migrations/          The database, in order: foundation, registry, ledger, cycle builder, funding and disbursement, harvest and settlement, vouchers, investor edition, government edition, offline visits, identity checks, bank files, online payments, weather
  functions/           Edge Functions: identity-check, payments, payments-webhook and weather-sync, and _shared/ (identity, payment and weather providers) used by them, the seed and the tests
  seed/                The demo portfolio and the `npm run seed:demo` command
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
- **Identity checks can't be faked.** A check can only be opened for the number on record (it must hash to the stored fingerprint), by someone allowed to check that person, and only the identity service (service role) can record the answer. Only match or no-match per field is kept, never the provider's copy of the person's details. Verifying KYC needs a matching check of every number on record, or a written reason.
- **Online payments can't be faked.** Only the payments service (service role) records a gateway's answer, after checking the gateway's signature or asking the gateway itself. The first answer counts, and a payment for a closed pledge or of the wrong amount is flagged for the trustee rather than applied. Simulated payments are refused unless an admin allows them.
- **A bank statement confirms only what it proves.** A statement line confirms a payment only if it quotes that payment's reference and the exact amount, and it goes through the same checks as the trustee confirming by hand, under the bank's own reference. A payment can be in only one live payment file, a second debit for something already paid is flagged, and statement lines are kept, with re-imported lines skipped.
- **One farmer, one record; one piece of land, one farm.** Enrolment needs a NIN or BVN, and a repeat is refused. A boundary that overlaps a registered farm by more than 5% of the smaller farm is refused.
- **Farm area is computed by the database** from the mapped boundary; invalid polygons are rejected.
- **Boundaries are locked while a cycle is live**, from approval through harvest.
- **Roles come from the database, never the browser.** Sign-up always creates an investor; only an admin can grant staff roles, and nobody can change their own.
- **Offtake first, insured downside, verified farmers.** A cycle can't be submitted, or approved, until a signed buyer covers at least the low-yield harvest, insurance covers the budget for the whole season, and every farmer has passed KYC.
- **Separation of duties.** The cycle's own manager can never approve it. Only the trustee confirms deposits, payments and refunds.
- **Offline visits are judged like any other.** A visit sent late from the phone goes through the same checks, at the time the agent was at the farm (never before verification was requested, never in the future), and the server records when it arrived. A repeated send of the same visit returns the first result and records nothing new; another agent can't reuse its reference.
- **Money follows verification.** A milestone is released only after every farm passes a field visit (GPS inside the boundary, checklist, photo), in order, and at most 20% may go to farmers as cash. The trustee can't pay out more than it holds for that cycle.
- **Inputs, not cash.** Vouchers are issued per farm and redeemed only at compliance-approved vendors, with the voucher code plus the last four digits of the farmer's phone. The shop never sees the farmer's phone or full name. Five wrong tries in 15 minutes lock that counter out. The trustee ring-fences voucher money when it issues them and pays only the vendor's registered account. New bank details need a fresh approval, and a suspended vendor's payments are held. Unused value returns to the cycle, and the season can't close while any voucher is open.
- **Programmes fund only what fits them.** A cycle in a programme can't be submitted or approved unless the programme is active and the cycle meets its rules: a listed commodity, every farmer in the target area, under the hectare limit and in a cooperative, a budget per hectare within the input package, and a season within the programme's dates. An active programme's terms can't be edited. Programme deposits can never exceed its budget, and a closed programme takes no new money.
- **Investors invest within the rules.** Only a KYC-verified investor can pledge, and only after acknowledging the current version of the risk disclosure (a stale version is refused). Retail investors are capped at a share of their declared income over 12 months, counting what they declared investing elsewhere; compliance decides who is high-net-worth or institutional. A pledge reserves its share of the cycle until its pay-by date, so a cycle can't be oversubscribed. During cooling-off the trustee can't add the money to the cycle, and investors can withdraw until the trustee confirms payment. Investors never read cycle, farm or ledger tables: they see curated listings without farmer names, account numbers or other funders, and field photos only for cycles they have money in.
- **Evidence is permanent.** Cycle history and field visits are append-only, and uploaded documents can't be replaced or deleted.
