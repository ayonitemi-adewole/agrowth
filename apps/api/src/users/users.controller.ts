import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { CreateStaffUserDto } from '../auth/dto';
import { Role } from '../common/role.enum';
import { User } from './user.entity';
import { UsersService } from './users.service';

class SetActiveDto {
  @IsBoolean()
  isActive: boolean;
}

@ApiTags('users')
@ApiBearerAuth()
@Roles(Role.Admin)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<User[]> {
    return this.users.list();
  }

  /** Admins create staff: cycle managers, field agents, compliance officers and so on. */
  @Post()
  create(@Body() dto: CreateStaffUserDto): Promise<User> {
    return this.users.createStaff(dto);
  }

  @Patch(':id/active')
  @HttpCode(204)
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() me: AuthUser,
  ): Promise<void> {
    if (id === me.id && !dto.isActive) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    await this.users.setActive(id, dto.isActive);
  }
}
