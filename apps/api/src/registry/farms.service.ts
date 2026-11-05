import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Polygon } from 'geojson';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { pgError, PG_CHECK_VIOLATION } from '../common/db-errors';
import { Page } from '../common/pagination';
import { CycleStatus } from '../cycles/entities/cycle.entity';
import { FarmQuery, MapFarmDto, UpdateFarmDto } from './dto';
import { Farm, TenureType } from './entities/farm.entity';
import { FarmersService } from './farmers.service';
import { toPolygon2d } from './geojson';

/**
 * Two farms may touch or overlap slightly (GPS error along a shared edge), but if the
 * overlap is more than this share of the smaller farm, the same land is probably being
 * registered twice — the classic "ghost farm".
 */
export const MAX_OVERLAP_SHARE = 0.05;

/** While a cycle is live, its farms' boundaries are what investors and the programme funded. */
const BOUNDARY_LOCKED_STATUSES: CycleStatus[] = [
  CycleStatus.PendingApproval,
  CycleStatus.OpenForFunding,
  CycleStatus.Funded,
  CycleStatus.InProgress,
  CycleStatus.Harvested,
];

export interface OverlappingFarm {
  farmId: string;
  farmerId: string;
  overlapHectares: number;
}

export interface PointCheck {
  farmId: string;
  inside: boolean;
  /** 0 when inside; otherwise the distance to the nearest edge. */
  distanceMetres: number;
}

@Injectable()
export class FarmsService {
  constructor(
    @InjectRepository(Farm) private readonly repo: Repository<Farm>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly farmers: FarmersService,
  ) {}

  async map(farmerId: string, dto: MapFarmDto): Promise<Farm> {
    await this.farmers.assertExists(farmerId);
    const boundary = toPolygon2d(dto.boundary);
    const id = await this.withMappingLock(async (em) => {
      await this.checkBoundary(em, boundary, null);
      const farms = em.getRepository(Farm);
      const saved = await farms.save(
        farms.create({
          farmerId,
          boundary,
          name: dto.name ?? null,
          primaryCrop: dto.primaryCrop ?? null,
          tenureType: dto.tenureType ?? TenureType.Other,
          tenureDocumentUrl: dto.tenureDocumentUrl ?? null,
          soilNotes: dto.soilNotes ?? null,
        }),
      );
      return saved.id;
    });
    return this.get(id);
  }

  async list(query: FarmQuery): Promise<Page<Farm>> {
    const qb = this.repo.createQueryBuilder('farm').orderBy('farm.createdAt', 'DESC');
    if (query.farmerId) qb.andWhere('farm.farmerId = :farmerId', { farmerId: query.farmerId });
    if (query.cooperativeId) {
      qb.innerJoin('farm.farmer', 'farmer').andWhere('farmer.cooperativeId = :cooperativeId', {
        cooperativeId: query.cooperativeId,
      });
    }
    if (query.primaryCrop) {
      qb.andWhere('farm.primaryCrop = :crop', { crop: query.primaryCrop.toLowerCase() });
    }
    const [items, total] = await qb.take(query.limit).skip(query.offset).getManyAndCount();
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async get(id: string): Promise<Farm> {
    const farm = await this.repo.findOneBy({ id });
    if (!farm) throw new NotFoundException('Farm not found');
    return farm;
  }

  async update(id: string, dto: UpdateFarmDto): Promise<Farm> {
    await this.withMappingLock(async (em) => {
      const farms = em.getRepository(Farm);
      const farm = await farms.findOneBy({ id });
      if (!farm) throw new NotFoundException('Farm not found');
      const changes: Partial<Farm> = { ...dto, boundary: undefined };
      if (dto.boundary) {
        await this.assertBoundaryUnlocked(em, id);
        changes.boundary = toPolygon2d(dto.boundary);
        await this.checkBoundary(em, changes.boundary, id);
      }
      await farms.save(farms.merge(farm, stripUndefined(changes)));
    });
    return this.get(id);
  }

  /** Is a GPS fix inside the mapped farm? Used for field-agent check-ins. */
  async checkPoint(id: string, lon: number, lat: number): Promise<PointCheck> {
    const rows: { inside: boolean; distance: number }[] = await this.dataSource.query(
      `SELECT ST_Covers(f.boundary, p.g) AS inside,
              ST_Distance(f.boundary::geography, p.g::geography) AS distance
         FROM farms f, (SELECT ST_SetSRID(ST_MakePoint($2, $3), 4326) AS g) p
        WHERE f.id = $1`,
      [id, lon, lat],
    );
    if (rows.length === 0) throw new NotFoundException('Farm not found');
    return {
      farmId: id,
      inside: rows[0].inside,
      distanceMetres: Math.round(Number(rows[0].distance) * 10) / 10,
    };
  }

  /**
   * Farm writes are serialised so two agents can't map the same land at the same moment
   * and both pass the overlap check. Registry writes are low-volume, so this is cheap.
   */
  private async withMappingLock<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT pg_advisory_xact_lock(hashtext('agrowth.farm_mapping'))`);
        return work(em);
      });
    } catch (err) {
      const pg = pgError(err);
      if (pg?.code === PG_CHECK_VIOLATION) throw new BadRequestException(pg.message);
      throw err;
    }
  }

  private async checkBoundary(
    em: EntityManager,
    boundary: Polygon,
    excludeFarmId: string | null,
  ): Promise<void> {
    const geojson = JSON.stringify(boundary);
    const [validity]: { valid: boolean; reason: string }[] = await em.query(
      `SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) n`,
      [geojson],
    );
    if (!validity.valid) {
      throw new BadRequestException(`Farm boundary is not a valid polygon: ${validity.reason}`);
    }

    const rows: { farmId: string; farmerId: string; overlapHa: number; smallerHa: number }[] =
      await em.query(
        `WITH n AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g)
         SELECT f.id AS "farmId",
                f.farmer_id AS "farmerId",
                ST_Area(ST_Intersection(f.boundary, n.g)::geography) / 10000 AS "overlapHa",
                LEAST(f.area_hectares::float8, ST_Area(n.g::geography) / 10000) AS "smallerHa"
           FROM farms f, n
          WHERE ST_Intersects(f.boundary, n.g)
            AND ($2::uuid IS NULL OR f.id <> $2::uuid)`,
        [geojson, excludeFarmId],
      );
    const overlapping: OverlappingFarm[] = rows
      .filter((r) => Number(r.overlapHa) > MAX_OVERLAP_SHARE * Number(r.smallerHa))
      .map((r) => ({
        farmId: r.farmId,
        farmerId: r.farmerId,
        overlapHectares: Math.round(Number(r.overlapHa) * 10_000) / 10_000,
      }));
    if (overlapping.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'This boundary overlaps land that is already registered',
        overlappingFarms: overlapping,
      });
    }
  }

  private async assertBoundaryUnlocked(em: EntityManager, farmId: string): Promise<void> {
    const rows: { code: string; status: CycleStatus }[] = await em.query(
      `SELECT c.code, c.status
         FROM cycle_farms cf JOIN cycles c ON c.id = cf.cycle_id
        WHERE cf.farm_id = $1 AND c.status = ANY($2::cycle_status[])`,
      [farmId, BOUNDARY_LOCKED_STATUSES],
    );
    if (rows.length > 0) {
      throw new ConflictException(
        `The boundary is locked while the farm is in active cycle ${rows[0].code} (${rows[0].status})`,
      );
    }
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
