import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { pgError, PG_UNIQUE_VIOLATION } from '../common/db-errors';
import { likePattern, Page } from '../common/pagination';
import { hashIdentifier, lastFour } from '../common/pii';
import { CooperativesService } from './cooperatives.service';
import { FarmerQuery, RegisterFarmerDto, UpdateFarmerDto } from './dto';
import { Farmer, KycStatus } from './entities/farmer.entity';

@Injectable()
export class FarmersService {
  private readonly pepper: string;

  constructor(
    @InjectRepository(Farmer) private readonly repo: Repository<Farmer>,
    private readonly cooperatives: CooperativesService,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<string>('PII_HASH_PEPPER');
  }

  /**
   * Enrols a farmer. At least one national identifier is required so the registry can
   * guarantee one record per person — the main defence against ghost and duplicate farmers.
   */
  async register(dto: RegisterFarmerDto, registeredById: string): Promise<Farmer> {
    if (!dto.nin && !dto.bvn) {
      throw new BadRequestException('Provide a NIN or BVN so the farmer can be deduplicated');
    }
    if (dto.cooperativeId) await this.cooperatives.assertExists(dto.cooperativeId);

    const ninHash = dto.nin ? hashIdentifier(dto.nin, this.pepper) : null;
    const bvnHash = dto.bvn ? hashIdentifier(dto.bvn, this.pepper) : null;
    await this.assertNotEnrolled(ninHash, bvnHash);

    const farmer = this.repo.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      gender: dto.gender ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      ninHash,
      ninLast4: dto.nin ? lastFour(dto.nin) : null,
      bvnHash,
      bvnLast4: dto.bvn ? lastFour(dto.bvn) : null,
      state: dto.state,
      lga: dto.lga,
      ward: dto.ward ?? null,
      photoUrl: dto.photoUrl ?? null,
      cooperativeId: dto.cooperativeId ?? null,
      registeredById,
    });
    try {
      const saved = await this.repo.save(farmer);
      return this.get(saved.id);
    } catch (err) {
      // Two agents enrolling the same person at the same moment: the unique index decides.
      if (pgError(err)?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('This farmer is already enrolled');
      }
      throw err;
    }
  }

  async list(query: FarmerQuery): Promise<Page<Farmer>> {
    const qb = this.repo
      .createQueryBuilder('f')
      .orderBy('f.lastName', 'ASC')
      .addOrderBy('f.firstName', 'ASC');
    if (query.cooperativeId) {
      qb.andWhere('f.cooperativeId = :cooperativeId', { cooperativeId: query.cooperativeId });
    }
    if (query.state) qb.andWhere('f.state ILIKE :state', { state: query.state });
    if (query.lga) qb.andWhere('f.lga ILIKE :lga', { lga: query.lga });
    if (query.kycStatus) qb.andWhere('f.kycStatus = :kyc', { kyc: query.kycStatus });
    if (query.q) {
      qb.andWhere(
        "(f.firstName || ' ' || f.lastName ILIKE :q OR f.lastName || ' ' || f.firstName ILIKE :q OR f.phone LIKE :q)",
        { q: likePattern(query.q) },
      );
    }
    const [items, total] = await qb.take(query.limit).skip(query.offset).getManyAndCount();
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async get(id: string): Promise<Farmer> {
    const farmer = await this.repo.findOne({
      where: { id },
      relations: { cooperative: true, farms: true },
    });
    if (!farmer) throw new NotFoundException('Farmer not found');
    return farmer;
  }

  async assertExists(id: string): Promise<void> {
    if (!(await this.repo.existsBy({ id }))) throw new NotFoundException('Farmer not found');
  }

  async update(id: string, dto: UpdateFarmerDto): Promise<Farmer> {
    const farmer = await this.repo.findOneBy({ id });
    if (!farmer) throw new NotFoundException('Farmer not found');
    if (dto.cooperativeId) await this.cooperatives.assertExists(dto.cooperativeId);
    await this.repo.save(this.repo.merge(farmer, dto));
    return this.get(id);
  }

  async setKycStatus(id: string, kycStatus: KycStatus): Promise<Farmer> {
    const result = await this.repo.update({ id }, { kycStatus });
    if (!result.affected) throw new NotFoundException('Farmer not found');
    return this.get(id);
  }

  private async assertNotEnrolled(ninHash: string | null, bvnHash: string | null): Promise<void> {
    const qb = this.repo.createQueryBuilder('f').select(['f.id']);
    if (ninHash) qb.orWhere('f.ninHash = :ninHash', { ninHash });
    if (bvnHash) qb.orWhere('f.bvnHash = :bvnHash', { bvnHash });
    const existing = await qb.getOne();
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'A farmer with this NIN or BVN is already enrolled',
        existingFarmerId: existing.id,
      });
    }
  }
}
