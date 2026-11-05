import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CooperativesService } from './cooperatives.service';
import { Cooperative } from './entities/cooperative.entity';
import { Farm } from './entities/farm.entity';
import { Farmer } from './entities/farmer.entity';
import { FarmersService } from './farmers.service';
import { FarmsService } from './farms.service';
import { RegistryController } from './registry.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cooperative, Farmer, Farm])],
  controllers: [RegistryController],
  providers: [CooperativesService, FarmersService, FarmsService],
  exports: [CooperativesService, FarmersService, FarmsService],
})
export class RegistryModule {}
