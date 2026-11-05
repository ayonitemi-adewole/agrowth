import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { pgError, PG_UNIQUE_VIOLATION } from '../common/db-errors';
import { likePattern, Page } from '../common/pagination';
import { CooperativeQuery, CreateCooperativeDto, UpdateCooperativeDto } from './dto';
import { Cooperative } from './entities/cooperative.entity';

@Injectable()
export class CooperativesService {
  constructor(@InjectRepository(Cooperative) private readonly repo: Repository<Cooperative>) {}

  async create(dto: CreateCooperativeDto): Promise<Cooperative> {
    return this.saveOrConflict(this.repo.create(dto));
  }

  async list(query: CooperativeQuery): Promise<Page<Cooperative>> {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.name', 'ASC');
    if (query.state) qb.andWhere('c.state ILIKE :state', { state: query.state });
    if (query.lga) qb.andWhere('c.lga ILIKE :lga', { lga: query.lga });
    if (query.q) qb.andWhere('c.name ILIKE :q', { q: likePattern(query.q) });
    const [items, total] = await qb.take(query.limit).skip(query.offset).getManyAndCount();
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async get(id: string): Promise<Cooperative & { farmerCount: number }> {
    const coop = await this.repo.findOneBy({ id });
    if (!coop) throw new NotFoundException('Cooperative not found');
    const [{ count }]: { count: number }[] = await this.repo.query(
      'SELECT count(*)::int AS count FROM farmers WHERE cooperative_id = $1',
      [id],
    );
    return Object.assign(coop, { farmerCount: count });
  }

  async assertExists(id: string): Promise<void> {
    if (!(await this.repo.existsBy({ id }))) {
      throw new NotFoundException('Cooperative not found');
    }
  }

  async update(id: string, dto: UpdateCooperativeDto): Promise<Cooperative> {
    const coop = await this.repo.findOneBy({ id });
    if (!coop) throw new NotFoundException('Cooperative not found');
    return this.saveOrConflict(this.repo.merge(coop, dto));
  }

  private async saveOrConflict(coop: Cooperative): Promise<Cooperative> {
    try {
      return await this.repo.save(coop);
    } catch (err) {
      if (pgError(err)?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('A cooperative with this registration number already exists');
      }
      throw err;
    }
  }
}
