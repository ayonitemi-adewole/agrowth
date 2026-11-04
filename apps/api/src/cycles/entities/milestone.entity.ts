import { Check, Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { bigintTransformer } from '../../common/transformers';
import { Cycle } from './cycle.entity';

export enum MilestoneStatus {
  Pending = 'pending',
  AwaitingVerification = 'awaiting_verification',
  Verified = 'verified',
  Released = 'released',
  Blocked = 'blocked',
}

/** A funding tranche tied to a crop stage. Release requires a passed verification. */
@Entity('milestones')
@Unique(['cycle', 'sequence'])
@Check(`"amount_kobo" >= 0`)
export class Milestone extends BaseEntity {
  @ManyToOne(() => Cycle, (c) => c.milestones, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn()
  cycle: Cycle;

  @Column({ type: 'uuid' })
  cycleId: string;

  @Column({ type: 'smallint' })
  sequence: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'date', nullable: true })
  plannedDate: string | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountKobo: bigint;

  @Column({
    type: 'enum',
    enum: MilestoneStatus,
    enumName: 'milestone_status',
    default: MilestoneStatus.Pending,
  })
  status: MilestoneStatus;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt: Date | null;
}
