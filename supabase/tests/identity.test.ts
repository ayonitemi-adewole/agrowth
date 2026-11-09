import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { compare, isoDate, phoneKey } from '../functions/_shared/identity/compare';
import { dojahProvider } from '../functions/_shared/identity/dojah';
import { mockProvider } from '../functions/_shared/identity/mock';
import { providerFromEnv } from '../functions/_shared/identity/providers';
import { runIdentityCheck, type CheckStore } from '../functions/_shared/identity/run';
import type { NumberType, Subject } from '../functions/_shared/identity/types';
import { asService, asUser, createDb, createUser, pgError, type Tx } from './db';

describe('identity matching', () => {
  const record = {
    first_name: 'AMINA',
    last_name: 'Ibrahim',
    middle_name: 'Zainab',
    date_of_birth: '21-Apr-1990',
    phones: ['08031234567'],
  };

  it('reads the date and phone formats providers send', () => {
    expect(isoDate('1990-04-21')).toBe('1990-04-21');
    expect(isoDate('21-04-1990')).toBe('1990-04-21');
    expect(isoDate('21/04/1990')).toBe('1990-04-21');
    expect(isoDate('21-Apr-1990')).toBe('1990-04-21');
    expect(isoDate('1990-02-30')).toBeNull();
    expect(isoDate('soon')).toBeNull();
    expect(phoneKey('+234 803 123 4567')).toBe(phoneKey('08031234567'));
  });

  it('matches a farmer on names, date of birth and phone', () => {
    const claimed = {
      first_name: 'Amina',
      last_name: 'Ibrahim',
      full_name: 'Amina Ibrahim',
      date_of_birth: '1990-04-21',
      phone: '+2348031234567',
    };
    expect(compare(claimed, record)).toEqual({
      status: 'match',
      fields: { first_name: true, last_name: true, date_of_birth: true, phone: true },
    });
    // Enrolled under the middle name: still the same person.
    expect(compare({ ...claimed, first_name: 'Zainab' }, record).status).toBe('match');
  });

  it('calls a changed phone or date partial, and a different name no match', () => {
    const claimed = {
      first_name: 'Amina',
      last_name: 'Ibrahim',
      full_name: 'Amina Ibrahim',
      phone: '+2348099999999',
    };
    expect(compare(claimed, record)).toEqual({
      status: 'partial',
      fields: { first_name: true, last_name: true, date_of_birth: null, phone: false },
    });
    expect(
      compare({ ...claimed, first_name: 'Grace', last_name: 'Eze', phone: null }, record).status,
    ).toBe('no_match');
  });

  it("matches an investor's legal name against the record's first and last names", () => {
    expect(compare({ full_name: 'Ibrahim, Amina Z.' }, record).status).toBe('match');
    expect(compare({ full_name: 'Amina Musa' }, record).status).toBe('partial');
  });

  it('uses the simulated provider unless Dojah is configured', () => {
    expect(providerFromEnv(() => undefined).name).toBe('mock');
    const env = { IDENTITY_PROVIDER: 'dojah', DOJAH_APP_ID: 'app', DOJAH_SECRET_KEY: 'sk' };
    expect(providerFromEnv((k) => env[k as keyof typeof env]).name).toBe('dojah');
    expect(() => providerFromEnv((k) => (k === 'IDENTITY_PROVIDER' ? 'dojah' : undefined))).toThrow(
      /DOJAH_APP_ID/,
    );
  });
});

describe('Dojah adapter', () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch = (status: number, body: unknown) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  const dojah = (status: number, body: unknown) =>
    dojahProvider({
      appId: 'app-1',
      secretKey: 'sk-1',
      baseUrl: 'https://sandbox.dojah.io/',
      fetch: fakeFetch(status, body),
    });
  const claimed = { full_name: 'x' };

  it('looks up a NIN and keeps only names, date of birth and phones', async () => {
    const result = await dojah(200, {
      entity: {
        first_name: 'Amina',
        last_name: 'Ibrahim',
        middle_name: '',
        date_of_birth: '1990-04-21',
        phone_number: '08031234567',
        photo: 'base64…',
      },
    }).lookup('nin', '70123456789', claimed);
    expect(calls.at(-1)).toEqual({
      url: 'https://sandbox.dojah.io/api/v1/kyc/nin?nin=70123456789',
      headers: { AppId: 'app-1', Authorization: 'sk-1' },
    });
    expect(result).toEqual({
      found: true,
      record: {
        first_name: 'Amina',
        last_name: 'Ibrahim',
        middle_name: null,
        date_of_birth: '1990-04-21',
        phones: ['08031234567'],
      },
    });
  });

  it('uses the full BVN lookup and reads both phone numbers', async () => {
    const result = await dojah(200, {
      entity: {
        first_name: 'A',
        last_name: 'B',
        phone_number1: '0803',
        phone_number2: '0809',
      },
    }).lookup('bvn', '22222222222', claimed);
    expect(calls.at(-1)!.url).toBe('https://sandbox.dojah.io/api/v1/kyc/bvn/full?bvn=22222222222');
    expect(result.found && result.record.phones).toEqual(['0803', '0809']);
  });

  it('tells "no such number" apart from "could not answer"', async () => {
    expect(await dojah(404, { error: 'Not found' }).lookup('nin', '1', claimed)).toEqual({
      found: false,
    });
    await expect(dojah(401, {}).lookup('nin', '1', claimed)).rejects.toThrow(/AppId/);
    await expect(dojah(402, {}).lookup('nin', '1', claimed)).rejects.toThrow(/credit/);
    await expect(dojah(500, {}).lookup('nin', '1', claimed)).rejects.toThrow(/HTTP 500/);
  });
});

/**
 * Identity checks in the database, driven by the same code the identity-check Edge
 * Function runs, with the simulated provider.
 */
describe('identity checks', () => {
  let db: PGlite;
  let agent: string;
  let compliance: string;
  let ada: string;
  let bayo: string;

  const as = <T>(user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, async (tx: Tx) => (await tx.query<T>(sql, params)).rows);

  /** A CheckStore like the Edge Function's: start as the caller, complete as the service. */
  const store = (caller: string): CheckStore => ({
    start: async (r, provider) =>
      (
        await as<{ r: { check_id: string; claimed: never } }>(
          caller,
          `select public.start_identity_check($1, $2, $3, $4, $5) as r`,
          [r.subject, r.subject_id, r.number_type, r.number, provider],
        )
      )[0].r,
    complete: async (a) => {
      await asService(db, (tx) =>
        tx.query(`select public.complete_identity_check($1, $2, $3, $4, $5)`, [
          a.p_check_id,
          a.p_status,
          a.p_fields && JSON.stringify(a.p_fields),
          a.p_provider_reference,
          a.p_error_message,
        ]),
      );
    },
  });
  const check = (caller: string, subject: Subject, id: string, type: NumberType, number: string) =>
    runIdentityCheck(mockProvider, store(caller), {
      subject,
      subject_id: id,
      number_type: type,
      number,
    });

  const enrol = async (nin: string | null, bvn: string | null, last = 'Ibrahim') =>
    (
      await as<{ id: string }>(
        agent,
        `select public.register_farmer('Amina', $1, '+2348031234567', 'Kaduna', 'Zaria',
           $2, $3, null, '1990-04-21') as id`,
        [last, nin, bvn],
      )
    )[0].id;
  const kyc = (farmer: string, note: string | null = null) =>
    as(compliance, `select public.set_farmer_kyc($1, 'verified', $2)`, [farmer, note]);

  beforeAll(async () => {
    db = await createDb();
    agent = await createUser(db, 'agent@agrowth.test', 'field_agent');
    compliance = await createUser(db, 'compliance@agrowth.test', 'compliance_officer');
    ada = await createUser(db, 'ada@agrowth.test', 'investor');
    bayo = await createUser(db, 'bayo@agrowth.test', 'investor');
  });

  it('checks a farmer and records only the outcome', async () => {
    const farmer = await enrol('61000000001', null);
    const result = await check(agent, 'farmer', farmer, 'nin', '6100 0000 001');
    expect(result).toMatchObject({
      provider: 'mock',
      status: 'match',
      fields: { first_name: true, last_name: true, date_of_birth: true, phone: true },
    });
    const { rows } = await db.query(
      `select subject, number_type, provider, status, requested_by, completed_at is not null as done
         from public.identity_checks where farmer_id = $1`,
      [farmer],
    );
    expect(rows).toEqual([
      {
        subject: 'farmer',
        number_type: 'nin',
        provider: 'mock',
        status: 'match',
        requested_by: agent,
        done: true,
      },
    ]);
  });

  it('records each answer the provider can give', async () => {
    const farmer = await enrol('61000020000', '22100011111');
    expect((await check(agent, 'farmer', farmer, 'nin', '61000020000')).status).toBe('not_found');
    expect((await check(agent, 'farmer', farmer, 'bvn', '22100011111')).status).toBe('no_match');

    const other = await enrol('61000032222', '22100049999');
    expect((await check(agent, 'farmer', other, 'nin', '61000032222')).status).toBe('partial');
    const down = await check(agent, 'farmer', other, 'bvn', '22100049999');
    expect(down).toMatchObject({
      status: 'error',
      error_message: expect.stringMatching(/unavailable/),
    });
  });

  it('only checks the number on record, for people the caller may check', async () => {
    const farmer = await enrol('61000000005', null);
    expect((await pgError(check(agent, 'farmer', farmer, 'nin', '61000000006'))).message).toMatch(
      /not the one on record/,
    );
    expect((await pgError(check(agent, 'farmer', farmer, 'bvn', '22100000005'))).message).toMatch(
      /No BVN is on record/,
    );
    expect((await pgError(check(ada, 'farmer', farmer, 'nin', '61000000005'))).code).toBe('PT403');
    expect((await pgError(check(agent, 'farmer', farmer, 'nin', '123'))).message).toMatch(
      /11 digits/,
    );
    // A refused check leaves nothing behind.
    const { rows } = await db.query(`select 1 from public.identity_checks where farmer_id = $1`, [
      farmer,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('lets only the identity service record a result', async () => {
    const farmer = await enrol('61000000007', null);
    const [{ r }] = await as<{ r: { check_id: string } }>(
      agent,
      `select public.start_identity_check('farmer', $1, 'nin', '61000000007', 'mock') as r`,
      [farmer],
    );
    const forged = await pgError(
      as(compliance, `select public.complete_identity_check($1, 'match')`, [r.check_id]),
    );
    expect(forged.code).toBe('42501');
    const direct = await pgError(
      as(compliance, `update public.identity_checks set status = 'match' where id = $1`, [
        r.check_id,
      ]),
    );
    expect(direct.code).toBe('42501');
    await asService(db, (tx) =>
      tx.query(`select public.complete_identity_check($1, 'match')`, [r.check_id]),
    );
    // Answered once; it can't be rewritten.
    const again = await pgError(
      asService(db, (tx) =>
        tx.query(`select public.complete_identity_check($1, 'no_match')`, [r.check_id]),
      ),
    );
    expect(again.code).toBe('PT404');
  });

  it('stops after five checks of a number in a day', async () => {
    const farmer = await enrol('61000059999', null);
    for (let i = 0; i < 5; i++) await check(agent, 'farmer', farmer, 'nin', '61000059999');
    expect((await pgError(check(agent, 'farmer', farmer, 'nin', '61000059999'))).code).toBe(
      'PT429',
    );
  });

  it('needs a match on every number on record to verify a farmer without a note', async () => {
    const farmer = await enrol('61000000010', '22100000010');
    expect((await pgError(kyc(farmer))).message).toMatch(/matching identity check/);

    await check(agent, 'farmer', farmer, 'nin', '61000000010');
    expect((await pgError(kyc(farmer))).message).toMatch(/matching identity check/);

    await check(compliance, 'farmer', farmer, 'bvn', '22100000010');
    await kyc(farmer);
    const { rows } = await db.query(
      `select kyc_status, kyc_note, kyc_reviewed_by from public.farmers where id = $1`,
      [farmer],
    );
    expect(rows[0]).toEqual({
      kyc_status: 'verified',
      kyc_note: null,
      kyc_reviewed_by: compliance,
    });
  });

  it('goes by the latest answer, and lets compliance override with a reason', async () => {
    const farmer = await enrol('61000002222', null);
    await check(agent, 'farmer', farmer, 'nin', '61000002222'); // partial
    expect((await pgError(kyc(farmer))).code).toBe('PT400');
    await kyc(farmer, 'New phone number; confirmed with the cooperative chair');
    const { rows } = await db.query(
      `select kyc_status, kyc_note from public.farmers where id = $1`,
      [farmer],
    );
    expect(rows[0]).toEqual({
      kyc_status: 'verified',
      kyc_note: 'New phone number; confirmed with the cooperative chair',
    });
  });

  describe('investors', () => {
    const submit = (user: string, nin: string, bvn: string) =>
      as(
        user,
        `select public.submit_investor_kyc('Ada Obi', 'retail', $1, $2, 100000000, 0,
           $3, 'GTBank', '0123456789', 'Ada Obi')`,
        [nin, bvn, `${user}/id.jpg`],
      );
    const review = (user: string, note: string | null = null) =>
      as(compliance, `select public.review_investor_kyc($1, true, null, $2)`, [user, note]);

    it('lets investors check only themselves, and see only their own checks', async () => {
      await submit(ada, '70000000001', '22200000001');
      await check(ada, 'investor', ada, 'nin', '70000000001');
      await submit(bayo, '70000000002', '22200000002');
      expect((await pgError(check(ada, 'investor', bayo, 'nin', '70000000002'))).code).toBe(
        'PT403',
      );
      expect(await as(ada, `select investor_id from public.identity_checks`)).toEqual([
        { investor_id: ada },
      ]);
      expect(
        await as(agent, `select 1 from public.identity_checks where subject = 'investor'`),
      ).toHaveLength(0);
      expect(
        await as(ada, `select 1 from public.identity_checks where subject = 'farmer'`),
      ).toHaveLength(0);
    });

    it('needs both numbers matched since the last submission', async () => {
      expect((await pgError(review(ada))).message).toMatch(/both have a matching/);
      await check(ada, 'investor', ada, 'bvn', '22200000001');
      // Changing the numbers makes the earlier checks stale.
      await submit(ada, '70000000003', '22200000003');
      expect((await pgError(review(ada))).message).toMatch(/both have a matching/);
      await check(ada, 'investor', ada, 'nin', '70000000003');
      await check(compliance, 'investor', ada, 'bvn', '22200000003');
      await review(ada);
      // Compliance may still verify without matches, with a note.
      await review(bayo, 'Provider down; BVN confirmed by the bank directly');
      const { rows } = await db.query(
        `select kyc_status from public.investor_profiles where user_id in ($1, $2)`,
        [ada, bayo],
      );
      expect(rows).toEqual([{ kyc_status: 'verified' }, { kyc_status: 'verified' }]);
    });
  });
});
