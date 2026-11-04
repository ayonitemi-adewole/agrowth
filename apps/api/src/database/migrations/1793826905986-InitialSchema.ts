import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1793826905986 implements MigrationInterface {
  name = 'InitialSchema1793826905986';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('admin', 'cycle_manager', 'field_agent', 'compliance_officer', 'auditor', 'investor', 'programme_manager', 'vendor', 'offtaker')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" citext NOT NULL, "full_name" character varying(200) NOT NULL, "phone" character varying(20), "password_hash" character varying(100) NOT NULL, "role" "public"."user_role" NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "last_login_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cooperatives" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(200) NOT NULL, "registration_number" character varying(60), "state" character varying(60) NOT NULL, "lga" character varying(100) NOT NULL, "ward" character varying(100), "contact_phone" character varying(20), CONSTRAINT "PK_52fc93ab8869e3f71c46601fe9b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5dc02f9c5e8c5250a796ef62db" ON "cooperatives" ("registration_number") WHERE registration_number IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tenure_type" AS ENUM('owned', 'leased', 'communal', 'family', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "farms" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "farmer_id" uuid NOT NULL, "name" character varying(120), "boundary" geometry(Polygon,4326) NOT NULL, "area_hectares" numeric(12,4), "centroid" geometry(Point,4326), "primary_crop" character varying(60), "tenure_type" "public"."tenure_type" NOT NULL DEFAULT 'other', "tenure_document_url" character varying(500), "soil_notes" text, CONSTRAINT "PK_39aff9c35006b14025bba5a43d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_45f223a21f7c540d6f264a92c4" ON "farms" USING GiST ("boundary") `,
    );
    await queryRunner.query(`CREATE TYPE "public"."gender" AS ENUM('female', 'male', 'other')`);
    await queryRunner.query(
      `CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'verified', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "farmers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "phone" character varying(20) NOT NULL, "gender" "public"."gender", "date_of_birth" date, "nin_hash" character(64), "nin_last4" character(4), "bvn_hash" character(64), "bvn_last4" character(4), "kyc_status" "public"."kyc_status" NOT NULL DEFAULT 'pending', "state" character varying(60) NOT NULL, "lga" character varying(100) NOT NULL, "ward" character varying(100), "photo_url" character varying(500), "cooperative_id" uuid, "registered_by_id" uuid NOT NULL, CONSTRAINT "PK_ccbe91e5e64dde1329b4c153637" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1404d7f3feb2d58d99bfe68f0" ON "farmers" ("phone") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_88af75976d6640428632438f8a" ON "farmers" ("nin_hash") WHERE nin_hash IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_058ce9e9e45eb606ddf768fe9e" ON "farmers" ("bvn_hash") WHERE bvn_hash IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'awaiting_verification', 'verified', 'released', 'blocked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "milestones" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cycle_id" uuid NOT NULL, "sequence" smallint NOT NULL, "name" character varying(100) NOT NULL, "planned_date" date, "amount_kobo" bigint NOT NULL, "status" "public"."milestone_status" NOT NULL DEFAULT 'pending', "verified_at" TIMESTAMP WITH TIME ZONE, "released_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_6d83766c3e9449a1928f8fcfd12" UNIQUE ("cycle_id", "sequence"), CONSTRAINT "CHK_99a55b6e924da118a504dc5725" CHECK ("amount_kobo" >= 0), CONSTRAINT "PK_0bdbfe399c777a6a8520ff902d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."price_terms" AS ENUM('fixed', 'floor', 'formula')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."offtake_status" AS ENUM('draft', 'signed', 'approved', 'fulfilled', 'breached')`,
    );
    await queryRunner.query(
      `CREATE TABLE "offtake_contracts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "cycle_id" uuid NOT NULL, "buyer_name" character varying(200) NOT NULL, "buyer_contact" character varying(200), "commodity" character varying(60) NOT NULL, "volume_tonnes" numeric(12,3) NOT NULL, "price_terms" "public"."price_terms" NOT NULL, "price_per_tonne_kobo" bigint, "price_floor_per_tonne_kobo" bigint, "price_formula" text, "delivery_window_start" date, "delivery_window_end" date, "document_url" character varying(500), "status" "public"."offtake_status" NOT NULL DEFAULT 'draft', CONSTRAINT "CHK_b92f594c68f318fc3bc6ae4c4c" CHECK ("volume_tonnes" > 0), CONSTRAINT "PK_bece1cfc67f8085dde8871681f7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'pending_approval', 'open_for_funding', 'funded', 'in_progress', 'harvested', 'settled', 'cancelled', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."funding_source" AS ENUM('investor', 'programme', 'blended')`,
    );
    await queryRunner.query(
      `CREATE TABLE "cycles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(40) NOT NULL, "crop" character varying(60) NOT NULL, "season" character varying(40) NOT NULL, "status" "public"."cycle_status" NOT NULL DEFAULT 'draft', "funding_source" "public"."funding_source" NOT NULL, "target_amount_kobo" bigint NOT NULL, "budget_per_hectare_kobo" bigint NOT NULL, "yield_low_t_per_ha" numeric(8,3) NOT NULL, "yield_expected_t_per_ha" numeric(8,3) NOT NULL, "yield_high_t_per_ha" numeric(8,3) NOT NULL, "funding_deadline" date, "start_date" date, "expected_harvest_date" date, "cooperative_id" uuid, "manager_id" uuid NOT NULL, CONSTRAINT "CHK_cd6034e92dd7f7acbf4c0a3e52" CHECK ("yield_low_t_per_ha" >= 0 AND "yield_low_t_per_ha" <= "yield_expected_t_per_ha" AND "yield_expected_t_per_ha" <= "yield_high_t_per_ha"), CONSTRAINT "CHK_936c50f7cad38ed46c611240b0" CHECK ("target_amount_kobo" > 0 AND "budget_per_hectare_kobo" > 0), CONSTRAINT "PK_52e5eeb9c7c6e4ad1aed657967a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3a557a629440a1710793d2cdcb" ON "cycles" ("code") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(60) NOT NULL, "name" character varying(200) NOT NULL, "type" "public"."account_type" NOT NULL, "cycle_id" uuid, CONSTRAINT "PK_62b34396dda564757cf123fff0e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b546e77cf454d53278f35b04d3" ON "ledger_accounts" ("code") WHERE cycle_id IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c7e6ef369978a488937138272c" ON "ledger_accounts" ("cycle_id", "code") WHERE cycle_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "journal_entries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "entry_number" BIGSERIAL NOT NULL, "cycle_id" uuid, "description" character varying(300) NOT NULL, "reference" character varying(120), "posted_by_id" uuid NOT NULL, "posted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "reversal_of_id" uuid, CONSTRAINT "REL_f5e6e5294e58a25e5c1225423a" UNIQUE ("reversal_of_id"), CONSTRAINT "PK_a70368e64230434457c8d007ab3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fc383b1f258773805dce03a65f" ON "journal_entries" ("entry_number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "journal_lines" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "journal_entry_id" uuid NOT NULL, "account_id" uuid NOT NULL, "amount_kobo" bigint NOT NULL, "memo" character varying(200), CONSTRAINT "CHK_6598e604117bb729d84decc22d" CHECK ("amount_kobo" <> 0), CONSTRAINT "PK_70cba2da4588cee8921f73ef136" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fd23ae91f0c24764b4e581c72" ON "journal_lines" ("journal_entry_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_46bed88ea929e6f0aa17bf2084" ON "journal_lines" ("account_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "cycle_farms" ("cycle_id" uuid NOT NULL, "farm_id" uuid NOT NULL, CONSTRAINT "PK_216befc0d62d35e8cee78493118" PRIMARY KEY ("cycle_id", "farm_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dbc5299ecf4de20cafda6f789e" ON "cycle_farms" ("cycle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_69868b3c0199d4d80eba270ffc" ON "cycle_farms" ("farm_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "farms" ADD CONSTRAINT "FK_cf149d788e38bd5934645ac6ef1" FOREIGN KEY ("farmer_id") REFERENCES "farmers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "farmers" ADD CONSTRAINT "FK_38d48edac678550d1edeb9c8b34" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "farmers" ADD CONSTRAINT "FK_6f5fd27cc82229fd5d162eb3d62" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" ADD CONSTRAINT "FK_cbb4db67cba87e7d8ac273d3076" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "offtake_contracts" ADD CONSTRAINT "FK_3d28859925196fbdae085b1c7e2" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycles" ADD CONSTRAINT "FK_92eff3861defec4e10f8bc80a4e" FOREIGN KEY ("cooperative_id") REFERENCES "cooperatives"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycles" ADD CONSTRAINT "FK_80732f4643048333b22178912d0" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_accounts" ADD CONSTRAINT "FK_f32423f2203bb8d1d6ca36e9ff7" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD CONSTRAINT "FK_07e9831177ebcce2bb33c706d91" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD CONSTRAINT "FK_215f2fd608ea86d19d93fad6445" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" ADD CONSTRAINT "FK_f5e6e5294e58a25e5c1225423a4" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_1fd23ae91f0c24764b4e581c72e" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_46bed88ea929e6f0aa17bf20845" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycle_farms" ADD CONSTRAINT "FK_dbc5299ecf4de20cafda6f789e4" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycle_farms" ADD CONSTRAINT "FK_69868b3c0199d4d80eba270ffc0" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cycle_farms" DROP CONSTRAINT "FK_69868b3c0199d4d80eba270ffc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycle_farms" DROP CONSTRAINT "FK_dbc5299ecf4de20cafda6f789e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_46bed88ea929e6f0aa17bf20845"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_1fd23ae91f0c24764b4e581c72e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP CONSTRAINT "FK_f5e6e5294e58a25e5c1225423a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP CONSTRAINT "FK_215f2fd608ea86d19d93fad6445"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entries" DROP CONSTRAINT "FK_07e9831177ebcce2bb33c706d91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_accounts" DROP CONSTRAINT "FK_f32423f2203bb8d1d6ca36e9ff7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycles" DROP CONSTRAINT "FK_80732f4643048333b22178912d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cycles" DROP CONSTRAINT "FK_92eff3861defec4e10f8bc80a4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "offtake_contracts" DROP CONSTRAINT "FK_3d28859925196fbdae085b1c7e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "milestones" DROP CONSTRAINT "FK_cbb4db67cba87e7d8ac273d3076"`,
    );
    await queryRunner.query(
      `ALTER TABLE "farmers" DROP CONSTRAINT "FK_6f5fd27cc82229fd5d162eb3d62"`,
    );
    await queryRunner.query(
      `ALTER TABLE "farmers" DROP CONSTRAINT "FK_38d48edac678550d1edeb9c8b34"`,
    );
    await queryRunner.query(`ALTER TABLE "farms" DROP CONSTRAINT "FK_cf149d788e38bd5934645ac6ef1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_69868b3c0199d4d80eba270ffc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_dbc5299ecf4de20cafda6f789e"`);
    await queryRunner.query(`DROP TABLE "cycle_farms"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_46bed88ea929e6f0aa17bf2084"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1fd23ae91f0c24764b4e581c72"`);
    await queryRunner.query(`DROP TABLE "journal_lines"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fc383b1f258773805dce03a65f"`);
    await queryRunner.query(`DROP TABLE "journal_entries"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_c7e6ef369978a488937138272c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b546e77cf454d53278f35b04d3"`);
    await queryRunner.query(`DROP TABLE "ledger_accounts"`);
    await queryRunner.query(`DROP TYPE "public"."account_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3a557a629440a1710793d2cdcb"`);
    await queryRunner.query(`DROP TABLE "cycles"`);
    await queryRunner.query(`DROP TYPE "public"."funding_source"`);
    await queryRunner.query(`DROP TYPE "public"."cycle_status"`);
    await queryRunner.query(`DROP TABLE "offtake_contracts"`);
    await queryRunner.query(`DROP TYPE "public"."offtake_status"`);
    await queryRunner.query(`DROP TYPE "public"."price_terms"`);
    await queryRunner.query(`DROP TABLE "milestones"`);
    await queryRunner.query(`DROP TYPE "public"."milestone_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_058ce9e9e45eb606ddf768fe9e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_88af75976d6640428632438f8a"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b1404d7f3feb2d58d99bfe68f0"`);
    await queryRunner.query(`DROP TABLE "farmers"`);
    await queryRunner.query(`DROP TYPE "public"."kyc_status"`);
    await queryRunner.query(`DROP TYPE "public"."gender"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_45f223a21f7c540d6f264a92c4"`);
    await queryRunner.query(`DROP TABLE "farms"`);
    await queryRunner.query(`DROP TYPE "public"."tenure_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5dc02f9c5e8c5250a796ef62db"`);
    await queryRunner.query(`DROP TABLE "cooperatives"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
  }
}
