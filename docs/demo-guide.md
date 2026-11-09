# Agrowth 2.0 — Demo Guide

How to open the Agrowth demo, set it up yourself if you want to, and a scripted tour that shows what the platform does in about 40 minutes.

_The demo runs on sample data: the farmers, farms, cycles, investors and amounts are made up, and no real money moves. For what the platform is and every role in detail, see the [Platform Guide](platform-guide.md). For why it's designed this way, see the [Design Rationale](design-rationale.md)._

---

## 1. Opening the demo

**The quickest way** is a hosted demo link, if you've been given one. Open it in a browser; the sign-in page shows a button for each demo role, and once you're in, the sidebar has a **Demo: switch account** menu to jump between roles. A banner reminds you it's sample data. Other visitors share the same environment, so you may see their changes.

**On a phone**, the same link works, and you can install it like an app: on Android, Chrome → **Install app**; on an iPhone, Safari → Share → **Add to Home Screen**. Field visits need a phone (or the demo's simulated GPS), because a visit passes only if the GPS fix is within 20 m of the farm.

### Demo accounts

Every account uses the one demo password you were given.

| Account | Role | Plays |
| --- | --- | --- |
| `manager@agrowth.test` | Cycle manager | Tolu Akinwale: builds cycles and instructs releases |
| `programme@agrowth.test` | Programme manager | Hadiza Abdullahi: runs the Kano state wheat programme |
| `agent@agrowth.test` | Field agent | Damola Ogunleye: enrols farmers, maps farms, visits them (Kaduna and Kano) |
| `agent.benue@agrowth.test` | Field agent | Terver Iorliam: the same, in Benue |
| `compliance@agrowth.test` | Compliance officer | Fatima Bello: KYC, approvals |
| `trustee@agrowth.test` | Trustee | Kemi Adebayo: the custodian who confirms every movement of money |
| `auditor@agrowth.test` | Auditor | Ibrahim Musa: reads everything, changes nothing |
| `vendor@agrowth.test` | Agro-dealer counter | Bala Sule at Zaria Agro Inputs: redeems farmers' vouchers |
| `investor@agrowth.test` | Investor | Adaeze Okoro, high-net-worth: one investment paid out, one live |
| `investor.retail@agrowth.test` | Investor | Funmilayo Adeleke, retail: a pledge in its 48-hour cooling-off |
| `investor.new@agrowth.test` | Investor | Emeka Obi: waiting for KYC approval |

An `admin@agrowth.test` account also exists. It's normally left off a public demo because an admin can change other accounts' roles.

### What's in the demo

Four cooperatives in Kaduna, Kano and Benue; 43 farmers with mapped farms; and nine funding cycles, one at every stage of the lifecycle:

| Stage | Cycle | What it shows |
| --- | --- | --- |
| Settled | Zaria maize, wet season | A full season closed: funders +16%, farmers paid their surplus by kilogram |
| Settled | Makurdi soybean, wet season | A drought year: the insurance claim returned the funders' capital |
| Settled | Kura wheat, last dry season | The wheat programme's first season: input credit repaid; one farm short after a pump failure |
| Harvested | Kura rice, wet season | Harvest in and paid for; ready for the trustee to settle live |
| In progress | Zaria maize, dry season | Inputs paid as vouchers redeemed at an agro-dealer; a release blocked by a check-in 270 m outside a farm |
| Funded | Kura wheat, dry season | The programme's second season; field visits under way |
| Open for funding | Makurdi soybean, next season | 55% raised; a retail investor's pledge in cooling-off |
| Awaiting approval | Ikara sorghum, next season | Blended programme and investor funding; ready for compliance to approve live |
| Draft | Makurdi soybean expansion | The readiness checklist, with two checks failing |

Cycle codes look like `KD-MAIZE-26W-01` (state, crop, season, number). They depend on the date the demo was set up, so this guide names cycles by place and crop.

---

## 2. Setting the demo up yourself

This is for a technical reviewer who wants their own copy. It takes about 20 minutes and needs **Node.js 22 or newer**, **git** and a free **[Supabase](https://supabase.com) account**. No database server or Docker is needed.

**1. Get the code**

```bash
git clone <repository URL> agrowth
cd agrowth
npm install
```

**2. Create a Supabase project for the demo.** Sign in at supabase.com → **New project**. Choose a name and region and set a database password.

**3. Point the demo commands at it.** Copy `supabase/.env.demo.example` to `supabase/.env.demo` and fill in, from the project's settings:

| Setting | Where to find it |
| --- | --- |
| `SUPABASE_URL` | Project Settings → API Keys → Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable key |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → secret key (keep it private) |
| `SUPABASE_DB_URL` | Connect → Connection String → Session pooler, with the database password filled in |
| `DEMO_PASSWORD` | Any password of 8+ characters; every demo account will use it |

**4. Create the database and fill it with the demo portfolio**

```bash
npm run demo:push     # creates the tables, rules and functions
npm run seed:demo     # creates the accounts, farmers, farms and cycles (a few minutes)
```

The seed prints every account and two lines to paste into the web app's settings.

**5. Run the web app**

```bash
cp apps/web/.env.example apps/web/.env.local
```

In `apps/web/.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the publishable key, never the secret one), and paste the `VITE_DEMO_PASSWORD` and `VITE_DEMO_ACCOUNTS` lines the seed printed. Then:

```bash
npm run dev           # http://localhost:5173
npm run dev:phone     # the same over HTTPS on your Wi-Fi, for testing GPS on a phone
npm run preview:phone # the production build on your Wi-Fi, which includes offline mode
```

**6. Optional: a shareable link.** The repository deploys to [Vercel](https://vercel.com) as is. Import it, then set:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | the demo project's URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | its publishable key |
| `VITE_DEMO_MODE` | `true` |
| `VITE_DEMO_PASSWORD` | the demo password |
| `VITE_DEMO_ACCOUNTS` | `cycle_manager:manager@agrowth.test,programme_manager:programme@agrowth.test,field_agent:agent@agrowth.test,compliance_officer:compliance@agrowth.test,trustee:trustee@agrowth.test,auditor:auditor@agrowth.test,vendor:vendor@agrowth.test,investor:investor@agrowth.test,investor:investor.retail@agrowth.test,investor:investor.new@agrowth.test` |

Demo mode keeps the role buttons and simulated GPS, hides public sign-up, and shows the sample-data banner.

**Starting fresh.** The demo's records can't be edited away (the ledger and history are append-only by design). Reset and re-seed before an important meeting:

```bash
npm run demo:reset    # asks you to type "reset"; wipes only the demo project
npm run seed:demo
```

**Running the tests** (optional): `npm test` runs all 222 automated tests, including one that builds the whole demo through the database's rules.

---

## 3. The scripted tour

Eight short scenes, about 40 minutes in all. Each says which account to use and what to point out. Scenes 3, 4 and 6 change the demo (they approve, verify and settle things), so run them once per fresh demo. The others only read.

### Scene 1 — The portfolio at a glance (3 min)

**Sign in as:** cycle manager. **Open:** Overview.

- The headline figures: capital raised, money released to farms, money paid back to funders, farmers enrolled, surplus paid to farmers.
- **Pipeline:** cycles at every stage, from draft to settled.
- **Mapped farms:** every farm on a satellite map.
- **Needs your attention:** what's waiting on someone right now, for example a release blocked by a failed visit.

> **The point:** one view of every cycle, and every figure comes from the ledger rather than a spreadsheet.

### Scene 2 — Follow the money through a finished season (8 min)

**Sign in as:** auditor (read-only). **Open:** Funding cycles → the settled **Zaria maize, wet season** cycle. Go through the tabs in order:

1. **Overview:** the budget, the yield and price assumptions shown as low, expected and high, and the settlement terms.
2. **Farms:** six family farms, each mapped and KYC-verified.
3. **Offtake & insurance:** the mill signed to buy the harvest at a minimum price, and the insurance policy, both before any money was raised.
4. **Funding:** each deposit, confirmed by the trustee with its bank reference.
5. **Milestones:** three releases. For each one, every farm's field visit: the GPS check-in drawn against the boundary, the checklist, and the photos. Money went mostly to input vendors, never more than 20% as cash.
6. **Harvest:** every truckload weighed and graded, with waybill numbers.
7. **Settlement:** the waterfall. First the management fee, then funders' capital back, then the profit split between funders (+16%) and farmers (by kilograms delivered).
8. **History**, then **Ledger** in the menu: every entry with its reference. The trustee's cash for this cycle ends at exactly zero.

Then open the **Makurdi soybean** settled cycle: a drought year. The harvest fell short, the insurance claim came in, and funders still got their capital back. Under **Offtake & insurance → Insurance claims**, **Open** the drought claim to see its whole course:
- reported during the dry spell, on every farm, with the latest field visits kept as evidence;
- the insurer told five days later, with its claim number;
- assessed after a harvest-time crop cut;
- paid to the trustee, and from there into the waterfall.

For a claim still under way, open the **Zaria maize, dry season** cycle's claim: fall armyworm on two farms, with the insurer already told. As the cycle manager, **Record the assessment**. Then, as the trustee, **Record the insurer's payment**. Claims waiting on someone also show on the Overview, under **Needs your attention**.

> **The point:** every naira is traceable from deposit, to a verified farm, to the harvest, to the payout. Nothing can be edited after the fact.

### Scene 3 — The controls, live (5 min)

**Sign in as:** cycle manager. Open the **draft** soybean expansion cycle.

- The **readiness checklist** has two red items. A cycle can't be submitted until every check passes: a signed buyer covering the low-yield harvest, insurance for the whole season, every farmer KYC-verified, and milestones adding up exactly.

Now open the **Ikara sorghum** cycle, which is awaiting approval. The cycle manager can't approve it. Switch to **compliance** and **Approve** it: it opens for funding and gets its own ledger accounts.

> **The point:** the rules are enforced by the database, not by people remembering them. Whoever builds a cycle can never approve it.

### Scene 4 — A field visit (5 min)

**Sign in as:** field agent (`agent@agrowth.test`). **Open:** Field visits.

1. The **Kura wheat** programme cycle has farms waiting. Press **Visit** on one.
2. Press **Simulate GPS at this farm** (on a real phone in the field, **Start GPS**). Pick a crop condition, tick the four checklist items, add a photo, then **Submit visit**. The database checks the position against the boundary and the visit passes.
3. **Optional: offline.** On a phone with the app installed, open Field visits once, then switch on flight mode and record a visit. It's saved on the phone and sent automatically when the signal returns.

Back as the **cycle manager**, open the **Zaria maize, dry season** cycle → Milestones. One release is **blocked** because an agent checked in 270 m from the farm. It stays blocked until a passing revisit.

Then the cycle's **Weather** tab. This is real weather at those farms: the last 60 days of rain against the usual for the time of year, and the coming week. Any dry spell, heavy rain or heat shows at the top of the tab and on the Overview. If the tab says there's no weather yet, press **Refresh weather**.

> **The point:** money only moves after someone has stood on every farm, and the phone proves where they were. Between visits, the weather keeps watch, and its record is there if a claim is ever made.

### Scene 5 — Inputs, not cash (4 min)

**Sign in as:** cycle manager. Open the **Zaria maize, dry season** cycle → **Vouchers**.

- Seed and fertiliser money went out as **input vouchers**: one per farm, split by farm area. **Print slips** shows what a farmer is handed: the code and a QR code.
- Each redemption is listed: which approved agro-dealer supplied what, and when the trustee paid the dealer's registered account.
- **Scan a slip:** with **Print slips** open on a laptop, point a phone's camera at a slip's QR code and open the link. Sign in on the phone as the **vendor** and it lands on that voucher, ready to redeem part of it. The shop never sees the farmer's name or phone number.
- **Or type it:** as the vendor, enter a code and the last four digits of the farmer's phone (shown on the farmer's page to staff). Wrong guesses lock the counter after five tries.
- As **admin**, **Vendors** has the switch that makes a scan also ask for the phone digits.

> **The point:** farmers get inputs from approved shops, not cash, and every shop is paid only for what it supplied.

### Scene 6 — The trustee settles a season (5 min)

**Sign in as:** trustee. Open the harvested **Kura rice** cycle → **Settlement**.

1. The preview shows the cash held, the fee, the funders' capital and return, and each farmer's surplus by kilograms.
2. **Run settlement:** this fixes the payouts.
3. Payouts to farmers and the platform fee have no bank account on file, so **Confirm payment** on each, with any reference.
4. Open **Bank files** in the menu. Under **Waiting for a payment file** are the investors' payouts, which have bank accounts on file, and the agro-dealer's latest voucher payment. **Select all** → **Make payment file** downloads the CSV a trustee would upload to its bank's bulk payments. Each narration starts with the payment's AGP reference.
5. **Simulated bank statement** downloads the statement the bank would send back. It shows those payments made and Funmilayo's pledge payment received. Under **Statements**, **Choose CSV** → **Import and match**. The payments are confirmed under the bank's references and posted to the ledger, and the cycle is **Settled**. Funmilayo's pledge lands in **Needs attention**: her cooling-off hasn't ended, so it can't be added yet.

> **The point:** the platform never holds money. It tells the trustee's bank what to pay, and the bank's own statement confirms it.

### Scene 7 — Investor Edition (6 min)

**Sign in as:** `investor@agrowth.test` (Adaeze).

1. **Marketplace:** the open soybean cycle. Show the projected low/expected/high return, the 1–5 risk score with its reasons, how much is subscribed, the farm map (no farmer names), the buyer and the insurer.
2. **Invest:** read the risk disclosure, tick it, enter an amount and pledge. The investor gets the trustee's escrow account and a payment reference, and can withdraw until the trustee confirms payment.
3. **My investments:** her earlier ₦500,000 soybean pledge is past its cooling-off and waiting for payment. **Pay online** shows the amount and the gateway's fee (none on the simulated gateway), then **Continue to payment** opens the simulated gateway's page. **Pay** brings her back with "Payment received": the pledge is confirmed and the deposit is on the cycle's ledger, with no one at the trustee's desk. With Paystack switched on, the same button opens Paystack's checkout.
4. Also under **My investments:** a statement for the settled maize cycle (paid in, capital back, return) and a printable certificate. Then **Track the cycle** on the live maize cycle: field checks with photos, releases and history.

Switch to `investor.retail@agrowth.test` (Funmilayo). **My investments** shows her retail limit: at most 10% of declared income a year across all crowdfunding. She has a pledge waiting for payment.

Switch to **trustee**, then soybean cycle → **Funding**. Funmilayo's pledge can't be confirmed yet: her 48-hour cooling-off hasn't ended.

Switch to **compliance**, then **Investors**. Emeka is waiting for KYC review. **Review** shows his details, ID document, the identity checks of his NIN and BVN (both **Match**, marked _Simulated_ on the demo), and classification options.

Then **Farmers** and filter by KYC pending: one farmer's NIN came back **Partial match** (the name matches, the date of birth and phone don't). **Verify** stays disabled until compliance writes down how they confirmed who the farmer is. The rejected farmer's number belongs to someone else.

> **The point:** investors see a verifiable, honest picture (ranges, not promises), and the regulatory rules (KYC, caps, disclosures, cooling-off) are built in.

### Scene 8 — Government Edition (4 min)

**Sign in as:** programme manager. **Open:** Programmes → **Kano Dry-Season Wheat Input Credit**.

- **Headline figures:** farmers reached and the share who are women, hectares, budget used, inputs delivered, harvest and yield, and the **repayment rate** for the settled season.
- **Breakdown:** switch between state, LGA, ward, commodity and cooperative.
- **Farms under the low-yield estimate:** the farm that lost its crop to a pump failure, flagged for follow-up.
- **Extension agents:** each agent's visits, pass rate and check-ins off the farm.
- **Beneficiaries (audit)** and **Open data:** a spreadsheet of every farm for auditors and donors, and totals by LGA with no personal data, safe to publish.

> **The point:** a programme can see who got what, where, and whether it came back. That's what past input-credit schemes couldn't show.

### Closing (2 min)

- **What's built:** the core platform, both editions, the offline field app, automated NIN/BVN identity checks (simulated on the demo, ready for a live provider), and the trustee's bank files: payment files out, statements back in.
- **What's next:** a payments integration for collections and payouts, then a pilot season with one cooperative, a real trustee, offtaker and insurer. The farmer USSD/SMS channel and an independent security audit follow in a later phase.
- The [Platform Guide](platform-guide.md) lists the full status.

---

## 4. If something doesn't look right

| What you see | Why, and what to do |
| --- | --- |
| A sign-in button fails | The account may be missing from the hosted demo's settings, or the demo wasn't seeded with it. Re-seed (section 2). |
| A scene's starting point is gone (sorghum already approved, rice already settled) | Someone ran that scene already. Reset and re-seed before the next demo. |
| A field visit fails | Real GPS from a laptop is rarely within 20 m. Use **Simulate GPS at this farm**, or a phone at the farm. |
| No map imagery on a phone | You're offline. Boundaries and GPS still work; imagery needs a connection. |
| Investor pledge "can't be confirmed yet" | That's the 48-hour cooling-off working as designed. |
