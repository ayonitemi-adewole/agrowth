import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError } from './db';

describe('accounts and roles', () => {
  let db: PGlite;
  let admin: string;

  const myRole = (userId: string) =>
    asUser(db, userId, async (tx) => {
      return (await tx.query<{ role: string | null }>(`select public.app_role() as role`)).rows[0]
        .role;
    });

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@agrowth.test', 'admin');
  });

  it('gives every sign-up an investor profile, ignoring any role they ask for', async () => {
    const id = await createUser(db, 'sneaky@example.com', 'investor', {
      full_name: 'Sneaky Person',
      role: 'admin',
      phone: '+2348012345678',
    });
    const { rows } = await db.query<Record<string, unknown>>(
      `select * from public.profiles where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      role: 'investor',
      full_name: 'Sneaky Person',
      phone: '+2348012345678',
      is_active: true,
    });
  });

  it('drops an invalid phone from sign-up metadata instead of failing sign-up', async () => {
    const id = await createUser(db, 'bad-phone@example.com', 'investor', { phone: 'call me' });
    const { rows } = await db.query<{ phone: string | null }>(
      `select phone from public.profiles where id = $1`,
      [id],
    );
    expect(rows[0].phone).toBeNull();
  });

  it('does not let users promote themselves', async () => {
    const me = await createUser(db, 'climber@example.com', 'investor');
    const direct = await pgError(
      asUser(db, me, (tx) =>
        tx.query(`update public.profiles set role = 'admin' where id = $1`, [me]),
      ),
    );
    expect(direct.code).toBe('42501');
    const viaFunction = await pgError(
      asUser(db, me, (tx) => tx.query(`select public.admin_set_user_role($1, 'admin')`, [me])),
    );
    expect(viaFunction.code).toBe('PT403');
    expect(await myRole(me)).toBe('investor');
  });

  it('lets users edit their own name, and only their own profile', async () => {
    const me = await createUser(db, 'self@example.com', 'investor');
    await asUser(db, me, (tx) =>
      tx.query(`update public.profiles set full_name = 'New Name' where id = $1`, [me]),
    );
    const { rowCount } = await asUser(db, me, (tx) =>
      tx.query(`update public.profiles set full_name = 'Hacked' where id = $1`, [admin]),
    );
    expect(rowCount ?? 0).toBe(0);
    const others = await asUser(db, me, async (tx) => {
      return (await tx.query(`select id from public.profiles`)).rows;
    });
    expect(others).toEqual([{ id: me }]);
  });

  it('lets an admin grant a staff role and see every profile', async () => {
    const id = await createUser(db, 'new-agent@agrowth.test', 'investor');
    await asUser(db, admin, (tx) =>
      tx.query(`select public.admin_set_user_role($1, 'field_agent')`, [id]),
    );
    expect(await myRole(id)).toBe('field_agent');
    const all = await asUser(db, admin, async (tx) => {
      return (await tx.query(`select id from public.profiles`)).rows;
    });
    expect(all.length).toBeGreaterThan(3);
  });

  it('stops admins locking themselves out', async () => {
    const demote = await pgError(
      asUser(db, admin, (tx) =>
        tx.query(`select public.admin_set_user_role($1, 'investor')`, [admin]),
      ),
    );
    expect(demote.message).toMatch(/own role/);
    const deactivate = await pgError(
      asUser(db, admin, (tx) =>
        tx.query(`select public.admin_set_user_active($1, false)`, [admin]),
      ),
    );
    expect(deactivate.message).toMatch(/own account/);
  });

  it('cuts off a deactivated user immediately, even with a valid session', async () => {
    const agent = await createUser(db, 'leaver@agrowth.test', 'field_agent');
    await db.query(
      `insert into public.cooperatives (name, state, lga) values ('Visible Coop', 'Kaduna', 'Zaria')`,
    );
    const before = await asUser(db, agent, async (tx) => {
      return (await tx.query(`select id from public.cooperatives`)).rows;
    });
    expect(before.length).toBeGreaterThan(0);

    await asUser(db, admin, (tx) =>
      tx.query(`select public.admin_set_user_active($1, false)`, [agent]),
    );
    expect(await myRole(agent)).toBeNull();
    const after = await asUser(db, agent, async (tx) => {
      return (await tx.query(`select id from public.cooperatives`)).rows;
    });
    expect(after).toHaveLength(0);
  });

  it('gives signed-out visitors nothing', async () => {
    // Permission denied outright, not merely an empty list.
    const read = await pgError(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(`select * from public.profiles`);
      }),
    );
    expect(read.code).toBe('42501');
    const fn = await pgError(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query(
          `select public.register_farmer('a','b','+2348012345678','Kaduna','Zaria','12345678901')`,
        );
      }),
    );
    expect(fn.code).toBe('42501');
  });
});
