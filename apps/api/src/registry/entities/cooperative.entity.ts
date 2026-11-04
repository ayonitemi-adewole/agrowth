import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Farmer } from './farmer.entity';

@Entity('cooperatives')
export class Cooperative extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Index({ unique: true, where: 'registration_number IS NOT NULL' })
  @Column({ type: 'varchar', length: 60, nullable: true })
  registrationNumber: string | null;

  @Column({ type: 'varchar', length: 60 })
  state: string;

  @Column({ type: 'varchar', length: 100 })
  lga: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ward: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contactPhone: string | null;

  @OneToMany(() => Farmer, (farmer) => farmer.cooperative)
  farmers: Farmer[];
}
