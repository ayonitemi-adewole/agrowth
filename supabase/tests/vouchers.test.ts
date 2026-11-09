import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square, type Tx } from './db';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface VoucherCheck {
  ok: boolean;
  message?: string;
  voucher_id?: string;
  farmer?: string;
  remaining_kobo?: string;
  unusable_reason?: string | null;
  redemption_id?: string;
}

/**
 * The vendor network and input vouchers: vendor approval, issuing vouchers from a
 * release, redeeming them at the counter, paying vendors, and closing what's unused.
 */
describe('vendors and input vouchers', () => {
  let db: PGlite;
  let admin: string;
  let manager: string;
  let compliance: string;
  let trustee: string;
  let agent: string;
  let vendorUser: string;
  let otherVendorUser: string;
  let investor: string;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await db.query<T>(sql, params)).rows[0];
  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);
  const balance = async (cycleId: string, code: string) =>
    BigInt(
      (
        await one<{ b: string }>(
          `select balance_kobo as b from public.ledger_balances where cycle_id = $1 and code = $2`,
          [cycleId, code],
        )
      )?.b ?? '0',
    );

  let nextNin = 40_000_000_000;
  /** A KYC-verified farmer with a farm of `size` degrees square (0.0009 ≈ 1 ha). */
  const verifiedFarm = async (lastName: string, phone: string, lon: number, size = 0.0009) => {
    const [{ id: farmer }] = await as<{ id: string }>(
      agent,
      `select public.register_farmer('Farmer', $1, $2, 'Kaduna', 'Zaria', $3) as id`,
      [lastName, phone, String(nextNin++)],
    );
    await as(compliance, `select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [farmer]);
    const [{ id }] = await as<{ id: string }>(agent, `select public.map_farm($1, $2) as id`, [
      farmer,
      JSON.stringify(square(lon, 11.2, size)),
    ]);
    return id;
  };

  interface Built {
    cycleId: string;
    farms: string[];
    milestones: string[];
    offtakeId: string;
  }

  /** An approved, fully funded ₦900k cycle with a 1 ha and a 2 ha farm. */
  const buildFundedCycle = async (code: string, lon: number): Promise<Built> => {
    const farms = [
      await verifiedFarm('Audu', '+2348011110001', lon),
      // ~2 ha: sqrt(2) × 0.0009°.
      await verifiedFarm('Bello', '+2348011110002', lon + 0.01, 0.0012728),
    ];
    const [{ id: cycleId }] = await as<{ id: string }>(
      manager,
      `insert into public.cycles (code, crop, season, funding_source, target_amount_kobo,
         budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha,
         price_low_per_tonne_kobo, price_expected_per_tonne_kobo, price_high_per_tonne_kobo,
         funding_deadline, start_date, expected_harvest_date)
       values ($1, 'maize', '2027 wet', 'investor', 90000000, 40000000, 2, 3, 4,
               30000000, 38000000, 45000000, $2, $3, $4)
       returning id`,
      [code, day(10), day(20), day(140)],
    );
    await as(
      manager,
      `insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2), ($1, $3)`,
      [cycleId, ...farms],
    );
    const milestones = (
      await as<{ id: string }>(
        manager,
        `insert into public.milestones (cycle_id, sequence, name, planned_date, amount_kobo)
         values ($1, 1, 'Planting', $2, 60000000), ($1, 2, 'Harvest', $3, 30000000)
         returning id`,
        [cycleId, day(25), day(130)],
      )
    ).map((m) => m.id);
    const [{ id: offtakeId }] = await as<{ id: string }>(
      manager,
      `insert into public.offtake_contracts (cycle_id, buyer_name, commodity, volume_tonnes,
         price_terms, price_floor_per_tonne_kobo, document_path, signed_on)
       values ($1, 'Northern Mills Ltd', 'maize', 10, 'floor', 30000000, $2, $3) returning id`,
      [cycleId, `${cycleId}/offtake.pdf`, day(0)],
    );
    await as(
      manager,
      `insert into public.insurance_policies (cycle_id, insurer_name, policy_number, cover_type,
         sum_insured_kobo, premium_kobo, loss_payee, cover_start, cover_end, document_path)
       values ($1, 'Pula Assurance', $2, 'area_yield', 90000000, 2700000,
               'Trustee on behalf of funders', $3, $4, $5)`,
      [cycleId, `POL-${code}`, day(20), day(150), `${cycleId}/policy.pdf`],
    );
    await as(manager, `select public.submit_cycle($1)`, [cycleId]);
    await as(compliance, `select public.review_cycle($1, true, null)`, [cycleId]);
    await as(
      trustee,
      `select public.record_funding($1, 'Adaeze Okoro', 'investor', 90000000, $2)`,
      [cycleId, `${code}-DEP`],
    );
    return { cycleId, farms, milestones, offtakeId };
  };

  const verify = async (built: Built, milestone: string, lon: number) => {
    await as(manager, `select public.request_milestone_verification($1)`, [milestone]);
    const lons = [lon, lon + 0.01];
    for (const [i, farm] of built.farms.entries()) {
      await as(
        agent,
        `select public.record_field_visit($1, $2, $3, 11.20045, 5, 'good', true, $4)`,
        [farm, milestone, lons[i] + 0.00045, ['visit/photo.jpg']],
      );
    }
  };

  const instruct = (milestone: string, lines: object[]) =>
    as(manager, `select public.instruct_milestone_release($1, $2)`, [
      milestone,
      JSON.stringify(lines),
    ]);

  const voucherLine = (amount: number) => ({
    payee_kind: 'input_voucher',
    payee_name: 'Farmers (input vouchers)',
    payee_account: 'Redeemable at approved agro-dealers',
    purpose: 'Seed and fertiliser',
    amount_kobo: amount,
  });
  const bankLine = (kind: string, amount: number) => ({
    payee_kind: kind,
    payee_name: kind === 'farmer_cash' ? 'Cooperative labour fund' : 'Samaru Tractor Hire',
    payee_account: 'GTBank 0234567891',
    purpose: kind === 'farmer_cash' ? 'Labour' : 'Ploughing',
    amount_kobo: amount,
  });

  const lineFor = async (milestone: string, kind: string) =>
    (
      await one<{ id: string }>(
        `select id from public.disbursements where milestone_id = $1 and payee_kind = $2`,
        [milestone, kind],
      )
    ).id;

  const vouchersOf = async (milestone: string) =>
    (
      await db.query<{
        id: string;
        code: string;
        farm_id: string;
        value_kobo: string;
        redeemed_kobo: string;
        status: string;
        expires_on: string;
      }>(
        `select id, code, farm_id, value_kobo::text, redeemed_kobo::text, status, expires_on::text
           from public.vouchers where milestone_id = $1 order by value_kobo`,
        [milestone],
      )
    ).rows;

  const check = async (user: string, code: string, last4: string) =>
    (
      await as<{ r: VoucherCheck }>(user, `select public.check_voucher($1, $2) as r`, [code, last4])
    )[0].r;
  const redeem = async (user: string, code: string, last4: string, amount: number, items: string) =>
    (
      await as<{ r: VoucherCheck }>(user, `select public.redeem_voucher($1, $2, $3, $4) as r`, [
        code,
        last4,
        amount,
        items,
      ])
    )[0].r;

  let vendorId: string;
  let otherVendorId: string;

  const registerVendor = async (name: string, account: string) =>
    (
      await as<{ id: string }>(
        agent,
        `insert into public.vendors (name, kind, registration_number, contact_phone, state, lga,
           bank_name, account_number, account_name)
         values ($1, 'agro_dealer', $2, '+2348099990000', 'Kaduna', 'Zaria', 'Access Bank', $3, $1)
         returning id`,
        [name, `RC-${account}`, account],
      )
    )[0].id;

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@agrowth.test', 'admin');
    manager = await createUser(db, 'manager@agrowth.test', 'cycle_manager');
    compliance = await createUser(db, 'compliance@agrowth.test', 'compliance_officer');
    trustee = await createUser(db, 'trustee@agrowth.test', 'trustee');
    agent = await createUser(db, 'agent@agrowth.test', 'field_agent');
    vendorUser = await createUser(db, 'counter@zariaagro.test', 'vendor');
    otherVendorUser = await createUser(db, 'counter@samaruinputs.test', 'vendor');
    investor = await createUser(db, 'investor@example.com', 'investor');

    vendorId = await registerVendor('Zaria Agro Inputs Ltd', '0123456789');
    otherVendorId = await registerVendor('Samaru Inputs', '0987654321');
  });

  describe('vendor registry', () => {
    it('lets field staff register vendors, but not investors or vendors themselves', async () => {
      const row = await one<{ status: string; registered_by: string }>(
        `select status, registered_by from public.vendors where id = $1`,
        [vendorId],
      );
      expect(row).toEqual({ status: 'pending', registered_by: agent });
      for (const user of [investor, vendorUser]) {
        const err = await pgError(
          as(
            user,
            `insert into public.vendors (name, contact_phone, state, lga, bank_name, account_number, account_name)
             values ('Fake Shop', '+2348000000000', 'Kaduna', 'Zaria', 'Bank', '1111111111', 'Fake')`,
          ),
        );
        expect(err.code).toBe('42501');
      }
    });

    it('rejects account numbers that are not 10 digits', async () => {
      const err = await pgError(
        as(
          agent,
          `insert into public.vendors (name, contact_phone, state, lga, bank_name, account_number, account_name)
           values ('Short Account', '+2348000000000', 'Kaduna', 'Zaria', 'Bank', '12345', 'Short')`,
        ),
      );
      expect(err.code).toBe('23514');
    });

    it('lets only compliance approve, and needs a reason to suspend', async () => {
      expect(
        (await pgError(as(manager, `select public.set_vendor_status($1, 'approved')`, [vendorId])))
          .code,
      ).toBe('PT403');
      expect(
        (
          await pgError(
            as(compliance, `select public.set_vendor_status($1, 'suspended')`, [vendorId]),
          )
        ).message,
      ).toMatch(/reason/);
      await as(compliance, `select public.set_vendor_status($1, 'approved')`, [vendorId]);
      await as(compliance, `select public.set_vendor_status($1, 'approved')`, [otherVendorId]);
      expect(
        (
          await one<{ status: string }>(`select status from public.vendors where id = $1`, [
            vendorId,
          ])
        ).status,
      ).toBe('approved');
    });

    it('sends a vendor back for review when its bank details change', async () => {
      await as(agent, `update public.vendors set account_number = '0123456780' where id = $1`, [
        otherVendorId,
      ]);
      const row = await one<{ status: string; status_note: string }>(
        `select status, status_note from public.vendors where id = $1`,
        [otherVendorId],
      );
      expect(row.status).toBe('pending');
      expect(row.status_note).toMatch(/Bank details changed/);
      // Other edits keep the approval.
      await as(compliance, `select public.set_vendor_status($1, 'approved')`, [otherVendorId]);
      await as(agent, `update public.vendors set address = 'Samaru market' where id = $1`, [
        otherVendorId,
      ]);
      expect(
        (
          await one<{ status: string }>(`select status from public.vendors where id = $1`, [
            otherVendorId,
          ])
        ).status,
      ).toBe('approved');
    });

    it('does not let staff set status or the linked account directly', async () => {
      expect(
        (
          await pgError(
            as(agent, `update public.vendors set status = 'approved' where id = $1`, [vendorId]),
          )
        ).code,
      ).toBe('42501');
      expect(
        (
          await pgError(
            as(agent, `update public.vendors set user_id = $2 where id = $1`, [vendorId, agent]),
          )
        ).code,
      ).toBe('42501');
    });

    it('links a vendor sign-in only by admin, only to a vendor-role account, once', async () => {
      expect(
        (
          await pgError(
            as(manager, `select public.link_vendor_account($1, $2)`, [vendorId, vendorUser]),
          )
        ).code,
      ).toBe('PT403');
      expect(
        (
          await pgError(
            as(admin, `select public.link_vendor_account($1, $2)`, [vendorId, investor]),
          )
        ).message,
      ).toMatch(/Vendor role/);
      await as(admin, `select public.link_vendor_account($1, $2)`, [vendorId, vendorUser]);
      await as(admin, `select public.link_vendor_account($1, $2)`, [
        otherVendorId,
        otherVendorUser,
      ]);
      expect(
        (
          await pgError(
            as(admin, `select public.link_vendor_account($1, $2)`, [otherVendorId, vendorUser]),
          )
        ).code,
      ).toBe('PT409');
    });

    it('shows a vendor its own record only', async () => {
      const rows = await as<{ id: string }>(vendorUser, `select id from public.vendors`);
      expect(rows.map((r) => r.id)).toEqual([vendorId]);
      expect(await as(investor, `select id from public.vendors`)).toEqual([]);
    });
  });

  describe('a milestone paid partly in vouchers', () => {
    const lon = 9.1;
    let built: Built;
    let vouchers: Awaited<ReturnType<typeof vouchersOf>>;

    beforeAll(async () => {
      built = await buildFundedCycle('KD-VOUCHER-01', lon);
      await verify(built, built.milestones[0], lon);
      // ₦600k: ₦450k vouchers, ₦90k ploughing, ₦60k cash.
      await instruct(built.milestones[0], [
        voucherLine(45000000),
        bankLine('service_provider', 9000000),
        bankLine('farmer_cash', 6000000),
      ]);
    });

    it('cannot pay a voucher line as a bank transfer', async () => {
      const id = await lineFor(built.milestones[0], 'input_voucher');
      const err = await pgError(
        as(trustee, `select public.confirm_disbursement($1, 'PAY-X')`, [id]),
      );
      expect(err.message).toMatch(/issued, not paid/);
    });

    it('lets only the trustee issue vouchers', async () => {
      const id = await lineFor(built.milestones[0], 'input_voucher');
      expect((await pgError(as(manager, `select public.issue_vouchers($1)`, [id]))).code).toBe(
        'PT403',
      );
      const bank = await lineFor(built.milestones[0], 'service_provider');
      expect(
        (await pgError(as(trustee, `select public.issue_vouchers($1)`, [bank]))).message,
      ).toMatch(/bank payment/);
    });

    it('issues one voucher per farm, split by area, and ring-fences the money', async () => {
      const id = await lineFor(built.milestones[0], 'input_voucher');
      const [{ n }] = await as<{ n: number }>(trustee, `select public.issue_vouchers($1) as n`, [
        id,
      ]);
      expect(n).toBe(2);
      vouchers = await vouchersOf(built.milestones[0]);
      expect(vouchers.map((v) => v.farm_id).sort()).toEqual([...built.farms].sort());
      const total = vouchers.reduce((s, v) => s + BigInt(v.value_kobo), 0n);
      expect(total).toBe(45000000n);
      // The 2 ha farm gets about twice the 1 ha farm's share.
      const ratio = Number(vouchers[1].value_kobo) / Number(vouchers[0].value_kobo);
      expect(ratio).toBeGreaterThan(1.95);
      expect(ratio).toBeLessThan(2.05);
      for (const v of vouchers) {
        expect(v.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
        expect(v.status).toBe('active');
        expect(v.expires_on).toBe(day(25 + 60));
      }
      expect(await balance(built.cycleId, 'VOUCHER_RESERVE')).toBe(45000000n);
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(45000000n);
      expect(
        (
          await one<{ status: string }>(`select status from public.disbursements where id = $1`, [
            id,
          ])
        ).status,
      ).toBe('executed');
      // Bank payments still outstanding, so the milestone isn't released yet.
      expect(
        (
          await one<{ status: string }>(`select status from public.milestones where id = $1`, [
            built.milestones[0],
          ])
        ).status,
      ).toBe('verified');
    });

    it('cannot issue the same line twice', async () => {
      const id = await lineFor(built.milestones[0], 'input_voucher');
      expect((await pgError(as(trustee, `select public.issue_vouchers($1)`, [id]))).code).toBe(
        'PT409',
      );
    });

    it('releases the milestone once the bank payments are confirmed too', async () => {
      await as(trustee, `select public.confirm_disbursement($1, 'VCH-PAY-1')`, [
        await lineFor(built.milestones[0], 'service_provider'),
      ]);
      await as(trustee, `select public.confirm_disbursement($1, 'VCH-PAY-2')`, [
        await lineFor(built.milestones[0], 'farmer_cash'),
      ]);
      expect(
        (
          await one<{ status: string }>(`select status from public.milestones where id = $1`, [
            built.milestones[0],
          ])
        ).status,
      ).toBe('released');
      expect(
        (
          await one<{ status: string }>(`select status from public.cycles where id = $1`, [
            built.cycleId,
          ])
        ).status,
      ).toBe('in_progress');
      // Reserved money can't be spent on bank payments: only ₦300k is free.
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(30000000n);
    });

    it('lets only approved, linked vendors look up vouchers', async () => {
      const code = vouchers[0].code;
      expect((await pgError(check(manager, code, '0001'))).code).toBe('PT403');
      expect((await pgError(check(investor, code, '0001'))).code).toBe('PT403');
    });

    it('checks a code with the farmer’s phone, and reveals nothing on a mismatch', async () => {
      const small = vouchers[0];
      const farmPhone = small.farm_id === built.farms[0] ? '0001' : '0002';
      const wrongPhone = farmPhone === '0001' ? '0002' : '0001';

      const miss = await check(vendorUser, small.code, wrongPhone);
      expect(miss.ok).toBe(false);
      expect(miss.voucher_id).toBeUndefined();
      const unknown = await check(vendorUser, 'AAAAAAAAAAAA', farmPhone);
      expect(unknown).toEqual(miss);

      // Lower case and dashes are accepted, as farmers read the code out.
      const formatted = small.code.toLowerCase().replace(/(.{4})(?!$)/g, '$1-');
      const hit = await check(vendorUser, formatted, farmPhone);
      expect(hit.ok).toBe(true);
      expect(hit.voucher_id).toBe(small.id);
      expect(hit.farmer).toMatch(/^Farmer [AB]\.$/);
      expect(hit.remaining_kobo).toBe(small.value_kobo);
      expect(hit.unusable_reason).toBeNull();
      expect(JSON.stringify(hit)).not.toMatch(/23480/);
    });

    it('redeems in parts, refuses more than is left, and marks the voucher used', async () => {
      const small = vouchers[0];
      const phone = small.farm_id === built.farms[0] ? '0001' : '0002';
      const value = Number(small.value_kobo);

      const first = await redeem(
        vendorUser,
        small.code,
        phone,
        10000000,
        '25 kg certified maize seed',
      );
      expect(first.ok).toBe(true);
      expect(first.remaining_kobo).toBe(String(value - 10000000));

      const err = await pgError(redeem(otherVendorUser, small.code, phone, value, '4 bags NPK'));
      expect(err.message).toMatch(/only has ₦/);
      expect((await pgError(redeem(vendorUser, small.code, phone, 100, ''))).message).toMatch(
        /List what you supplied/,
      );

      const rest = await redeem(
        otherVendorUser,
        small.code,
        phone,
        value - 10000000,
        '4 bags NPK 15-15-15',
      );
      expect(rest.remaining_kobo).toBe('0');
      const after = await one<{ status: string; redeemed_kobo: string }>(
        `select status, redeemed_kobo::text from public.vouchers where id = $1`,
        [small.id],
      );
      expect(after).toEqual({ status: 'redeemed', redeemed_kobo: small.value_kobo });
      expect((await check(vendorUser, small.code, phone)).unusable_reason).toMatch(/used in full/);
    });

    it('shows each vendor only its own redemptions', async () => {
      const mine = await as<{ vendor_id: string }>(
        vendorUser,
        `select vendor_id from public.voucher_redemptions`,
      );
      expect(mine.length).toBe(1);
      expect(mine.every((r) => r.vendor_id === vendorId)).toBe(true);
      // And the voucher it redeemed, but not the others.
      const seen = await as<{ id: string }>(vendorUser, `select id from public.vouchers`);
      expect(seen.map((v) => v.id)).toEqual([vouchers[0].id]);
    });

    it('cannot complete the harvest while vouchers are open or vendors unpaid', async () => {
      await verify(built, built.milestones[1], lon);
      await instruct(built.milestones[1], [bankLine('service_provider', 30000000)]);
      await as(trustee, `select public.confirm_disbursement($1, 'VCH-PAY-3')`, [
        await lineFor(built.milestones[1], 'service_provider'),
      ]);
      const err = await pgError(as(manager, `select public.complete_harvest($1)`, [built.cycleId]));
      expect(err.message).toMatch(/1 input voucher\(s\) are still open/);
    });

    it('voids an unpaid redemption and puts the value back on the voucher', async () => {
      const big = vouchers[1];
      const phone = big.farm_id === built.farms[0] ? '0001' : '0002';
      const r = await redeem(vendorUser, big.code, phone, 5000000, 'Herbicide, 4 litres');
      expect(
        (
          await pgError(
            as(vendorUser, `select public.void_redemption($1, 'oops')`, [r.redemption_id]),
          )
        ).code,
      ).toBe('PT403');
      await as(manager, `select public.void_redemption($1, 'Goods not handed over')`, [
        r.redemption_id,
      ]);
      const v = await one<{ redeemed_kobo: string }>(
        `select redeemed_kobo::text from public.vouchers where id = $1`,
        [big.id],
      );
      expect(v.redeemed_kobo).toBe('0');
      expect(
        (
          await pgError(
            as(trustee, `select public.confirm_redemption_payment($1, 'X')`, [r.redemption_id]),
          )
        ).message,
      ).toMatch(/voided/);
    });

    it('closes a voucher and returns what was unused to the cycle', async () => {
      const big = vouchers[1];
      const phone = big.farm_id === built.farms[0] ? '0001' : '0002';
      await redeem(vendorUser, big.code, phone, 20000000, '6 bags urea');
      const cashBefore = await balance(built.cycleId, 'TRUSTEE_CASH');
      expect(
        (await pgError(as(manager, `select public.close_voucher($1, '')`, [big.id]))).code,
      ).toBe('PT400');
      await as(manager, `select public.close_voucher($1, 'Season inputs complete')`, [big.id]);
      const unused = BigInt(big.value_kobo) - 20000000n;
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(cashBefore + unused);
      // What's left in the reserve is exactly what vendors are owed.
      const [{ owed }] = (
        await db.query<{ owed: string }>(
          `select sum(amount_kobo)::text as owed from public.voucher_redemptions
            where cycle_id = $1 and paid_at is null and voided_at is null`,
          [built.cycleId],
        )
      ).rows;
      expect(await balance(built.cycleId, 'VOUCHER_RESERVE')).toBe(BigInt(owed));
      expect((await check(vendorUser, big.code, phone)).unusable_reason).toMatch(/closed/);
      const err = await pgError(as(manager, `select public.complete_harvest($1)`, [built.cycleId]));
      expect(err.message).toMatch(/3 voucher redemption\(s\) still need paying/);
    });

    it('holds payments to a suspended vendor', async () => {
      await as(
        compliance,
        `select public.set_vendor_status($1, 'suspended', 'Under investigation')`,
        [otherVendorId],
      );
      const [{ id }] = (
        await db.query<{ id: string }>(
          `select id from public.voucher_redemptions where vendor_id = $1`,
          [otherVendorId],
        )
      ).rows;
      expect(
        (await pgError(as(trustee, `select public.confirm_redemption_payment($1, 'VEN-X')`, [id])))
          .message,
      ).toMatch(/on hold/);
      // A suspended vendor can't redeem either.
      expect((await pgError(check(otherVendorUser, vouchers[0].code, '0001'))).message).toMatch(
        /suspended/,
      );
      await as(compliance, `select public.set_vendor_status($1, 'approved')`, [otherVendorId]);
    });

    it('pays vendors from the reserve, then lets the harvest complete', async () => {
      const unpaid = (
        await db.query<{ id: string }>(
          `select id from public.voucher_redemptions
            where cycle_id = $1 and paid_at is null and voided_at is null order by redeemed_at`,
          [built.cycleId],
        )
      ).rows;
      expect(
        (
          await pgError(
            as(manager, `select public.confirm_redemption_payment($1, 'VEN-1')`, [unpaid[0].id]),
          )
        ).code,
      ).toBe('PT403');
      for (const [i, r] of unpaid.entries()) {
        await as(trustee, `select public.confirm_redemption_payment($1, $2)`, [r.id, `VEN-${i}`]);
      }
      expect(
        (
          await pgError(
            as(trustee, `select public.confirm_redemption_payment($1, 'VEN-9')`, [unpaid[0].id]),
          )
        ).message,
      ).toMatch(/already been paid/);
      expect(await balance(built.cycleId, 'VOUCHER_RESERVE')).toBe(0n);

      await as(manager, `select public.complete_harvest($1)`, [built.cycleId]);
      // Everything deployed: ₦90k + ₦60k + ₦300k by bank, plus what vendors supplied.
      const supplied = Number(vouchers[0].value_kobo) + 20000000;
      expect(await balance(built.cycleId, 'FARM_DEPLOYMENT')).toBe(
        BigInt(9000000 + 6000000 + 30000000 + supplied),
      );
      expect(
        (await balance(built.cycleId, 'TRUSTEE_CASH')) +
          (await balance(built.cycleId, 'FARM_DEPLOYMENT')),
      ).toBe(90000000n);
    });
  });

  describe('expiry and guessing', () => {
    const lon = 9.3;
    let built: Built;

    beforeAll(async () => {
      built = await buildFundedCycle('KD-VOUCHER-02', lon);
      await verify(built, built.milestones[0], lon);
      await instruct(built.milestones[0], [voucherLine(60000000)]);
    });

    it('rejects an expiry date that is not in the future', async () => {
      const id = await lineFor(built.milestones[0], 'input_voucher');
      expect(
        (await pgError(as(trustee, `select public.issue_vouchers($1, current_date)`, [id])))
          .message,
      ).toMatch(/expire after today/);
      await as(trustee, `select public.issue_vouchers($1, $2::date)`, [id, day(1)]);
      // Only vouchers: the milestone is released straight away.
      expect(
        (
          await one<{ status: string }>(`select status from public.milestones where id = $1`, [
            built.milestones[0],
          ])
        ).status,
      ).toBe('released');
    });

    it('refuses an expired voucher and closes expired ones in bulk', async () => {
      // Move time forward by back-dating the expiry (as the database owner).
      await db.query(
        `update public.vouchers set expires_on = current_date - 1 where cycle_id = $1`,
        [built.cycleId],
      );
      const [v] = await vouchersOf(built.milestones[0]);
      const phone = v.farm_id === built.farms[0] ? '0001' : '0002';
      expect((await check(vendorUser, v.code, phone)).unusable_reason).toMatch(/expired/);
      expect((await pgError(redeem(vendorUser, v.code, phone, 100, 'Seed'))).message).toMatch(
        /expired/,
      );

      const [{ n }] = await as<{ n: number }>(
        manager,
        `select public.close_expired_vouchers($1) as n`,
        [built.cycleId],
      );
      expect(n).toBe(2);
      expect(await balance(built.cycleId, 'VOUCHER_RESERVE')).toBe(0n);
      expect(await balance(built.cycleId, 'TRUSTEE_CASH')).toBe(90000000n);
    });

    it('locks a vendor out after 5 wrong guesses in 15 minutes', async () => {
      const guesser = await createUser(db, 'guesser@shop.test', 'vendor');
      const shop = await registerVendor('Guess Shop', '0555555555');
      await as(compliance, `select public.set_vendor_status($1, 'approved')`, [shop]);
      await as(admin, `select public.link_vendor_account($1, $2)`, [shop, guesser]);
      for (let i = 0; i < 5; i++) {
        expect((await check(guesser, `ZZZZZZZZZZZ${i + 2}`, '1234')).ok).toBe(false);
      }
      expect((await pgError(check(guesser, 'ZZZZZZZZZZZZ', '1234'))).code).toBe('PT429');
      expect((await pgError(redeem(guesser, 'ZZZZZZZZZZZZ', '1234', 100, 'Seed'))).code).toBe(
        'PT429',
      );
      // Other vendors are unaffected.
      expect((await check(vendorUser, 'ZZZZZZZZZZZZ', '1234')).ok).toBe(false);
    });
  });

  it('keeps vouchers and redemptions read-only through the API', async () => {
    for (const sql of [
      `update public.vouchers set redeemed_kobo = 0`,
      `delete from public.vouchers`,
      `update public.voucher_redemptions set paid_at = now()`,
    ]) {
      expect((await pgError(as(manager, sql))).code).toBe('42501');
    }
    expect((await pgError(as(manager, `select * from private.voucher_attempts`))).code).toBe(
      '42501',
    );
  });
});
