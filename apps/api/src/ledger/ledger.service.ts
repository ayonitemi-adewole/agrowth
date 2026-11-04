import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from './entities/ledger-account.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';

export interface PostingLine {
  accountId: string;
  /** Positive = debit, negative = credit, in kobo. */
  amountKobo: bigint;
  memo?: string;
}

export interface PostingInput {
  cycleId: string | null;
  description: string;
  reference?: string;
  postedById: string;
  /** Set only by reverse(); links a correcting entry to the one it cancels. */
  reversalOfId?: string;
  lines: PostingLine[];
}

/**
 * Checks a posting before it reaches the database. The database enforces the same
 * rules again; this gives callers a clear 400 instead of a constraint error.
 */
export function validatePosting(lines: PostingLine[]): void {
  if (lines.length < 2) {
    throw new BadRequestException('A journal entry needs at least two lines');
  }
  let total = 0n;
  for (const line of lines) {
    if (typeof line.amountKobo !== 'bigint') {
      throw new BadRequestException('Line amounts must be whole kobo (bigint)');
    }
    if (line.amountKobo === 0n) {
      throw new BadRequestException('Line amounts cannot be zero');
    }
    total += line.amountKobo;
  }
  if (total !== 0n) {
    throw new BadRequestException(`Journal entry does not balance: lines sum to ${total} kobo`);
  }
}

@Injectable()
export class LedgerService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(LedgerAccount) private readonly accounts: Repository<LedgerAccount>,
    @InjectRepository(JournalEntry) private readonly entries: Repository<JournalEntry>,
  ) {}

  createAccount(input: {
    code: string;
    name: string;
    type: AccountType;
    cycleId: string | null;
  }): Promise<LedgerAccount> {
    return this.accounts.save(this.accounts.create(input));
  }

  listAccounts(cycleId?: string): Promise<LedgerAccount[]> {
    return this.accounts.find({
      where: cycleId ? { cycleId } : {},
      order: { code: 'ASC' },
    });
  }

  /**
   * Posts a balanced entry. Pass an EntityManager to post inside a caller's transaction
   * (e.g. a disbursement that also updates a milestone); otherwise a new one is opened.
   */
  async post(input: PostingInput, manager?: EntityManager): Promise<JournalEntry> {
    validatePosting(input.lines);
    const run = async (em: EntityManager) => {
      const entry = await em.save(
        em.create(JournalEntry, {
          cycleId: input.cycleId,
          description: input.description,
          reference: input.reference ?? null,
          postedById: input.postedById,
          reversalOfId: input.reversalOfId ?? null,
        }),
      );
      await em.save(
        input.lines.map((l) =>
          em.create(JournalLine, {
            journalEntryId: entry.id,
            accountId: l.accountId,
            amountKobo: l.amountKobo,
            memo: l.memo ?? null,
          }),
        ),
      );
      return entry.id;
    };
    const id = manager ? await run(manager) : await this.dataSource.transaction(run);
    return this.getEntry(id, manager);
  }

  /** Corrects a posted entry by adding its mirror image. The original is never changed. */
  async reverse(entryId: string, postedById: string, reason: string): Promise<JournalEntry> {
    const original = await this.getEntry(entryId);
    const alreadyReversed = await this.entries.exists({ where: { reversalOfId: entryId } });
    if (alreadyReversed) {
      throw new BadRequestException('This entry has already been reversed');
    }
    return this.post({
      cycleId: original.cycleId,
      description: `Reversal of #${original.entryNumber}: ${reason}`,
      reference: original.reference ?? undefined,
      postedById,
      reversalOfId: original.id,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        amountKobo: -l.amountKobo,
        memo: l.memo ?? undefined,
      })),
    });
  }

  async getEntry(id: string, manager?: EntityManager): Promise<JournalEntry> {
    const repo = manager ? manager.getRepository(JournalEntry) : this.entries;
    const entry = await repo.findOne({ where: { id }, relations: { lines: true } });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  listEntries(cycleId?: string): Promise<JournalEntry[]> {
    return this.entries.find({
      where: cycleId ? { cycleId } : {},
      relations: { lines: true },
      order: { entryNumber: 'ASC' },
    });
  }

  /** Debit-positive balance of an account, in kobo. */
  async balance(accountId: string): Promise<bigint> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('coalesce(sum(l.amount_kobo), 0)', 'total')
      .from(JournalLine, 'l')
      .where('l.account_id = :accountId', { accountId })
      .getRawOne<{ total: string }>();
    return BigInt(row?.total ?? '0');
  }
}
