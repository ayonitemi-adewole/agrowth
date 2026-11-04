import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Role } from '../src/common/role.enum';
import { UsersService } from '../src/users/users.service';
import { createTestApp, resetDatabase } from './test-app';

describe('Auth and roles (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;

  const login = async (email: string, password: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    await app.get(UsersService).create({
      email: 'admin@agrowth.test',
      password: 'admin-password-123',
      fullName: 'Admin',
      role: Role.Admin,
    });
    adminToken = await login('admin@agrowth.test', 'admin-password-123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an investor sign up, log in and see their profile', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: ' Ada@Example.com ',
        fullName: 'Ada Okafor',
        password: 'correct horse battery',
      })
      .expect(201);
    expect(reg.body).toMatchObject({ email: 'ada@example.com', role: 'investor' });
    expect(reg.body.passwordHash).toBeUndefined();

    const token = await login('ada@example.com', 'correct horse battery');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.email).toBe('ada@example.com');
    expect(me.body.lastLoginAt).not.toBeNull();
  });

  it('refuses a duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'ada@example.com', fullName: 'Someone Else', password: 'another password' })
      .expect(409);
  });

  it('refuses a self-assigned role at sign-up', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'sneaky@example.com',
        fullName: 'Sneaky',
        password: 'correct horse battery',
        role: 'admin',
      })
      .expect(400);
  });

  it('refuses a wrong password and an unknown email with the same message', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'not the password' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'not the password' })
      .expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('requires a token on protected routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('lets an admin create a field agent, but not an investor', async () => {
    const investorToken = await login('ada@example.com', 'correct horse battery');
    const body = {
      email: 'agent@agrowth.test',
      fullName: 'Field Agent',
      password: 'agent-password-123',
      role: 'field_agent',
    };
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('authorization', `Bearer ${investorToken}`)
      .send(body)
      .expect(403);
    const created = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    expect(created.body.role).toBe('field_agent');
  });

  it('cuts off a deactivated user immediately, even with a valid token', async () => {
    const agentToken = await login('agent@agrowth.test', 'agent-password-123');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${agentToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${me.body.id}/active`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${agentToken}`)
      .expect(401);
  });

  it('keeps ledger reads to admins, auditors and compliance', async () => {
    const investorToken = await login('ada@example.com', 'correct horse battery');
    await request(app.getHttpServer())
      .get('/api/v1/ledger/entries')
      .set('authorization', `Bearer ${investorToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/ledger/entries')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('reports database health without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.info.database.status).toBe('up');
  });
});
