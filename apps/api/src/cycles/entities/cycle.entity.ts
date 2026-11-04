import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { bigintTransformer, numericTransformer } from '../../common/transformers';
import { Cooperative } from '../../registry/entities/cooperative.entity';
import { Farm } from '../../registry/entities/farm.entity';
import { User } from '../../users/user.entity';
import { Milestone } from './milestone.entity';
import { OfftakeContract } from './offtake-contract.entity';

export enum CycleStatus {
  Draft = 'draft',
  PendingApproval = 'pending_approval',
  OpenForFunding = 'open_for_funding',
  Funded = 'funded',
  InProgress = 'in_progress',
  Harvested = 'harvested',
  Settled = 'settled',
  Cancelled = 'cancelled',
  Refunded = 'refunded',
}

/** Who funds the cycle: licensed investors, a government/donor programme, or both. */
export enum FundingSource {
  Investor = 'investor',
  Programme = 'programme',
  Blended = 'blended',
}

@Entity('cycles')
@Check(`"target_amount_kobo" > 0 AND "budget_per_hectare_kobo" > 0`)
@Check(
  `"yield_low_t_per_ha" >= 0 AND "yield_low_t_per_ha" <= "yield_expected_t_per_ha" AND "yield_expected_t_per_ha" <= "yield_high_t_per_ha"`,
)
export class Cycle extends BaseEntity {
  /** Human-readable reference, e.g. KD-MAIZE-2027-001. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 60 })
  crop: string;

  @Column({ type: 'varchar', length: 40 })
  season: string;

  @Column({ type: 'enum', enum: CycleStatus, enumName: 'cycle_status', default: CycleStatus.Draft })
  status: CycleStatus;

  @Column({ type: 'enum', enum: FundingSource, enumName: 'funding_source' })
  fundingSource: FundingSource;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  targetAmountKobo: bigint;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  budgetPerHectareKobo: bigint;

  /** Yield assumptions in tonnes per hectare, shown to buyers as a range — never a promise. */
  @Column({ type: 'numeric', precision: 8, scale: 3, transformer: numericTransformer })
  yieldLowTPerHa: number;

  @Column({ type: 'numeric', precision: 8, scale: 3, transformer: numericTransformer })
  yieldExpectedTPerHa: number;

  @Column({ type: 'numeric', precision: 8, scale: 3, transformer: numericTransformer })
  yieldHighTPerHa: number;

  @Column({ type: 'date', nullable: true })
  fundingDeadline: string | null;

  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  expectedHarvestDate: string | null;

  @ManyToOne(() => Cooperative, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn()
  cooperative: Cooperative | null;

  @Column({ type: 'uuid', nullable: true })
  cooperativeId: string | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  manager: User;

  @Column({ type: 'uuid' })
  managerId: string;

  @ManyToMany(() => Farm)
  @JoinTable({
    name: 'cycle_farms',
    joinColumn: { name: 'cycle_id' },
    inverseJoinColumn: { name: 'farm_id' },
  })
  farms: Farm[];

  @OneToMany(() => Milestone, (m) => m.cycle)
  milestones: Milestone[];

  @OneToMany(() => OfftakeContract, (o) => o.cycle)
  offtakeContracts: OfftakeContract[];
}
