import type { Point, Polygon } from 'geojson';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { numericTransformer } from '../../common/transformers';
import { Farmer } from './farmer.entity';

export enum TenureType {
  Owned = 'owned',
  Leased = 'leased',
  Communal = 'communal',
  Family = 'family',
  Other = 'other',
}

@Entity('farms')
export class Farm extends BaseEntity {
  @ManyToOne(() => Farmer, (f) => f.farms, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  farmer: Farmer;

  @Column({ type: 'uuid' })
  farmerId: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  /** Farm boundary in WGS84 (lon/lat), captured by GPS walk or traced on satellite imagery. */
  @Index({ spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'Polygon', srid: 4326 })
  boundary: Polygon;

  /** Computed by the database from the boundary — never trusted from the client. */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    transformer: numericTransformer,
    insert: false,
    update: false,
    nullable: true,
  })
  areaHectares: number;

  /** Computed by the database from the boundary. */
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
    insert: false,
    update: false,
    nullable: true,
  })
  centroid: Point;

  @Column({ type: 'varchar', length: 60, nullable: true })
  primaryCrop: string | null;

  @Column({ type: 'enum', enum: TenureType, enumName: 'tenure_type', default: TenureType.Other })
  tenureType: TenureType;

  @Column({ type: 'varchar', length: 500, nullable: true })
  tenureDocumentUrl: string | null;

  @Column({ type: 'text', nullable: true })
  soilNotes: string | null;
}
