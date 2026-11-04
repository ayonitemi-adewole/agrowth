import { MigrationInterface, QueryRunner } from 'typeorm';

/** PostGIS for farm boundaries, citext for case-insensitive emails, pgcrypto for UUIDs. */
export class Extensions1793750000000 implements MigrationInterface {
  name = 'Extensions1793750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Extensions are left in place: other objects in the database may depend on them.
  }
}
