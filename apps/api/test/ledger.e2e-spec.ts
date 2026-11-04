import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from '../src/common/role.enum';
import { Cycle, FundingSource } from '../src/cycles/entities/cycle.entity';
import { AccountType, LedgerAccount } from '../src/ledger/entities/ledger-account.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { Farm } from '../src/registry/entities/farm.entity';
import { Farmer } from '../src/registry/entities/farmer.entity';
import { UsersService } from '../src/users/users.service';
import { createTestApp, resetDatabase } from './test-app';

/**
 * These tests go around the application on purpose: they write SQL straight to the
 * database to prove the ledger rules hold even if application code were bypassed.
 */
describe('Ledger and data integrity (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ledger: LedgerService;
  let userId: string;
  let cycleA: Cycle;
  let cycleB: Cycle;
  let trusteeA: LedgerAccount;
  let investorsA: LedgerAccount;
  let trusteeB: LedgerAccount;
  let platformFees: LedgerAccount;

  const makeCycle = (code: string) =>
    ds.getRepository(Cycle).save({
      code,
      crop: 'maize',
      season: '2027 wet',
      fundingSource: FundingSource.Investor,
      targetAmountKobo: 100_000_000n,
      budgetPerHectareKobo: 50_000_000n,
      yieldLowTPerHa: 2,
      yieldExpectedTPerHa: 3,
      yieldHighTPerHa: 4,
      managerId: userId,
    });

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    ledger = app.get(LedgerService);
    const user = await app.get(UsersService).create({
      email: 'manager@agrowth.test',
      password: 'manager-password-1',
      fullName: 'Cycle Manager',
      role: Role.CycleManager,
    });
    userId = user.id;
    cycleA = await makeCycle('KD-MAIZE-A');
    cycleB = await makeCycle('KD-MAIZE-B');
    trusteeA = await ledger.createAccount({
      code: 'TRUSTEE_CASH',
      name: 'Trustee cash',
      type: AccountType.Asset,
      cycleId: cycleA.id,
    });
    investorsA = await ledger.createAccount({
      code: 'INVESTOR_CAPITAL',
      name: 'Investor capital',
      type: AccountType.Liability,
      cycleId: cycleA.id,
    });
    trusteeB = await ledger.createAccount({
      code: 'TRUSTEE_CASH',
      name: 'Trustee cash',
      type: AccountType.Asset,
      cycleId: cycleB.id,
    });
    platformFees = await ledger.createAccount({
      code: 'PLATFORM_FEES',
      name: 'Platform fee income',
      type: AccountType.Income,
      cycleId: null,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('posts a balanced entry and reports balances in exact kobo', async () => {
    const entry = await ledger.post({
      cycleId: cycleA.id,
      description: 'Investor funding received by trustee',
      reference: 'TRUSTEE-TXN-001',
      postedById: userId,
      lines: [
        { accountId: trusteeA.id, amountKobo: 25_000_000_00n },
        { accountId: investorsA.id, amountKobo: -25_000_000_00n },
      ],
    });
    expect(entry.lines).toHaveLength(2);
    expect(Number(entry.entryNumber)).toBeGreaterThan(0);
    expect(await ledger.balance(trusteeA.id)).toBe(25_000_000_00n);
    expect(await ledger.balance(investorsA.id)).toBe(-25_000_000_00n);
  });

  it('allows a cycle to pay a platform-level account (fees)', async () => {
    await expect(
      ledger.post({
        cycleId: cycleA.id,
        description: 'Listing fee',
        postedById: userId,
        lines: [
          { accountId: investorsA.id, amountKobo: 10_000_00n },
          { accountId: platformFees.id, amountKobo: -10_000_00n },
        ],
      }),
    ).resolves.toBeDefined();
  });

  it('blocks moving money from one cycle to another (no recycling)', async () => {
    await expect(
      ledger.post({
        cycleId: cycleA.id,
        description: 'Attempt to pay cycle B investors with cycle A cash',
        postedById: userId,
        lines: [
          { accountId: trusteeB.id, amountKobo: 1_000_00n },
          { accountId: trusteeA.id, amountKobo: -1_000_00n },
        ],
      }),
    ).rejects.toThrow(/money cannot move between cycles/);
  });

  it('rejects an unbalanced entry written directly in SQL, at commit', async () => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const [{ id }] = await qr.query(
        `INSERT INTO journal_entries (cycle_id, description, posted_by_id) VALUES ($1, 'raw', $2) RETURNING id`,
        [cycleA.id, userId],
      );
      await qr.query(
        `INSERT INTO journal_lines (journal_entry_id, account_id, amount_kobo) VALUES ($1, $2, 100), ($1, $3, -99)`,
        [id, trusteeA.id, investorsA.id],
      );
      await expect(qr.commitTransaction()).rejects.toThrow(/does not balance/);
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
  });

  it('rejects an entry with no lines, at commit', async () => {
    await expect(
      ds.transaction(async (em) => {
        await em.query(
          `INSERT INTO journal_entries (cycle_id, description, posted_by_id) VALUES ($1, 'empty', $2)`,
          [cycleA.id, userId],
        );
      }),
    ).rejects.toThrow(/at least two lines/);
  });

  it('refuses to edit, delete or truncate posted entries', async () => {
    // Row triggers only fire on existing rows, so make sure there is something to tamper with.
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM journal_lines`);
    expect(count).toBeGreaterThan(0);
    await expect(
      ds.query(`UPDATE journal_lines SET amount_kobo = amount_kobo * 2`),
    ).rejects.toThrow(/append-only/);
    await expect(ds.query(`DELETE FROM journal_entries`)).rejects.toThrow(/append-only/);
    await expect(ds.query(`TRUNCATE journal_lines CASCADE`)).rejects.toThrow(/append-only/);
  });

  it('refuses to move an account to another cycle', async () => {
    await expect(
      ds.query(`UPDATE ledger_accounts SET cycle_id = $1 WHERE id = $2`, [cycleB.id, trusteeA.id]),
    ).rejects.toThrow(/cannot be moved/);
  });

  it('corrects mistakes with a reversal, exactly once', async () => {
    const mistake = await ledger.post({
      cycleId: cycleA.id,
      description: 'Duplicate funding posting',
      postedById: userId,
      lines: [
        { accountId: trusteeA.id, amountKobo: 5_000_00n },
        { accountId: investorsA.id, amountKobo: -5_000_00n },
      ],
    });
    const before = await ledger.balance(trusteeA.id);
    const reversal = await ledger.reverse(mistake.id, userId, 'posted twice');
    expect(reversal.reversalOfId).toBe(mistake.id);
    expect(await ledger.balance(trusteeA.id)).toBe(before - 5_000_00n);
    await expect(ledger.reverse(mistake.id, userId, 'again')).rejects.toThrow(
      /already been reversed/,
    );
  });

  it('computes farm area and centroid from the boundary', async () => {
    const farmer = await ds.getRepository(Farmer).save({
      firstName: 'Musa',
      lastName: 'Ibrahim',
      phone: '+2348030000000',
      state: 'Kaduna',
      lga: 'Zaria',
      registeredById: userId,
    });
    // Roughly 100 m × 100 m near Zaria (1 hectare), lon/lat order.
    const side = 0.0009;
    const [lon, lat] = [7.7, 11.1];
    const ring = [
      [lon, lat],
      [lon + side, lat],
      [lon + side, lat + side],
      [lon, lat + side],
      [lon, lat],
    ];
    const saved = await ds.getRepository(Farm).save({
      farmerId: farmer.id,
      boundary: { type: 'Polygon', coordinates: [ring] },
      areaHectares: 999, // ignored: the database computes it
    } as Partial<Farm>);
    const farm = await ds.getRepository(Farm).findOneByOrFail({ id: saved.id });
    expect(farm.areaHectares).toBeGreaterThan(0.9);
    expect(farm.areaHectares).toBeLessThan(1.1);
    expect(farm.centroid.type).toBe('Point');
  });

  it('rejects a self-intersecting farm boundary', async () => {
    const farmer = await ds.getRepository(Farmer).findOneByOrFail({ lastName: 'Ibrahim' });
    const bowtie = [
      [7.7, 11.1],
      [7.701, 11.101],
      [7.701, 11.1],
      [7.7, 11.101],
      [7.7, 11.1],
    ];
    await expect(
      ds
        .getRepository(Farm)
        .save({ farmerId: farmer.id, boundary: { type: 'Polygon', coordinates: [bowtie] } }),
    ).rejects.toThrow(/not a valid polygon/);
  });

  it('rejects yield assumptions that are out of order', async () => {
    await expect(
      ds.getRepository(Cycle).save({
        code: 'BAD-YIELD',
        crop: 'rice',
        season: '2027 dry',
        fundingSource: FundingSource.Programme,
        targetAmountKobo: 1n,
        budgetPerHectareKobo: 1n,
        yieldLowTPerHa: 5,
        yieldExpectedTPerHa: 3,
        yieldHighTPerHa: 4,
        managerId: userId,
      }),
    ).rejects.toThrow(/check constraint/);
  });
});
