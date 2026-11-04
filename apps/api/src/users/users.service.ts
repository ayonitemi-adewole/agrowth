import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Role, STAFF_ROLES } from '../common/role.enum';
import { User } from './user.entity';

const BCRYPT_ROUNDS = 12;

export interface NewUser {
  email: string;
  fullName: string;
  phone?: string;
  password: string;
  role: Role;
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Includes the password hash — only for credential checks. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }

  list(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async create(input: NewUser): Promise<User> {
    const existing = await this.repo.exists({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const user = this.repo.create({
      email: input.email,
      fullName: input.fullName,
      phone: input.phone ?? null,
      role: input.role,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    });
    const saved = await this.repo.save(user);
    return (await this.findById(saved.id))!;
  }

  createStaff(input: NewUser): Promise<User> {
    if (!STAFF_ROLES.includes(input.role)) {
      throw new BadRequestException('Staff accounts must use a staff role');
    }
    return this.create(input);
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.repo.update({ id }, { isActive });
  }

  async recordLogin(id: string): Promise<void> {
    await this.repo.update({ id }, { lastLoginAt: new Date() });
  }
}
