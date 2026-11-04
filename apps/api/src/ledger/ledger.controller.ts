import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { Role } from '../common/role.enum';
import { LedgerAccount } from './entities/ledger-account.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerService } from './ledger.service';

/**
 * Read-only on purpose. Money is only posted by internal flows (funding, disbursement,
 * settlement) — there is no "manual journal" endpoint for anyone to misuse.
 */
@ApiTags('ledger')
@ApiBearerAuth()
@Roles(Role.Admin, Role.Auditor, Role.ComplianceOfficer)
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('accounts')
  @ApiQuery({ name: 'cycleId', required: false })
  accounts(
    @Query('cycleId', new ParseUUIDPipe({ optional: true })) cycleId?: string,
  ): Promise<LedgerAccount[]> {
    return this.ledger.listAccounts(cycleId);
  }

  @Get('accounts/:id/balance')
  async balance(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ accountId: string; balanceKobo: string }> {
    return { accountId: id, balanceKobo: (await this.ledger.balance(id)).toString() };
  }

  @Get('entries')
  @ApiQuery({ name: 'cycleId', required: false })
  entries(
    @Query('cycleId', new ParseUUIDPipe({ optional: true })) cycleId?: string,
  ): Promise<JournalEntry[]> {
    return this.ledger.listEntries(cycleId);
  }
}
