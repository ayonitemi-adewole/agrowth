import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const naira = (n: number) => n * 100;

interface Cap {
  kyc_status: string | null;
  classification: string | null;
  capped: boolean;
  cap_kobo: string | null;
  used_here_kobo: string;
  used_elsewhere_kobo: string;
  remaining_kobo: string | null;
}

/**
 * The Investor Edition: investor KYC and classification, the retail cap, the risk
 * disclosure, pledges that reserve a share of a cycle, cooling-off, the trustee
 * confirming payment, and what investors can and cannot see.
 */
describe('investor edition', () => {
  let db: PGlite;
  let admin: string;
  let manager: string;
  let compliance: string;
  let trustee: string;
  let agent: string;
  let ada: string; // retail investor
  let bayo: string; // high-net-worth investor
  let chidi: string; // investor who never completes KYC

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const rpc = async <T>(user: string, sql: string, params: unknown[] = []) =>
    (await as<{ r: T }>(user, `select ${sql} as r`, params))[0].r;

  let nextNin = 50_000_000_000;
  const verifiedFarm = async (lastName: string, phone: string, lon: number) => {
    const [{ id: farmer }] = await as<{ id: string }>(
      agent,
      `select public.register_farmer('Farmer', $1, $2, 'Kaduna', 'Zaria', $3) as id`,
      [lastName, phone, String(nextNin++)],
    );
    await as(compliance, `select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [farmer]);
    const [{ id }] = await as<{ id: string }>(agent, `select public.map_farm($1, $2) as id`, [
      farmer,
      JSON.stringify(square(lon, 11.2)),
    ]);
    return id;
  };

  /** An approved ₦900k cycle, open for funding, with two 1 ha farms. */
  const openCycle = async (code: string, lon: number, source = 'investor') => {
    const farms = [
      await verifiedFarm('Audu', '+2348022220001', lon),
      await verifiedFarm('Bello', '+2348022220002', lon + 0.01),
    ];
    const [{ id }] = await as<{ id: string }>(
      manager,
      `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
         budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
         price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
         funding_deadline, start_date, expected_harvest_date)
       values ($1, 'maize', '2027 wet', $2, 90000000, 50000000, 2, 3, 4,
               30000000, 38000000, 45000000, $3, $4, $5)
       returning id`,
      [code, source, day(10), day(20), day(140)],
    );
    await as(
      manager,
      `insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2), ($1, $3)`,
      [id, ...farms],
    );
    await as(
      manager,
      `insert into public.milestones (cycle_id, sequence, name, planned_date, amount_kobo)
       values ($1, 1, 'Planting', $2, 60000000), ($1, 2, 'Harvest', $3, 30000000)`,
      [id, day(25), day(130)],
    );
    await as(
      manager,
      `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes,
         price_terms, price_floor_per_tonne_kobo, document_path, signed_on)
       values ($1, 'Northern Mills Ltd', 'maize', 10, 'floor', 30000000, $2, $3)`,
      [id, `${id}/offtake.pdf`, day(0)],
    );
    await as(
      manager,
      `insert into public.insurance_policies (cycle_id, insurer_name, policy_number, cover_type,
         sum_insured_kobo, premium_kobo, loss_payee, cover_start, cover_end, document_path)
       values ($1, 'Pula Assurance', $2, 'area_yield', 90000000, 2700000,
               'Trustee on behalf of funders', $3, $4, $5)`,
      [id, `POL-${code}`, day(20), day(150), `${id}/policy.pdf`],
    );
    await as(manager, `select public.submit_cycle($1)`, [id]);
    await as(compliance, `select public.review_cycle($1, true, null)`, [id]);
    return id;
  };

  const submitKyc = (
    user: string,
    opts: { cls?: string; nin?: string; bvn?: string; income?: number; other?: number } = {},
  ) =>
    as(
      user,
      `select public.submit_investor_kyc($1, $2, $3, $4, $5, $6, $7, 'GTBank', '0123456789', $1)`,
      [
        'Investor ' + user.slice(0, 4),
        opts.cls ?? 'retail',
        opts.nin ?? String(nextNin++),
        opts.bvn ?? String(nextNin++),
        naira(opts.income ?? 5_000_000),
        naira(opts.other ?? 0),
        `${user}/id.jpg`,
      ],
    );

  const version = async () =>
    (await one<{ v: number }>(`select disclosure_version as v from public.investor_settings`)).v;

  const pledge = async (user: string, cycleId: string, amountNaira: number) =>
    rpc<{ id: string; reference: string; pay_by: string }>(
      user,
      `public.pledge_investment($1, $2, $3)`,
      [cycleId, naira(amountNaira), await version()],
    );

  /** Moves a pledge past its cooling-off period, as if the hours had passed. */
  const endCoolingOff = (pledgeId: string) =>
    db.query(
      `update public.investment_pledges set cooling_off_ends_at = now() - interval '1 minute'
        where id = $1`,
      [pledgeId],
    );

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@test.ng', 'admin');
    manager = await createUser(db, 'manager@test.ng', 'cycle_manager');
    compliance = await createUser(db, 'compliance@test.ng', 'compliance_officer');
    trustee = await createUser(db, 'trustee@test.ng', 'trustee');
    agent = await createUser(db, 'agent@test.ng', 'field_agent');
    ada = await createUser(db, 'ada@test.ng', 'investor');
    bayo = await createUser(db, 'bayo@test.ng', 'investor');
    chidi = await createUser(db, 'chidi@test.ng', 'investor');
  });

  describe('KYC', () => {
    it('only investors can submit, with valid identifiers and their own ID document', async () => {
      expect((await pgError(submitKyc(manager))).message).toMatch(/Only investor accounts/);
      expect((await pgError(submitKyc(ada, { nin: '123' }))).message).toMatch(/NIN is 11 digits/);
      const wrongDoc = await pgError(
        as(
          ada,
          `select public.submit_investor_kyc('Ada', 'retail', '12345678901', '12345678902', 1, 0,
             $1, 'GTBank', '0123456789', 'Ada')`,
          [`${bayo}/id.jpg`],
        ),
      );
      expect(wrongDoc.message).toMatch(/Upload an ID document/);
    });

    it('stores NIN and BVN only as hashes, and refuses one person registering twice', async () => {
      await submitKyc(ada, { nin: '22222222221', bvn: '33333333331', other: 100_000 });
      const row = await one<{ nin_hash: string; kyc_status: string }>(
        `select nin_hash, kyc_status from public.investor_profiles where user_id = $1`,
        [ada],
      );
      expect(row.nin_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.kyc_status).toBe('pending');

      const dup = await pgError(submitKyc(chidi, { nin: '22222222221' }));
      expect(dup.code).toBe('PT409');
    });

    it('lets investors read only their own profile; compliance and the trustee read all', async () => {
      await submitKyc(bayo, { cls: 'high_net_worth', income: 200_000_000 });
      expect(await as(ada, `select user_id from public.investor_profiles`)).toEqual([
        { user_id: ada },
      ]);
      expect(await as(compliance, `select user_id from public.investor_profiles`)).toHaveLength(2);
      expect(await as(trustee, `select user_id from public.investor_profiles`)).toHaveLength(2);
      expect(await as(manager, `select user_id from public.investor_profiles`)).toHaveLength(0);
    });

    it('only compliance verifies, and a rejection needs a reason', async () => {
      expect(
        (await pgError(as(manager, `select public.review_investor_kyc($1, true)`, [ada]))).code,
      ).toBe('PT403');
      expect(
        (await pgError(as(compliance, `select public.review_investor_kyc($1, false)`, [ada])))
          .message,
      ).toMatch(/Say why/);
      await as(compliance, `select public.review_investor_kyc($1, true, null, 'ID seen')`, [ada]);
      await as(compliance, `select public.review_investor_kyc($1, true, null, 'ID seen')`, [bayo]);
      const rows = await db.query<{ user_id: string; classification: string }>(
        `select user_id, classification from public.investor_profiles order by legal_name`,
      );
      expect(Object.fromEntries(rows.rows.map((r) => [r.user_id, r.classification]))).toEqual({
        [ada]: 'retail',
        [bayo]: 'high_net_worth',
      });
    });

    it('caps a retail investor at 10% of income, less what they invested elsewhere', async () => {
      const cap = await rpc<Cap>(ada, `public.my_investment_cap()`);
      // ₦5m income → ₦500k cap, less ₦100k declared elsewhere.
      expect(cap).toMatchObject({
        capped: true,
        cap_kobo: String(naira(500_000)),
        remaining_kobo: String(naira(400_000)),
      });
      expect(await rpc<Cap>(bayo, `public.my_investment_cap()`)).toMatchObject({
        capped: false,
        remaining_kobo: null,
      });
    });
  });

  describe('pledging', () => {
    let cycle: string;

    beforeAll(async () => {
      cycle = await openCycle('INV-MAIZE-001', 8.0);
    });

    it('needs verified KYC', async () => {
      const err = await pgError(pledge(chidi, cycle, 100_000));
      expect(err.message).toMatch(/KYC must be verified/);
    });

    it('refuses a disclosure the investor has not seen', async () => {
      const stale = await pgError(
        as(ada, `select public.pledge_investment($1, $2, $3)`, [cycle, naira(100_000), 999]),
      );
      expect(stale.message).toMatch(/risk disclosure has changed/);
    });

    it('bumps the disclosure version when the text changes, and only admins can change it', async () => {
      const before = await version();
      await as(
        manager,
        `update public.investor_settings set risk_disclosure = risk_disclosure || ' Manager edit.'`,
      );
      expect(await version()).toBe(before);
      await as(
        admin,
        `update public.investor_settings set risk_disclosure = risk_disclosure || ' Read carefully.'`,
      );
      expect(await version()).toBe(before + 1);
      await as(admin, `update public.investor_settings set cooling_off_hours = 24`);
      expect(await version()).toBe(before + 1);
    });

    it('enforces the retail cap and the minimum', async () => {
      const over = await pgError(pledge(ada, cycle, 450_000));
      expect(over.message).toMatch(/over your investment limit.*₦400,000/);
      expect((await pgError(pledge(ada, cycle, 5_000))).message).toMatch(/minimum investment/);
    });

    it('reserves capacity: a pledge holds its share against other pledges and direct deposits', async () => {
      const p = await pledge(ada, cycle, 400_000);
      expect(p.reference).toMatch(/^AGR-[A-Z2-9]{8}$/);
      expect(p.pay_by).toBe(day(7));
      expect(await rpc<Cap>(ada, `public.my_investment_cap()`)).toMatchObject({
        remaining_kobo: '0',
      });

      // ₦900k target, ₦400k reserved: ₦500k still open.
      expect((await pgError(pledge(bayo, cycle, 600_000))).message).toMatch(/Only ₦500,000/);
      const deposit = await pgError(
        as(
          trustee,
          `select public.record_funding($1, 'Off-portal fund', 'investor', $2, 'DEP-1')`,
          [cycle, naira(600_000)],
        ),
      );
      expect(deposit.message).toMatch(/reserved for investors' pledges/);
    });

    it('keeps the money out of the cycle during cooling-off, and lets the investor withdraw', async () => {
      const p = await pledge(bayo, cycle, 300_000);
      const early = await pgError(
        as(trustee, `select public.confirm_pledge_payment($1, 'BANK-B1')`, [p.id]),
      );
      expect(early.message).toMatch(/cooling-off period runs until/);

      expect((await pgError(as(ada, `select public.withdraw_pledge($1)`, [p.id]))).code).toBe(
        'PT404',
      );
      await as(bayo, `select public.withdraw_pledge($1)`, [p.id]);
      expect((await pgError(as(bayo, `select public.withdraw_pledge($1)`, [p.id]))).code).toBe(
        'PT409',
      );
      // Withdrawn: ₦500k is open again.
      await pledge(bayo, cycle, 500_000);
    });

    it('posts a confirmed payment to the ledger, linked to the investor, and fills the cycle', async () => {
      const pledges = (
        await db.query<{ id: string; investor_id: string }>(
          `select id, investor_id from public.investment_pledges
            where cycle_id = $1 and status = 'pending'`,
          [cycle],
        )
      ).rows;
      expect(pledges).toHaveLength(2);
      for (const [i, p] of pledges.entries()) {
        expect(
          (await pgError(as(manager, `select public.confirm_pledge_payment($1, 'X')`, [p.id])))
            .code,
        ).toBe('PT403');
        await endCoolingOff(p.id);
        await as(trustee, `select public.confirm_pledge_payment($1, $2)`, [p.id, `BANK-${i}`]);
      }

      const contributions = await db.query<{ investor_id: string; funder_name: string }>(
        `select investor_id, funder_name from public.funding_contributions where cycle_id = $1`,
        [cycle],
      );
      expect(contributions.rows.map((r) => r.investor_id).sort()).toEqual([ada, bayo].sort());
      expect(
        (await one<{ status: string }>(`select status from public.cycles where id = $1`, [cycle]))
          .status,
      ).toBe('funded');
      const cash = await one<{ b: string }>(
        `select balance_kobo as b from public.ledger_balances where cycle_id = $1 and code = 'TRUSTEE_CASH'`,
        [cycle],
      );
      expect(cash.b).toBe(String(naira(900_000)));
    });

    it('shows investors their own investments with the payment and cap', async () => {
      const mine = await rpc<{
        pledges: { status: string; trustee_reference: string; cycle: { code: string } }[];
        cap: Cap;
      }>(ada, `public.my_investments()`);
      expect(mine.pledges).toHaveLength(1);
      expect(mine.pledges[0]).toMatchObject({
        status: 'paid',
        cycle: { code: 'INV-MAIZE-001' },
      });
      expect(mine.cap.used_here_kobo).toBe(String(naira(400_000)));
      const bayos = await rpc<{ pledges: { status: string }[] }>(bayo, `public.my_investments()`);
      expect(bayos.pledges.map((p) => p.status).sort()).toEqual(['paid', 'withdrawn']);
    });

    it('lets a pledge lapse when its payment window passes, freeing its share', async () => {
      const other = await openCycle('INV-MAIZE-002', 8.1);
      const p = await pledge(bayo, other, 900_000);
      expect((await pgError(pledge(ada, other, 10_000))).message).toMatch(/fully subscribed/);
      await db.query(
        `update public.investment_pledges set pay_by = current_date - 1 where id = $1`,
        [p.id],
      );
      await endCoolingOff(p.id);
      const late = await pgError(
        as(trustee, `select public.confirm_pledge_payment($1, 'BANK-LATE')`, [p.id]),
      );
      expect(late.message).toMatch(/lapsed/);
      // Ada's cap is used up, but Bayo's lapsed share is open to others again.
      await as(trustee, `select public.record_funding($1, 'Fund', 'investor', $2, 'DEP-LAPSE')`, [
        other,
        naira(900_000),
      ]);
      const mine = await rpc<{ pledges: { reference: string; status: string }[] }>(
        bayo,
        `public.my_investments()`,
      );
      expect(mine.pledges.find((x) => x.reference === p.reference)?.status).toBe('lapsed');
    });
  });

  describe('what investors can see', () => {
    let open: string;
    let funded: string;
    let programme: string;

    beforeAll(async () => {
      await as(admin, `update public.investor_settings set cooling_off_hours = 0`);
      open = await openCycle('INV-SOY-001', 8.2);
      programme = await openCycle('PRG-RICE-001', 8.3, 'programme');
      funded = (
        await one<{ id: string }>(`select id from public.cycles where code = 'INV-MAIZE-001'`)
      ).id;
    });

    it('has no direct access to cycles, farms, farmers or the ledger', async () => {
      for (const table of [
        'cycles',
        'farms',
        'farmers',
        'journal_entries',
        'funding_contributions',
      ]) {
        expect(await as(ada, `select * from public.${table}`)).toHaveLength(0);
      }
    });

    it('lists open investor cycles in the marketplace, not programme ones', async () => {
      const list = await rpc<{ code: string; raised_kobo: string }[]>(
        chidi,
        `public.investor_marketplace()`,
      );
      const codes = list.map((l) => l.code);
      expect(codes).toContain('INV-SOY-001');
      expect(codes).not.toContain('PRG-RICE-001');
      expect(codes).not.toContain('INV-MAIZE-001'); // funded, no longer open
    });

    it('shows a listing without farmer names, and funded cycles only to their investors', async () => {
      const listing = await rpc<{
        farms: { name: string; boundary: unknown }[];
        offtakers: string[];
      }>(chidi, `public.investor_listing($1)`, [open]);
      expect(listing.farms).toHaveLength(2);
      expect(JSON.stringify(listing)).not.toMatch(/Audu|Bello/);
      expect(listing.offtakers).toEqual(['Northern Mills Ltd']);

      expect((await pgError(as(chidi, `select public.investor_listing($1)`, [funded]))).code).toBe(
        'PT404',
      );
      expect(
        (await pgError(as(chidi, `select public.investor_listing($1)`, [programme]))).code,
      ).toBe('PT404');
      const mine = await rpc<{ code: string; my_pledges: unknown[] }>(
        ada,
        `public.investor_listing($1)`,
        [funded],
      );
      expect(mine.code).toBe('INV-MAIZE-001');
      expect(mine.my_pledges).toHaveLength(1);
    });

    it("lets funders see their cycle's field photos and no one else's", async () => {
      const [{ id: milestone }] = await as<{ id: string }>(
        manager,
        `select id from public.milestones where cycle_id = $1 and sequence = 1`,
        [funded],
      );
      const path = `${milestone}/farm/photo.jpg`;
      expect(await rpc(ada, `public.can_read_field_photo($1)`, [path])).toBe(true);
      expect(await rpc(chidi, `public.can_read_field_photo($1)`, [path])).toBe(false);
      expect(await rpc(ada, `public.can_read_field_photo('not-a-uuid/x.jpg')`)).toBe(false);
    });

    it('with no cooling-off configured, a payment can be confirmed at once', async () => {
      const p = await pledge(bayo, open, 200_000);
      await as(trustee, `select public.confirm_pledge_payment($1, 'BANK-NOW')`, [p.id]);
      const listing = await rpc<{ raised_kobo: string; reserved_kobo: string }>(
        chidi,
        `public.investor_listing($1)`,
        [open],
      );
      expect(listing.raised_kobo).toBe(String(naira(200_000)));
      expect(listing.reserved_kobo).toBe('0');
    });
  });
});
