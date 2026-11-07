# Agrowth 2.0 — Design Rationale

Why the platform is designed the way it is: the failures it is built to prevent, the principles that follow from them, how each principle is enforced in the software, and the trade-offs behind the main decisions.

_For what the platform does and how to use it, see the [Platform Guide](platform-guide.md). For a hands-on tour, see the [Demo Guide](demo-guide.md)._

---

## 1. The problem

Agricultural finance for smallholders in Nigeria has failed repeatedly, in two different forms.

**Agri crowdfunding.** Earlier platforms promised retail investors a fixed return on a farm cycle, collected the money centrally, and hoped the harvest would cover it.

- **Leading platforms left the model.** Farmcrowdy moved out of crowdfunding in 2021 and became a B2B food value-chain business. ThriveAgric nearly collapsed in 2020 over unpaid retail investors, then dropped public crowdfunding for institutional capital. [WeeTracker, May 2026](https://weetracker.com/2026/05/29/crowdfunding-agritech-collapses-africa/)
- **Many smaller platforms vanished.** Farm Power, Payfarmer, Goldvest, Emerald Farms, HO Corn, FarmKonnect and others left investors unable to recover funds. [Nairametrics, 2023](https://nairametrics.com/2023/07/23/big-read-the-dark-twisted-world-of-nigerias-agro-crowdfunding-industry)
- **The promised returns were impossible.** Platforms advertised 20–50% a year, some 10% a month, which no farm cycle can sustain. [Nairametrics, 2022](https://nairametrics.com/2022/01/30/why-many-crowdfunding-platforms-are-failing-in-nigeria/)
- **New money paid old money.** Some platforms paid maturing investors with fresh deposits. [The Condia](https://thecondia.com/rise-pivot-agritech-crowdfunding-platforms-crowdyvest/)
- **Insurance didn't protect investors.** Cover insured the farming, not the investor's capital. [TechCabal](https://techcabal.com/?p=90280)

**Government input credit.** The CBN's Anchor Borrowers' Programme released about ₦1.08 trillion; by February 2023 only 52.39% of what was due had been repaid, and the IMF put recovery far lower. [Nairametrics](https://nairametrics.com/2023/03/06/cbn-says-farmers-have-only-repaid-52-3-of-loans-under-anchor-borrowers-programme) The IMF blamed weak repayment incentives and poor targeting of recipients. [Ripples Nigeria](https://www.ripplesnigeria.com/imf-reveals-problems-with-cbns-anchor-borrowers-programme/?amp)

**The common causes** are:

- returns set by marketing rather than farm economics,
- operators holding the money,
- cash handed to farmers,
- no independent proof that farms existed,
- no buyer locked in for the harvest,
- political or social pressure that weakened repayment.

Every design decision below traces back to one of these.

---

## 2. Principles, and how each is enforced

The principles apply to both editions. The central design choice is that they are **enforced by the software, not left to the operator's goodwill**. A rule that can be skipped under pressure is exactly what failed before.

| Principle | Failure it removes | How the platform enforces it |
| --- | --- | --- |
| **Trustee custody** | Operators diverting or recycling funds | The platform holds no money and has no payment rails. Every deposit, payment, refund and payout exists only once the **trustee** confirms it with its own bank reference. The trustee can't pay out more than it holds for a cycle. |
| **Offtake first** | No market for the harvest | A cycle can't be submitted or approved without a **signed offtake agreement** covering at least the low-yield harvest. |
| **Insured downside** | Losses landing entirely on funders | Submission and approval also need an **insurance policy** covering the budget for the whole season, with its loss payee named (in practice the trustee, on behalf of the funders). Claims flow through the same waterfall as harvest money. |
| **Verified farms** | Ghost farms and fake progress | Farms are mapped as boundaries, and overlaps with any other registered farm are refused. Before each release, an agent must **check in by GPS inside every farm's boundary**, pass a checklist and take a photo. One failed farm holds the whole release. |
| **In-kind, staged disbursement** | Cash leakage at farm level | Money is released per milestone, in order, mostly to input vendors or as **vouchers** redeemable only at approved agro-dealers. Cash to farmers is capped at 20% of a milestone. |
| **Honest, variable returns** | Unsustainable promised returns | Yields and prices are entered as **low–expected–high ranges**. Returns are a share of actual proceeds after the fee and capital, and losses are shared. Nothing in the product states a guaranteed return. |
| **No recycling** | New money paying old investors | Every ledger account belongs to one cycle, and an entry can't touch two cycles' accounts. One cycle's money can never pay another's funders. |
| **Repayment from the sale** | Repayment depending on farmer goodwill or politics | The offtaker pays the trustee, and the trustee splits proceeds by a fixed waterfall agreed before funding. |

---

## 3. Key decisions and their trade-offs

### 3.1 Every rule lives in the database

**Decision.** The business rules are written into the database itself (PostgreSQL on Supabase), not into application code. That covers who can see what, who can do what, and what a valid action is.

- **Row-level security** decides which rows each role can read.
- Important actions are **database functions** that check the caller's role and the data before writing anything: enrolling a farmer, approving a cycle, recording a visit, confirming a payment.
- The web app talks to the database directly, with no separate server in between.

**Why.** The rules hold no matter how the database is reached: a bug in the app, a script, or someone with direct access. There is one place to read and audit them. They can also be tested exactly as they run: the automated tests load the real database migrations and prove each rule by acting as each role.

**Trade-offs**

- The logic is written in SQL, which fewer developers know well than mainstream application languages.
- The platform depends on Supabase for sign-in, file storage and the API. The data itself is standard PostgreSQL, so it remains portable.
- The original concept proposed a separate API server (NestJS) and Next.js. An early build of that API was replaced with this approach: less code to maintain, and no gap between "the rule" and "where it's enforced".

### 3.2 The platform never holds money

**Decision.** The trustee is the only role that can record money moving, and every confirmation needs the trustee's own reference, which can't be reused. Release instructions come from the cycle manager; payment confirmations come from the trustee.

**Why.** It takes custody, the root failure, off the table, and puts each movement of money in the hands of a regulated custodian.

**Trade-off.** Today the trustee confirms by hand in the app. In production this should come from a direct integration with the trustee's bank, which isn't built yet.

### 3.3 A double-entry, append-only ledger

**Decisions**

- **Whole kobo.** Money is stored as whole kobo (`bigint`), never floating point, so no rounding drift is possible.
- **Balanced entries.** Every entry has at least two lines that sum to zero, checked when the transaction commits.
- **Append-only.** Ledger tables reject edits and deletions, even by the database owner. Mistakes are corrected by reversing entries.
- **Per cycle.** Accounts belong to one cycle; platform-level accounts (such as fees) are the only exception.

**Why.** Double-entry and append-only records are what auditors and trustees expect, and they make the per-cycle "no recycling" rule something the database checks rather than something people promise.

**Trade-off.** Demo data can't be tidied away; a demo environment is reset rather than edited.

### 3.4 Separation of duties

**Decisions**

- A cycle's own manager can never approve it.
- Whoever registers a vendor can't approve it.
- Nobody can change their own role.
- Only the trustee confirms money.
- Everyone who signs up starts with the least-privileged role (investor); only an admin grants staff roles.

**Why.** Most of the historical failures needed one person or team to control several steps. Splitting them means misuse needs collusion, and leaves a trail.

### 3.5 Field verification that proves presence

**Decisions**

- **The database judges every visit.** It passes only if the GPS fix is accurate to 20 m and within 20 m of the mapped boundary, the checklist passes, the crop hasn't failed, and there is at least one photo.
- **Every farm, in order.** A milestone is verified only when every farm's latest visit passes, and milestones release in order.
- **Visits are permanent evidence.** They are append-only; a new visit supersedes an old one, never replaces it.

**Why.** "The agent said so" was never enough. The boundary check makes a visit from the village, or from the office, fail on its own.

**Limits.** A determined agent could spoof a phone's GPS. The planned counter-measures are:

- photo metadata checks (photos are uploaded as taken, so the metadata survives),
- satellite crop-health cross-checks,
- random audit visits.

### 3.6 Inputs through vouchers, with the shop kept at arm's length

**Decisions**

- **Ring-fenced money.** Voucher money is set aside when vouchers are issued: one voucher per farm, split by farm area.
- **Redemption.** It needs the voucher code plus the last four digits of the farmer's phone. The shop never sees the farmer's name or full number.
- **Guessing is stopped.** Wrong attempts lock a shop's counter after five tries in 15 minutes.
- **Vendors are vetted and paid only to a known account.** Only compliance-approved vendors can redeem, and they are paid only to their registered account. Changing that account sends the vendor back for review, and a suspended vendor's payments are held.
- **Nothing left open.** A voucher can be used in parts. Unused value returns to the cycle, and the harvest can't be closed while any voucher is open or any vendor unpaid.

**Why.** Inputs reach the farm as goods, not cash, without the platform or a manager choosing which shop gets the business. The farmer chooses among approved shops.

### 3.7 Honest returns and a fixed waterfall

**Decisions**

- **A fixed order.** Settlement always runs in the same order: the management fee, then funders' capital, then the profit split by an agreed share between funders and farmers.
- **How shares are split.** Funders share in proportion to what they put in; farmers share by kilograms delivered. If the money falls short, funders share the loss in proportion.
- **A guide, not a rating.** Investor listings show the low, expected and high outcomes from the cycle's own assumptions, and a 1–5 risk score with its reasons in plain language. The score is described as a guide for comparing cycles, not a rating.

**Why.** Returns come from farm economics, and investors see that before they commit. Paying farmers by delivered weight rewards the farms that actually produced.

### 3.8 Identity without storing identity numbers

**Decisions**

- **Hashes only.** NIN and BVN are never stored. The database keeps a keyed hash, with the key held in Supabase Vault, plus the last four digits for display.
- **One person, one record.** A second enrolment of the same identifier is refused, for farmers and for investors.
- **One piece of land, one farm.** A boundary overlapping a registered farm by more than 5% (of the smaller farm) is refused.

**Why.** Duplicate and ghost beneficiaries were a known failure in past programmes. Hashing lets the registry refuse duplicates without holding numbers that would be dangerous if leaked, which also suits the Nigeria Data Protection Act 2023.

**Trade-off.** Compliance checks identity documents by eye today. A live NIN/BVN verification service is a planned integration.

### 3.9 Investor Edition: compliance built in

**Decisions**

- **No direct table access.** Investors never read the cycle, farm or ledger tables. They see curated listings that leave out farmer names, account numbers and other investors. Field photos are shown only to investors with money in that cycle.
- **Retail cap.** Retail investors are capped at 10% of declared annual income over 12 months (the SEC crowdfunding rule). The cap counts what they declared investing elsewhere, as well as what they've invested here.
- **Classification.** Compliance, not the investor, confirms high-net-worth or institutional status.
- **Versioned disclosure.** Each pledge records which version of the risk disclosure the investor acknowledged, and a pledge against an outdated version is refused.
- **Reserved capacity.** A pledge reserves its share of the cycle until its pay-by date, so a cycle can't be oversubscribed. Direct deposits from the trustee respect those reservations.
- **Cooling-off.** During cooling-off the trustee can't add the investor's money to the cycle. Investors can withdraw until payment is confirmed.

**Why the cooling-off works this way.** The alternative was to accept the money immediately and reverse it if the investor withdrew. Blocking allocation means a withdrawal never needs a ledger reversal, and a cycle can't become "funded" on money that might leave. The cost is that the trustee waits, by default 48 hours, before confirming.

### 3.10 Government Edition: the same rules, applied to programmes

**Decisions**

- **Eligibility uses the same checks.** A programme's rules join the same readiness checklist that gates submission and approval. Those rules are the commodities, target states and LGAs, a hectare limit per farmer, cooperative membership, the input package's value per hectare, and the programme's dates. No separate approval path was needed.
- **Fixed terms.** A programme's terms are fixed once it is active, so every cycle stays under the terms it was approved with.
- **Budget ceiling.** Programme deposits are counted against its budget, and one that would overspend it is refused. Investor money in a blended cycle is counted separately.
- **Dashboards from existing records.** Dashboards are built from records the core already keeps: farms, vouchers, vendor payments, deliveries and settlement payouts. Money tracked per cycle is shared out to farms by area, while vouchers and harvest are each farm's own.
- **Under-delivery, not "defaulters".** The dashboard flags farms that delivered less than the low-yield estimate, rather than labelling defaulters. Repayment flows through the offtaker per cycle, so the records don't show an individual farmer as in default.

**Why.** The failure in past programmes was not knowing who got what and whether it came back. The answer was to make that visible from evidence that already exists, rather than adding a separate reporting process that could be filled in after the fact.

### 3.11 Field work without a connection

**Decisions**

- **An installable web app, not a native one.** The same code installs on a phone's home screen and keeps working offline: one codebase, no app store, updates arrive automatically.
- **Saved work list.** The agent's work list (farms, boundaries, names) is saved on the phone each time it is opened online.
- **Save first, then send.** Every visit, online or not, is saved on the phone with its photos first, then sent. Sending resumes where it stopped after a dropped connection.
- **No double counting.** Each visit carries the phone's own id. Sending the same visit twice returns the first result instead of recording a second visit.
- **Judged at the time of the visit.** A visit is judged by when the agent was at the farm, using the same checks as online. The server also records when it arrived, so a late sync is visible to staff.
- **No offline map imagery.** The tile providers' terms don't allow bulk offline copies. Boundaries and the GPS position still draw without imagery, and that is all the check-in needs.
- **Signing out.** It removes the saved work list (names and boundaries) from the phone, but keeps unsent visits so no evidence is lost.

**Trade-off.** An offline visit's time comes from the phone's clock. The database still refuses a visit dated before verification was requested or in the future, and the arrival time is shown, but the clock itself can't be independently proven.

### 3.12 A demo built through the real rules

**Decision.** The demo portfolio is created through the same database functions and permissions as the app, signed in as the demo user whose job each step is. It is also an automated test.

**Why.** The demo can't show anything the rules wouldn't allow, and it can't drift from them as the platform changes.

---

## 4. Deliberately left for later

These were considered and deferred, not overlooked:

- **Satellite crop-health checks** alongside agent visits (planned with Sentinel-2 imagery).
- **Live integrations:** trustee bank, payments, identity verification, insurance, weather, SMS/USSD. Each is planned as a swappable adapter, so no single provider is a dependency.
- **A farmer USSD/SMS channel**, for farmers without smartphones.
- **A secondary market** for investor positions. It is only possible if the operator's licence allows it, and it adds liquidity risk to the design.
- **Automated insurance claims:** damage flagged, insurer notified, loss assessed. Today a claim payout is recorded as a receipt.
- **Notifications** to every role, and **portals** for offtakers.

The guiding rule for what comes next is the same as for what was built: a control is only worth adding if the software enforces it.
