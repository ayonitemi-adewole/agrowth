import { Check, Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { bigintTransformer, numericTransformer } from '../../common/transformers';
import { Cycle } from './cycle.entity';

export enum PriceTerms {
  Fixed = 'fixed',
  Floor = 'floor',
  Formula = 'formula',
}

export enum OfftakeStatus {
  Draft = 'draft',
  Signed = 'signed',
  Approved = 'approved',
  Fulfilled = 'fulfilled',
  Breached = 'breached',
}

/** A cycle cannot open for funding until it has an approved offtake contract. */
@Entity('offtake_contracts')
@Check(`"volume_tonnes" > 0`)
export class OfftakeContract extends BaseEntity {
  @ManyToOne(() => Cycle, (c) => c.offtakeContracts, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn()
  cycle: Cycle;

  @Column({ type: 'uuid' })
  cycleId: string;

  @Column({ type: 'varchar', length: 200 })
  buyerName: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  buyerContact: string | null;

  @Column({ type: 'varchar', length: 60 })
  commodity: string;

  @Column({ type: 'numeric', precision: 12, scale: 3, transformer: numericTransformer })
  volumeTonnes: number;

  @Column({ type: 'enum', enum: PriceTerms, enumName: 'price_terms' })
  priceTerms: PriceTerms;

  @Column({ type: 'bigint', transformer: bigintTransformer, nullable: true })
  pricePerTonneKobo: bigint | null;

  @Column({ type: 'bigint', transformer: bigintTransformer, nullable: true })
  priceFloorPerTonneKobo: bigint | null;

  @Column({ type: 'text', nullable: true })
  priceFormula: string | null;

  @Column({ type: 'date', nullable: true })
  deliveryWindowStart: string | null;

  @Column({ type: 'date', nullable: true })
  deliveryWindowEnd: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  documentUrl: string | null;

  @Column({
    type: 'enum',
    enum: OfftakeStatus,
    enumName: 'offtake_status',
    default: OfftakeStatus.Draft,
  })
  status: OfftakeStatus;
}
