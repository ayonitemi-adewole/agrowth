import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, pgError, square } from './db';

describe('registry', () => {
  let db: PGlite;
  let admin: string;
  let agent: string;
  let compliance: string;
  let investor: string;
  let cooperativeId: string;
  let farmerId: string;
  let farmId: string;

  const register = (userId: string, overrides: Record<string, unknown> = {}) => {
    const args = {
      p_first_name: 'Amina',
      p_last_name: 'Ibrahim',
      p_phone: '+2348012345678',
      p_state: 'Kaduna',
      p_lga: 'Zaria',
      p_nin: '1234 5678 901',
      p_bvn: null,
      p_cooperative_id: null,
      ...overrides,
    };
    return asUser(db, userId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `select public.register_farmer(
           p_first_name => $1, p_last_name => $2, p_phone => $3, p_state => $4, p_lga => $5,
           p_nin => $6, p_bvn => $7, p_cooperative_id => $8, p_portrait_path => auth.uid()::text || '/portrait.jpg') as id`,
        [
          args.p_first_name,
          args.p_last_name,
          args.p_phone,
          args.p_state,
          args.p_lga,
          args.p_nin,
          args.p_bvn,
          args.p_cooperative_id,
        ],
      );
      return rows[0].id;
    });
  };

  const mapFarm = (userId: string, farmer: string, boundary: unknown, crop?: string) =>
    asUser(db, userId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `select public.map_farm(p_farmer_id => $1, p_boundary => $2, p_primary_crop => $3, p_photo_paths => array[auth.uid()::text || '/farm.jpg']) as id`,
        [farmer, JSON.stringify(boundary), crop ?? null],
      );
      return rows[0].id;
    });

  beforeAll(async () => {
    db = await createDb();
    admin = await createUser(db, 'admin@agrowth.test', 'admin');
    agent = await createUser(db, 'agent@agrowth.test', 'field_agent');
    compliance = await createUser(db, 'compliance@agrowth.test', 'compliance_officer');
    investor = await createUser(db, 'investor@agrowth.test', 'investor');
  });

  describe('cooperatives', () => {
    it('lets a field agent create one', async () => {
      cooperativeId = await asUser(db, agent, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `insert into public.cooperatives (name, registration_number, state, lga)
           values ('Zaria Maize Growers', 'KD/42', 'Kaduna', 'Zaria') returning id`,
        );
        return rows[0].id;
      });
      expect(cooperativeId).toBeTruthy();
    });

    it('refuses a duplicate registration number', async () => {
      const err = await pgError(
        asUser(db, agent, (tx) =>
          tx.query(
            `insert into public.cooperatives (name, registration_number, state, lga)
             values ('Copycat', 'KD/42', 'Kaduna', 'Zaria')`,
          ),
        ),
      );
      expect(err.code).toBe('23505');
    });

    it('hides the registry from investors and blocks their writes', async () => {
      const rows = await asUser(db, investor, async (tx) => {
        return (await tx.query(`select * from public.cooperatives`)).rows;
      });
      expect(rows).toHaveLength(0);
      const err = await pgError(
        asUser(db, investor, (tx) =>
          tx.query(
            `insert into public.cooperatives (name, state, lga) values ('Mine', 'Lagos', 'Ikeja')`,
          ),
        ),
      );
      expect(err.code).toBe('42501');
    });
  });

  describe('farmers', () => {
    it('enrols a farmer, keeping only the last four NIN digits', async () => {
      farmerId = await register(agent, { p_cooperative_id: cooperativeId });
      const { rows } = await db.query<Record<string, unknown>>(
        `select * from public.farmers where id = $1`,
        [farmerId],
      );
      expect(rows[0]).toMatchObject({
        nin_last4: '8901',
        kyc_status: 'pending',
        full_name: 'Amina Ibrahim',
        registered_by: agent,
      });
      expect(JSON.stringify(rows[0])).not.toContain('12345678901');
    });

    it('requires a NIN or BVN', async () => {
      const err = await pgError(register(agent, { p_nin: null }));
      expect(err.code).toBe('PT400');
      expect(err.message).toMatch(/NIN or BVN/);
    });

    it('validates identity number format', async () => {
      const err = await pgError(register(agent, { p_nin: '1234' }));
      expect(err.message).toMatch(/11 digits/);
    });

    it('refuses the same NIN twice and points to the existing record', async () => {
      const err = await pgError(
        register(agent, { p_first_name: 'Fake', p_nin: '12345678901', p_phone: '+2348000000000' }),
      );
      expect(err.code).toBe('PT409');
      expect(err.detail).toBe(farmerId);
    });

    it('refuses an unknown cooperative', async () => {
      const err = await pgError(
        register(agent, {
          p_nin: '99999999999',
          p_cooperative_id: '00000000-0000-4000-8000-000000000000',
        }),
      );
      expect(err.code).toBe('PT404');
    });

    it('does not let compliance or investors enrol farmers', async () => {
      expect((await pgError(register(compliance, { p_nin: '22222222222' }))).code).toBe('PT403');
      expect((await pgError(register(investor, { p_nin: '22222222222' }))).code).toBe('PT403');
    });

    it('keeps identity hashes out of reach of API users', async () => {
      const err = await pgError(
        asUser(db, admin, (tx) => tx.query(`select * from private.farmer_identities`)),
      );
      expect(err.code).toBe('42501');
    });

    it('stores a keyed hash, not the identity number', async () => {
      const { rows } = await db.query<{ nin_hash: string }>(
        `select nin_hash from private.farmer_identities where farmer_id = $1`,
        [farmerId],
      );
      expect(rows[0].nin_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].nin_hash).not.toContain('12345678901');
    });

    it('lets agents correct contact details but not names or identity numbers', async () => {
      await asUser(db, agent, (tx) =>
        tx.query(`update public.farmers set ward = 'Samaru' where id = $1`, [farmerId]),
      );
      const err = await pgError(
        asUser(db, agent, (tx) =>
          tx.query(`update public.farmers set nin_last4 = '0000' where id = $1`, [farmerId]),
        ),
      );
      expect(err.code).toBe('42501');
      const renamed = await pgError(
        asUser(db, agent, (tx) =>
          tx.query(`update public.farmers set first_name = 'X' where id = $1`, [farmerId]),
        ),
      );
      expect(renamed.code).toBe('42501');
    });

    it('reserves the KYC decision for compliance', async () => {
      const err = await pgError(
        asUser(db, agent, (tx) =>
          tx.query(`select public.set_farmer_kyc($1, 'verified')`, [farmerId]),
        ),
      );
      expect(err.code).toBe('PT403');
      await asUser(db, compliance, (tx) =>
        tx.query(`select public.set_farmer_kyc($1, 'verified', 'NIN slip seen')`, [farmerId]),
      );
      const { rows } = await db.query<{ kyc_status: string }>(
        `select kyc_status from public.farmers where id = $1`,
        [farmerId],
      );
      expect(rows[0].kyc_status).toBe('verified');
    });

    it('lets compliance read the registry, with member counts', async () => {
      const rows = await asUser(db, compliance, async (tx) => {
        return (
          await tx.query<{ count: number }>(
            `select count(*)::int as count from public.farmers where cooperative_id = $1`,
            [cooperativeId],
          )
        ).rows;
      });
      expect(rows[0].count).toBe(1);
    });
  });

  describe('farms', () => {
    it('maps a farm and computes its area in the database', async () => {
      farmId = await mapFarm(agent, farmerId, square(7.7, 11.1), ' Maize ');
      const { rows } = await asUser(db, agent, (tx) =>
        tx.query<{ area_hectares: string; primary_crop: string; boundary: { type: string } }>(
          `select area_hectares, primary_crop, boundary from public.farm_maps where id = $1`,
          [farmId],
        ),
      );
      expect(Number(rows[0].area_hectares)).toBeGreaterThan(0.9);
      expect(Number(rows[0].area_hectares)).toBeLessThan(1.1);
      expect(rows[0].primary_crop).toBe('maize');
      expect(rows[0].boundary.type).toBe('Polygon');
    });

    it('rejects a self-intersecting boundary with a clear reason', async () => {
      const bowtie = {
        type: 'Polygon',
        coordinates: [
          [
            [7.8, 11.1],
            [7.801, 11.101],
            [7.801, 11.1],
            [7.8, 11.101],
            [7.8, 11.1],
          ],
        ],
      };
      const err = await pgError(mapFarm(agent, farmerId, bowtie));
      expect(err.code).toBe('PT400');
      expect(err.message).toMatch(/not a valid polygon/i);
    });

    it.each([
      [{ type: 'Point', coordinates: [7.7, 11.1] }, /GeoJSON Polygon/],
      [{ type: 'Polygon', coordinates: 'nope' }, /not valid GeoJSON/],
      [square(200, 11.1), /longitude, latitude/],
    ])('rejects malformed boundary %j', async (boundary, message) => {
      const err = await pgError(mapFarm(agent, farmerId, boundary));
      expect(err.code).toBe('PT400');
      expect(err.message).toMatch(message);
    });

    it('rejects land that is already registered and names the clashing farm', async () => {
      const err = await pgError(mapFarm(agent, farmerId, square(7.7003, 11.1003)));
      expect(err.code).toBe('PT409');
      const clashes = JSON.parse(err.detail!) as { farm_id: string }[];
      expect(clashes[0].farm_id).toBe(farmId);
    });

    it('allows a neighbouring farm that only shares an edge', async () => {
      await expect(mapFarm(agent, farmerId, square(7.7009, 11.1))).resolves.toBeTruthy();
    });

    it('does not let clients set the area or the boundary directly', async () => {
      const err = await pgError(
        asUser(db, agent, (tx) =>
          tx.query(`update public.farms set area_hectares = 500 where id = $1`, [farmId]),
        ),
      );
      expect(err.code).toBe('42501');
      const direct = await pgError(
        asUser(db, agent, (tx) =>
          tx.query(
            `insert into public.farms (farmer_id, boundary, area_hectares, centroid)
             values ($1, st_geomfromtext('POLYGON((8 11,8.001 11,8.001 11.001,8 11))', 4326), 1,
                     st_point(8, 11, 4326))`,
            [farmerId],
          ),
        ),
      );
      expect(direct.code).toBe('42501');
    });

    it('checks whether a GPS fix is inside the farm', async () => {
      const check = (lon: number, lat: number) =>
        asUser(db, agent, async (tx) => {
          return (
            await tx.query<{ inside: boolean; distance_metres: number }>(
              `select * from public.farm_contains_point($1, $2, $3)`,
              [farmId, lon, lat],
            )
          ).rows[0];
        });
      expect(await check(7.70045, 11.10045)).toEqual({ inside: true, distance_metres: 0 });
      const outside = await check(7.699, 11.10045);
      expect(outside.inside).toBe(false);
      expect(outside.distance_metres).toBeGreaterThan(80);
    });

    it('re-maps a farm, and locks the boundary while it is in a live cycle', async () => {
      const remap = (boundary: unknown) =>
        asUser(db, agent, (tx) =>
          tx.query(`select public.update_farm_boundary($1, $2)`, [
            farmId,
            JSON.stringify(boundary),
          ]),
        );
      await remap(square(7.7, 11.1, 0.0008));
      const { rows } = await db.query<{ area_hectares: string }>(
        `select area_hectares from public.farms where id = $1`,
        [farmId],
      );
      expect(Number(rows[0].area_hectares)).toBeLessThan(0.9);

      const {
        rows: [cycle],
      } = await db.query<{ id: string }>(
        `insert into public.cycles (code, crop, season, status, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha, manager_id)
         values ('KD-LOCK', 'maize', '2027 wet', 'open_for_funding', 'investor', 1, 1, 1, 2, 3, $1)
         returning id`,
        [admin],
      );
      await db.query(`insert into public.cycle_farms (cycle_id, farm_id) values ($1, $2)`, [
        cycle.id,
        farmId,
      ]);

      const err = await pgError(remap(square(7.7, 11.1)));
      expect(err.code).toBe('PT409');
      expect(err.message).toMatch(/KD-LOCK/);
      // Other details can still be corrected.
      await asUser(db, agent, (tx) =>
        tx.query(`update public.farms set soil_notes = 'Sandy loam' where id = $1`, [farmId]),
      );
    });

    it('lists farms by cooperative for map views', async () => {
      const rows = await asUser(db, compliance, async (tx) => {
        return (
          await tx.query(`select id from public.farm_maps where cooperative_id = $1`, [
            cooperativeId,
          ])
        ).rows;
      });
      expect(rows).toHaveLength(2);
    });

    it('hides farms from investors', async () => {
      const rows = await asUser(db, investor, async (tx) => {
        return (await tx.query(`select id from public.farm_maps`)).rows;
      });
      expect(rows).toHaveLength(0);
    });
  });
});
