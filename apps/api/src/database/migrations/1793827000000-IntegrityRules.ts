import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rules enforced inside PostgreSQL, so they hold even if application code has a bug
 * or someone connects to the database directly:
 *
 * 1. Farm area and centroid are computed from the boundary; invalid polygons are rejected.
 * 2. The ledger is append-only: no UPDATE, DELETE or TRUNCATE on journal tables.
 * 3. Every journal entry balances to zero and has at least two lines (checked at commit).
 * 4. No recycling: a journal entry may only touch its own cycle's accounts (plus
 *    platform-level accounts), so one cycle's money can never pay another's investors.
 * 5. A ledger account can't be moved to a different cycle after it is created.
 */
export class IntegrityRules1793827000000 implements MigrationInterface {
  name = 'IntegrityRules1793827000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Farm geometry
    await queryRunner.query(`
      CREATE FUNCTION farm_compute_geometry() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT ST_IsValid(NEW.boundary) THEN
          RAISE EXCEPTION 'Farm boundary is not a valid polygon: %', ST_IsValidReason(NEW.boundary)
            USING ERRCODE = 'check_violation';
        END IF;
        NEW.area_hectares := round((ST_Area(NEW.boundary::geography) / 10000)::numeric, 4);
        NEW.centroid := ST_Centroid(NEW.boundary);
        RETURN NEW;
      END $$`);
    await queryRunner.query(`
      CREATE TRIGGER farms_compute_geometry
      BEFORE INSERT OR UPDATE OF boundary ON farms
      FOR EACH ROW EXECUTE FUNCTION farm_compute_geometry()`);

    // 2. Append-only ledger
    await queryRunner.query(`
      CREATE FUNCTION ledger_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'The ledger is append-only: % on % is not allowed. Post a reversing entry instead.',
          TG_OP, TG_TABLE_NAME
          USING ERRCODE = 'insufficient_privilege';
      END $$`);
    for (const table of ['journal_entries', 'journal_lines']) {
      await queryRunner.query(`
        CREATE TRIGGER ${table}_append_only
        BEFORE UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ledger_forbid_change()`);
      await queryRunner.query(`
        CREATE TRIGGER ${table}_no_truncate
        BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION ledger_forbid_change()`);
    }

    // 3. Balanced entries, checked when the transaction commits
    await queryRunner.query(`
      CREATE FUNCTION ledger_assert_balanced(entry_id uuid) RETURNS void LANGUAGE plpgsql AS $$
      DECLARE
        total bigint;
        line_count integer;
      BEGIN
        SELECT coalesce(sum(amount_kobo), 0), count(*) INTO total, line_count
        FROM journal_lines WHERE journal_entry_id = entry_id;
        IF line_count < 2 THEN
          RAISE EXCEPTION 'Journal entry % must have at least two lines (has %)', entry_id, line_count
            USING ERRCODE = 'check_violation';
        END IF;
        IF total <> 0 THEN
          RAISE EXCEPTION 'Journal entry % does not balance: lines sum to % kobo', entry_id, total
            USING ERRCODE = 'check_violation';
        END IF;
      END $$`);
    await queryRunner.query(`
      CREATE FUNCTION ledger_check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM ledger_assert_balanced(NEW.id);
        RETURN NULL;
      END $$`);
    await queryRunner.query(`
      CREATE FUNCTION ledger_check_line_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM ledger_assert_balanced(NEW.journal_entry_id);
        RETURN NULL;
      END $$`);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER journal_lines_balanced
      AFTER INSERT ON journal_lines
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ledger_check_line_balanced()`);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER journal_entries_balanced
      AFTER INSERT ON journal_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ledger_check_entry_balanced()`);

    // 4. No movement of money between cycles
    await queryRunner.query(`
      CREATE FUNCTION ledger_check_line_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE
        entry_cycle uuid;
        account_cycle uuid;
      BEGIN
        SELECT cycle_id INTO entry_cycle FROM journal_entries WHERE id = NEW.journal_entry_id;
        SELECT cycle_id INTO account_cycle FROM ledger_accounts WHERE id = NEW.account_id;
        IF account_cycle IS NOT NULL AND account_cycle IS DISTINCT FROM entry_cycle THEN
          RAISE EXCEPTION 'Account % belongs to a different cycle than journal entry %; money cannot move between cycles',
            NEW.account_id, NEW.journal_entry_id
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`
      CREATE TRIGGER journal_lines_same_cycle
      BEFORE INSERT ON journal_lines
      FOR EACH ROW EXECUTE FUNCTION ledger_check_line_cycle()`);

    // 5. Accounts stay in their cycle
    await queryRunner.query(`
      CREATE FUNCTION ledger_account_cycle_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cycle_id IS DISTINCT FROM OLD.cycle_id THEN
          RAISE EXCEPTION 'A ledger account cannot be moved to another cycle'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`
      CREATE TRIGGER ledger_accounts_cycle_fixed
      BEFORE UPDATE OF cycle_id ON ledger_accounts
      FOR EACH ROW EXECUTE FUNCTION ledger_account_cycle_fixed()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER ledger_accounts_cycle_fixed ON ledger_accounts`);
    await queryRunner.query(`DROP FUNCTION ledger_account_cycle_fixed()`);
    await queryRunner.query(`DROP TRIGGER journal_lines_same_cycle ON journal_lines`);
    await queryRunner.query(`DROP FUNCTION ledger_check_line_cycle()`);
    await queryRunner.query(`DROP TRIGGER journal_entries_balanced ON journal_entries`);
    await queryRunner.query(`DROP TRIGGER journal_lines_balanced ON journal_lines`);
    await queryRunner.query(`DROP FUNCTION ledger_check_line_balanced()`);
    await queryRunner.query(`DROP FUNCTION ledger_check_entry_balanced()`);
    await queryRunner.query(`DROP FUNCTION ledger_assert_balanced(uuid)`);
    for (const table of ['journal_entries', 'journal_lines']) {
      await queryRunner.query(`DROP TRIGGER ${table}_no_truncate ON ${table}`);
      await queryRunner.query(`DROP TRIGGER ${table}_append_only ON ${table}`);
    }
    await queryRunner.query(`DROP FUNCTION ledger_forbid_change()`);
    await queryRunner.query(`DROP TRIGGER farms_compute_geometry ON farms`);
    await queryRunner.query(`DROP FUNCTION farm_compute_geometry()`);
  }
}
