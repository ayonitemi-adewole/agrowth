import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Cycle } from '../../cycles/entities/cycle.entity';

export enum AccountType {
  Asset = 'asset',
  Liability = 'liability',
  Equity = 'equity',
  Income = 'income',
  Expense = 'expense',
}

/**
 * An account belongs to exactly one cycle, or to the platform (cycleId = null) for
 * things like fee income. The database rejects any journal that moves money between
 * two different cycles — that is the "no recycling" rule from the concept.
 */
@Entity('ledger_accounts')
@Index(['cycleId', 'code'], { unique: true, where: 'cycle_id IS NOT NULL' })
@Index(['code'], { unique: true, where: 'cycle_id IS NULL' })
export class LedgerAccount extends BaseEntity {
  @Column({ type: 'varchar', length: 60 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: AccountType, enumName: 'account_type' })
  type: AccountType;

  @ManyToOne(() => Cycle, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn()
  cycle: Cycle | null;

  @Column({ type: 'uuid', nullable: true })
  cycleId: string | null;
}
