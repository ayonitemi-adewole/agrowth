import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role, STAFF_ROLES } from '../common/role.enum';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PasswordFields {
  @ApiProperty({ minLength: 10, example: 'correct horse battery' })
  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  @MaxLength(128)
  password: string;
}

export class RegisterInvestorDto extends PasswordFields {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Ada Okafor' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  @ApiProperty({ required: false, example: '+2348012345678' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9]{10,15}$/, {
    message: 'phone must be 10–15 digits, optionally starting with +',
  })
  phone?: string;
}

export class CreateStaffUserDto extends RegisterInvestorDto {
  @ApiProperty({ enum: STAFF_ROLES })
  @IsEnum(Role)
  role: Role;
}

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com' })
  @Transform(trimLower)
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password: string;
}

export class TokenResponse {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: '1h' })
  expiresIn: string;
}
