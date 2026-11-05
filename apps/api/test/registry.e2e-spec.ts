import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Role } from '../src/common/role.enum';
import { UsersService } from '../src/users/users.service';
import { createTestApp, resetDatabase } from './test-app';

/** A square of `size` degrees with its south-west corner at (lon, lat). ~0.0009° ≈ 100 m. */
const square = (lon: number, lat: number, size = 0.0009) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon, lat],
      [lon + size, lat],
      [lon + size, lat + size],
      [lon, lat + size],
      [lon, lat],
    ],
  ],
});

describe('Registry (e2e)', () => {
  let app: INestApplication<App>;
  let agent: string;
  let compliance: string;
  let investor: string;
  let cooperativeId: string;
  let farmerId: string;
  let farmId: string;

  const http = () => request(app.getHttpServer());
  const login = async (email: string, password: string) =>
    (await http().post('/api/v1/auth/login').send({ email, password }).expect(200)).body
      .accessToken as string;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  const farmerBody = (overrides: Record<string, unknown> = {}) => ({
    firstName: 'Amina',
    lastName: 'Ibrahim',
    phone: '+2348012345678',
    nin: '1234 5678 901',
    state: 'Kaduna',
    lga: 'Zaria',
    ...overrides,
  });

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    const users = app.get(UsersService);
    const make = (email: string, role: Role) =>
      users.create({ email, password: 'password-12345', fullName: email, role });
    await make('agent@agrowth.test', Role.FieldAgent);
    await make('compliance@agrowth.test', Role.ComplianceOfficer);
    await make('investor@agrowth.test', Role.Investor);
    agent = await login('agent@agrowth.test', 'password-12345');
    compliance = await login('compliance@agrowth.test', 'password-12345');
    investor = await login('investor@agrowth.test', 'password-12345');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('cooperatives', () => {
    it('lets a field agent create a cooperative', async () => {
      const res = await http()
        .post('/api/v1/cooperatives')
        .set(as(agent))
        .send({
          name: 'Zaria Maize Growers',
          registrationNumber: 'KD/42',
          state: 'Kaduna',
          lga: 'Zaria',
        })
        .expect(201);
      cooperativeId = res.body.id;
    });

    it('refuses a duplicate registration number', async () => {
      await http()
        .post('/api/v1/cooperatives')
        .set(as(agent))
        .send({ name: 'Copycat', registrationNumber: 'KD/42', state: 'Kaduna', lga: 'Zaria' })
        .expect(409);
    });

    it('keeps the registry away from investors', async () => {
      await http().get('/api/v1/cooperatives').set(as(investor)).expect(403);
    });
  });

  describe('farmers', () => {
    it('enrols a farmer and never returns identity numbers or hashes', async () => {
      const res = await http()
        .post('/api/v1/farmers')
        .set(as(agent))
        .send(farmerBody({ cooperativeId }))
        .expect(201);
      farmerId = res.body.id;
      expect(res.body).toMatchObject({ ninLast4: '8901', kycStatus: 'pending', cooperativeId });
      expect(res.body.ninHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('12345678901');
    });

    it('requires a NIN or BVN', async () => {
      await http()
        .post('/api/v1/farmers')
        .set(as(agent))
        .send(farmerBody({ nin: undefined }))
        .expect(400);
    });

    it('refuses to enrol the same NIN twice and points to the existing record', async () => {
      const res = await http()
        .post('/api/v1/farmers')
        .set(as(agent))
        .send(farmerBody({ firstName: 'Fake', nin: '12345678901', phone: '+2348000000000' }))
        .expect(409);
      expect(res.body.existingFarmerId).toBe(farmerId);
    });

    it('refuses an unknown cooperative', async () => {
      await http()
        .post('/api/v1/farmers')
        .set(as(agent))
        .send(
          farmerBody({ nin: '99999999999', cooperativeId: '00000000-0000-4000-8000-000000000000' }),
        )
        .expect(404);
    });

    it('searches by name and filters by cooperative', async () => {
      const res = await http()
        .get(`/api/v1/farmers?q=amina%20ibr&cooperativeId=${cooperativeId}`)
        .set(as(compliance))
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].id).toBe(farmerId);
    });

    it('reserves the KYC decision for compliance', async () => {
      await http()
        .patch(`/api/v1/farmers/${farmerId}/kyc`)
        .set(as(agent))
        .send({ kycStatus: 'verified' })
        .expect(403);
      const res = await http()
        .patch(`/api/v1/farmers/${farmerId}/kyc`)
        .set(as(compliance))
        .send({ kycStatus: 'verified' })
        .expect(200);
      expect(res.body.kycStatus).toBe('verified');
    });

    it('does not allow identity numbers to be edited', async () => {
      await http()
        .patch(`/api/v1/farmers/${farmerId}`)
        .set(as(agent))
        .send({ nin: '11111111111' })
        .expect(400);
    });

    it('counts a cooperative’s members', async () => {
      const res = await http()
        .get(`/api/v1/cooperatives/${cooperativeId}`)
        .set(as(compliance))
        .expect(200);
      expect(res.body.farmerCount).toBe(1);
    });
  });

  describe('farms', () => {
    it('maps a farm and computes its area in the database', async () => {
      const res = await http()
        .post(`/api/v1/farmers/${farmerId}/farms`)
        .set(as(agent))
        .send({ boundary: square(7.7, 11.1), primaryCrop: 'Maize', areaHectares: 500 })
        .expect(400); // areaHectares is not accepted from clients
      expect(JSON.stringify(res.body.message)).toContain('areaHectares');

      const ok = await http()
        .post(`/api/v1/farmers/${farmerId}/farms`)
        .set(as(agent))
        .send({ boundary: square(7.7, 11.1), primaryCrop: 'Maize' })
        .expect(201);
      farmId = ok.body.id;
      expect(ok.body.primaryCrop).toBe('maize');
      expect(ok.body.areaHectares).toBeGreaterThan(0.9);
      expect(ok.body.areaHectares).toBeLessThan(1.1);
      expect(ok.body.boundary.type).toBe('Polygon');
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
      const res = await http()
        .post(`/api/v1/farmers/${farmerId}/farms`)
        .set(as(agent))
        .send({ boundary: bowtie })
        .expect(400);
      expect(res.body.message).toMatch(/not a valid polygon/i);
    });

    it('rejects land that is already registered', async () => {
      const res = await http()
        .post(`/api/v1/farmers/${farmerId}/farms`)
        .set(as(agent))
        .send({ boundary: square(7.7003, 11.1003) })
        .expect(409);
      expect(res.body.overlappingFarms[0].farmId).toBe(farmId);
    });

    it('allows a neighbouring farm that only shares an edge', async () => {
      await http()
        .post(`/api/v1/farmers/${farmerId}/farms`)
        .set(as(agent))
        .send({ boundary: square(7.7009, 11.1) })
        .expect(201);
    });

    it('checks whether a GPS fix is inside the farm', async () => {
      const inside = await http()
        .get(`/api/v1/farms/${farmId}/contains?lon=7.70045&lat=11.10045`)
        .set(as(agent))
        .expect(200);
      expect(inside.body).toMatchObject({ inside: true, distanceMetres: 0 });

      const outside = await http()
        .get(`/api/v1/farms/${farmId}/contains?lon=7.6990&lat=11.10045`)
        .set(as(agent))
        .expect(200);
      expect(outside.body.inside).toBe(false);
      expect(outside.body.distanceMetres).toBeGreaterThan(80);
    });

    it('locks the boundary while the farm is in an active cycle', async () => {
      const ds = app.get(DataSource);
      const [{ id: managerId }] = await ds.query(`SELECT id FROM users LIMIT 1`);
      const [{ id: cycleId }] = await ds.query(
        `INSERT INTO cycles (code, crop, season, status, funding_source, target_amount_kobo,
           budget_per_hectare_kobo, yield_low_t_per_ha, yield_expected_t_per_ha, yield_high_t_per_ha, manager_id)
         VALUES ('KD-LOCK', 'maize', '2027 wet', 'open_for_funding', 'investor', 1, 1, 1, 2, 3, $1)
         RETURNING id`,
        [managerId],
      );
      await ds.query(`INSERT INTO cycle_farms (cycle_id, farm_id) VALUES ($1, $2)`, [
        cycleId,
        farmId,
      ]);

      await http()
        .patch(`/api/v1/farms/${farmId}`)
        .set(as(agent))
        .send({ boundary: square(7.7, 11.1, 0.001) })
        .expect(409);
      // Other details can still be corrected.
      await http()
        .patch(`/api/v1/farms/${farmId}`)
        .set(as(agent))
        .send({ soilNotes: 'Sandy loam' })
        .expect(200);
    });

    it('lists farms by cooperative', async () => {
      const res = await http()
        .get(`/api/v1/farms?cooperativeId=${cooperativeId}`)
        .set(as(compliance))
        .expect(200);
      expect(res.body.total).toBe(2);
    });
  });
});
