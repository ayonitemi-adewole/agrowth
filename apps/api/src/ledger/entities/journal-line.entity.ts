import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../../common/transformers';
import { JournalEntry } from './journal-entry.entity';
import { LedgerAccount } from './ledger-account.entity';

/**
 * One side of a double-entry posting, in kobo. Positive = debit, negative = credit.
 * The lines of every entry must sum to exactly zero (checked by the database at commit).
 */
@Entity('journal_lines')
@Check(`"amount_kobo" <> 0`)
export class JournalLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JournalEntry, (e) => e.lines, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  journalEntry: JournalEntry;

  @Index()
  @Column({ type: 'uuid' })
  journalEntryId: string;

  @ManyToOne(() => LedgerAccount, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  account: LedgerAccount;

  @Index()
  @Column({ type: 'uuid' })
  accountId: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  amountKobo: bigint;

  @Column({ type: 'varchar', length: 200, nullable: true })
  memo: string | null;
}
