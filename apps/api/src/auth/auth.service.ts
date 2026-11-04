import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Role } from '../common/role.enum';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterInvestorDto, TokenResponse } from './dto';

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('agrowth-timing-equaliser', 12));

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Public sign-up always creates an investor; staff accounts are created by an admin. */
  async registerInvestor(dto: RegisterInvestorDto): Promise<User> {
    return this.users.create({ ...dto, role: Role.Investor });
  }

  async login(dto: LoginDto): Promise<TokenResponse> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const valid = await bcrypt.compare(dto.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !valid || !user.isActive) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    await this.users.recordLogin(user.id);
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '1h';
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }
}
