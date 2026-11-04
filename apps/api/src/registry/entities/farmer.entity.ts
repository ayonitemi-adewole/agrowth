import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { User } from '../../users/user.entity';
import { Cooperative } from './cooperative.entity';
import { Farm } from './farm.entity';

export enum Gender {
  Female = 'female',
  Male = 'male',
  Other = 'other',
}

export enum KycStatus {
  Pending = 'pending',
  Verified = 'verified',
  Rejected = 'rejected',
}

@Entity('farmers')
export class Farmer extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'enum', enum: Gender, enumName: 'gender', nullable: true })
  gender: Gender | null;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  /** HMAC of the NIN — enforces one record per person without storing the number. */
  @Index({ unique: true, where: 'nin_hash IS NOT NULL' })
  @Column({ type: 'char', length: 64, nullable: true, select: false })
  ninHash: string | null;

  @Column({ type: 'char', length: 4, nullable: true })
  ninLast4: string | null;

  @Index({ unique: true, where: 'bvn_hash IS NOT NULL' })
  @Column({ type: 'char', length: 64, nullable: true, select: false })
  bvnHash: string | null;

  @Column({ type: 'char', length: 4, nullable: true })
  bvnLast4: string | null;

  @Column({ type: 'enum', enum: KycStatus, enumName: 'kyc_status', default: KycStatus.Pending })
  kycStatus: KycStatus;

  @Column({ type: 'varchar', length: 60 })
  state: string;

  @Column({ type: 'varchar', length: 100 })
  lga: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ward: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  photoUrl: string | null;

  @ManyToOne(() => Cooperative, (c) => c.farmers, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn()
  cooperative: Cooperative | null;

  @Column({ type: 'uuid', nullable: true })
  cooperativeId: string | null;

  /** The field agent who enrolled this farmer — needed for audit. */
  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  registeredBy: User;

  @Column({ type: 'uuid' })
  registeredById: string;

  @OneToMany(() => Farm, (farm) => farm.farmer)
  farms: Farm[];
}
