import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cycle } from '../../cycles/entities/cycle.entity';
import { User } from '../../users/user.entity';
import { JournalLine } from './journal-line.entity';

/**
 * Append-only. Once posted, an entry can never be edited or deleted (enforced by
 * database triggers); mistakes are corrected with a reversing entry.
 */
@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Sequential number for auditors; assigned by the database. */
  @Index({ unique: true })
  @Column({ type: 'bigint', generated: 'increment', insert: false, update: false })
  entryNumber: string;

  @ManyToOne(() => Cycle, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn()
  cycle: Cycle | null;

  @Column({ type: 'uuid', nullable: true })
  cycleId: string | null;

  @Column({ type: 'varchar', length: 300 })
  description: string;

  /** External reference: trustee transaction ID, voucher code, offtaker payment ref. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  reference: string | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn()
  postedBy: User;

  @Column({ type: 'uuid' })
  postedById: string;

  @CreateDateColumn({ type: 'timestamptz' })
  postedAt: Date;

  /** Set when this entry reverses another. An entry can be reversed only once. */
  @OneToOne(() => JournalEntry, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn()
  reversalOf: JournalEntry | null;

  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @OneToMany(() => JournalLine, (l) => l.journalEntry, { cascade: ['insert'] })
  lines: JournalLine[];
}
