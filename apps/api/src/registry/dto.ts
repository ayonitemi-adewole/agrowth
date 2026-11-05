import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import type { Polygon } from 'geojson';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQuery } from '../common/pagination';
import { TenureType } from './entities/farm.entity';
import { Gender, KycStatus } from './entities/farmer.entity';
import { IsGeoJsonPolygon } from './geojson';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Identity numbers are often typed with spaces or dashes; keep digits only. */
const digitsOnly = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

const PHONE = /^\+?[0-9]{10,15}$/;
const PHONE_MESSAGE = 'phone must be 10–15 digits, optionally starting with +';

// ---------- Cooperatives ----------

export class CreateCooperativeDto {
  @ApiProperty({ example: 'Zaria Maize Growers Cooperative' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false, example: 'KD/COOP/2019/0042' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  registrationNumber?: string;

  @ApiProperty({ example: 'Kaduna' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  state: string;

  @ApiProperty({ example: 'Zaria' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lga: string;

  @ApiProperty({ required: false, example: 'Samaru' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  ward?: string;

  @ApiProperty({ required: false, example: '+2348012345678' })
  @IsOptional()
  @Transform(trim)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  contactPhone?: string;
}

export class UpdateCooperativeDto extends PartialType(CreateCooperativeDto) {}

export class CooperativeQuery extends PageQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  lga?: string;

  @ApiProperty({ required: false, description: 'Search by name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

// ---------- Farmers ----------

export class RegisterFarmerDto {
  @ApiProperty({ example: 'Amina' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Ibrahim' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: '+2348012345678' })
  @Transform(trim)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;

  @ApiProperty({ required: false, enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiProperty({ required: false, example: '1985-03-14' })
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @ApiProperty({
    required: false,
    description: 'National Identification Number (11 digits). Stored only as a hash.',
  })
  @IsOptional()
  @Transform(digitsOnly)
  @Matches(/^[0-9]{11}$/, { message: 'nin must be 11 digits' })
  nin?: string;

  @ApiProperty({
    required: false,
    description: 'Bank Verification Number (11 digits). Stored only as a hash.',
  })
  @IsOptional()
  @Transform(digitsOnly)
  @Matches(/^[0-9]{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string;

  @ApiProperty({ example: 'Kaduna' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  state: string;

  @ApiProperty({ example: 'Zaria' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lga: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  ward?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  photoUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  cooperativeId?: string;
}

/** Identity numbers and name can't be edited after enrolment; a wrong record is re-registered. */
export class UpdateFarmerDto extends PartialType(
  PickType(RegisterFarmerDto, [
    'phone',
    'gender',
    'dateOfBirth',
    'ward',
    'photoUrl',
    'cooperativeId',
  ] as const),
) {}

export class SetKycStatusDto {
  @ApiProperty({ enum: KycStatus })
  @IsEnum(KycStatus)
  kycStatus: KycStatus;
}

export class FarmerQuery extends PageQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  cooperativeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  lga?: string;

  @ApiProperty({ required: false, enum: KycStatus })
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @ApiProperty({ required: false, description: 'Search by name or phone' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

// ---------- Farms ----------

export class MapFarmDto {
  @ApiProperty({
    description: 'Farm boundary as a GeoJSON Polygon, WGS84 [longitude, latitude]',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [7.7, 11.1],
          [7.7009, 11.1],
          [7.7009, 11.1009],
          [7.7, 11.1009],
          [7.7, 11.1],
        ],
      ],
    },
  })
  @IsGeoJsonPolygon()
  boundary: Polygon;

  @ApiProperty({ required: false, example: 'North plot' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ required: false, example: 'maize' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(60)
  primaryCrop?: string;

  @ApiProperty({ required: false, enum: TenureType })
  @IsOptional()
  @IsEnum(TenureType)
  tenureType?: TenureType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  tenureDocumentUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  soilNotes?: string;
}

export class UpdateFarmDto extends PartialType(MapFarmDto) {}

export class FarmQuery extends PageQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  farmerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  cooperativeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  primaryCrop?: string;
}

export class PointQuery {
  @ApiProperty({ example: 7.70045 })
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon: number;

  @ApiProperty({ example: 11.10045 })
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;
}
