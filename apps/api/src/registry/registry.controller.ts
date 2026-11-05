import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { Page } from '../common/pagination';
import { Role } from '../common/role.enum';
import { CooperativesService } from './cooperatives.service';
import {
  CooperativeQuery,
  CreateCooperativeDto,
  FarmerQuery,
  FarmQuery,
  MapFarmDto,
  PointQuery,
  RegisterFarmerDto,
  SetKycStatusDto,
  UpdateCooperativeDto,
  UpdateFarmDto,
  UpdateFarmerDto,
} from './dto';
import { Cooperative } from './entities/cooperative.entity';
import { Farm } from './entities/farm.entity';
import { Farmer } from './entities/farmer.entity';
import { FarmersService } from './farmers.service';
import { FarmsService, PointCheck } from './farms.service';

/** Staff who need to see the registry. Investors, vendors and offtakers do not. */
const READERS = [
  Role.Admin,
  Role.CycleManager,
  Role.FieldAgent,
  Role.ComplianceOfficer,
  Role.Auditor,
  Role.ProgrammeManager,
];
/** Enrolment and mapping happen in the field. */
const ENROLLERS = [Role.Admin, Role.FieldAgent];
const COOPERATIVE_EDITORS = [Role.Admin, Role.FieldAgent, Role.CycleManager, Role.ProgrammeManager];
const KYC_REVIEWERS = [Role.Admin, Role.ComplianceOfficer];

@ApiTags('registry')
@ApiBearerAuth()
@Controller()
export class RegistryController {
  constructor(
    private readonly cooperatives: CooperativesService,
    private readonly farmers: FarmersService,
    private readonly farms: FarmsService,
  ) {}

  // ---------- Cooperatives ----------

  @Post('cooperatives')
  @Roles(...COOPERATIVE_EDITORS)
  createCooperative(@Body() dto: CreateCooperativeDto): Promise<Cooperative> {
    return this.cooperatives.create(dto);
  }

  @Get('cooperatives')
  @Roles(...READERS)
  listCooperatives(@Query() query: CooperativeQuery): Promise<Page<Cooperative>> {
    return this.cooperatives.list(query);
  }

  @Get('cooperatives/:id')
  @Roles(...READERS)
  getCooperative(@Param('id', ParseUUIDPipe) id: string): Promise<Cooperative> {
    return this.cooperatives.get(id);
  }

  @Patch('cooperatives/:id')
  @Roles(...COOPERATIVE_EDITORS)
  updateCooperative(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCooperativeDto,
  ): Promise<Cooperative> {
    return this.cooperatives.update(id, dto);
  }

  // ---------- Farmers ----------

  @Post('farmers')
  @Roles(...ENROLLERS)
  registerFarmer(@Body() dto: RegisterFarmerDto, @CurrentUser() me: AuthUser): Promise<Farmer> {
    return this.farmers.register(dto, me.id);
  }

  @Get('farmers')
  @Roles(...READERS)
  listFarmers(@Query() query: FarmerQuery): Promise<Page<Farmer>> {
    return this.farmers.list(query);
  }

  @Get('farmers/:id')
  @Roles(...READERS)
  getFarmer(@Param('id', ParseUUIDPipe) id: string): Promise<Farmer> {
    return this.farmers.get(id);
  }

  @Patch('farmers/:id')
  @Roles(...ENROLLERS)
  updateFarmer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFarmerDto,
  ): Promise<Farmer> {
    return this.farmers.update(id, dto);
  }

  /** Manual KYC decision. Automated BVN/NIN checks arrive with the KYC provider adapter. */
  @Patch('farmers/:id/kyc')
  @Roles(...KYC_REVIEWERS)
  setKyc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetKycStatusDto): Promise<Farmer> {
    return this.farmers.setKycStatus(id, dto.kycStatus);
  }

  // ---------- Farms ----------

  @Post('farmers/:id/farms')
  @Roles(...ENROLLERS)
  mapFarm(@Param('id', ParseUUIDPipe) farmerId: string, @Body() dto: MapFarmDto): Promise<Farm> {
    return this.farms.map(farmerId, dto);
  }

  @Get('farms')
  @Roles(...READERS)
  listFarms(@Query() query: FarmQuery): Promise<Page<Farm>> {
    return this.farms.list(query);
  }

  @Get('farms/:id')
  @Roles(...READERS)
  getFarm(@Param('id', ParseUUIDPipe) id: string): Promise<Farm> {
    return this.farms.get(id);
  }

  @Patch('farms/:id')
  @Roles(...ENROLLERS)
  updateFarm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFarmDto): Promise<Farm> {
    return this.farms.update(id, dto);
  }

  /** Is a GPS position inside the mapped boundary? */
  @Get('farms/:id/contains')
  @Roles(...READERS)
  checkPoint(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() point: PointQuery,
  ): Promise<PointCheck> {
    return this.farms.checkPoint(id, point.lon, point.lat);
  }
}
