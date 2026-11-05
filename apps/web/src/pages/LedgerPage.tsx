import { BookOpenCheck, Lock } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Skeleton,
  Table,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatNaira, toKobo } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { LedgerBalance } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Entry {
  id: string;
  entry_number: number;
  description: string;
  reference: string | null;
  posted_at: string;
  reversal_of: string | null;
  journal_lines: {
    id: string;
    account_id: string;
    amount_kobo: number | string;
    memo: string | null;
  }[];
}

/**
 * Read-only by design: money is only posted by the platform's own functions
 * (deposits, payments, refunds). Nobody can type an entry in.
 */
export function LedgerPage() {
  const [cycleId, setCycleId] = useState('');

  const cycles = useAsync(async () => {
    const { data, error } = await supabase
      .from('cycles')
      .select('id, code')
      .not('approved_at', 'is', null)
      .order('code');
    if (error) throw error;
    return data as { id: string; code: string }[];
  }, []);

  const ledger = useAsync(async () => {
    if (!cycleId) return null;
    const [balances, entries] = await Promise.all([
      supabase.from('ledger_balances').select('*').eq('cycle_id', cycleId).order('code'),
      supabase
        .from('journal_entries')
        .select(
          'id, entry_number, description, reference, posted_at, reversal_of, journal_lines(id, account_id, amount_kobo, memo)',
        )
        .eq('cycle_id', cycleId)
        .order('entry_number', { ascending: false }),
    ]);
    if (balances.error) throw balances.error;
    if (entries.error) throw entries.error;
    return { balances: balances.data as LedgerBalance[], entries: entries.data as Entry[] };
  }, [cycleId]);

  const accountName = new Map((ledger.data?.balances ?? []).map((b) => [b.account_id, b.name]));

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every naira, tied to one cycle. Double-entry, append-only: mistakes are corrected by reversing entries, never edits."
        actions={
          <Select
            value={cycleId}
            onChange={(e) => setCycleId(e.target.value)}
            aria-label="Cycle"
            className="min-w-56"
          >
            <option value="">Choose a cycle…</option>
            {cycles.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </Select>
        }
      />

      {!cycleId ? (
        <EmptyState icon={<BookOpenCheck />} title="Choose a cycle">
          A cycle gets its ledger accounts when compliance approves it.
        </EmptyState>
      ) : ledger.loading && !ledger.data ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : ledger.error ? (
        <Alert>{errorMessage(ledger.error)}</Alert>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {ledger.data!.balances.map((b) => (
              <Card key={b.account_id}>
                <p className="text-sm text-zinc-500">{b.name}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 tabular-nums">
                  {formatNaira(b.type === 'liability' ? -toKobo(b.balance_kobo) : b.balance_kobo)}
                </p>
                <p className="mt-1 font-mono text-xs text-zinc-400">{b.code}</p>
              </Card>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Lock className="size-3.5" aria-hidden /> Entries can't be edited or deleted, even by
            the database owner.
          </div>

          {ledger.data!.entries.length === 0 ? (
            <EmptyState title="No entries yet">
              Entries appear as the trustee confirms deposits and payments.
            </EmptyState>
          ) : (
            <Table head={['#', 'Date', 'Description', 'Account', 'Debit', 'Credit']}>
              {ledger.data!.entries.flatMap((e) =>
                e.journal_lines.map((l, i) => {
                  const amount = toKobo(l.amount_kobo);
                  return (
                    <tr
                      key={l.id}
                      className={i === 0 ? 'border-t-2 border-zinc-950/5' : 'border-t-0'}
                    >
                      <td className="font-mono text-xs text-zinc-400">
                        {i === 0 ? e.entry_number : ''}
                      </td>
                      <td className="text-xs whitespace-nowrap text-zinc-500">
                        {i === 0
                          ? new Date(e.posted_at).toLocaleDateString('en-NG', {
                              dateStyle: 'medium',
                            })
                          : ''}
                      </td>
                      <td className="text-zinc-900">
                        {i === 0 && (
                          <span className="flex flex-wrap items-center gap-2">
                            {e.description}
                            {e.reversal_of && <Badge tone="red">Reversal</Badge>}
                            {e.reference && (
                              <span className="font-mono text-xs text-zinc-400">{e.reference}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="text-zinc-600">
                        {accountName.get(l.account_id) ?? 'Platform account'}
                      </td>
                      <td className="text-right tabular-nums">
                        {amount > 0n ? formatNaira(amount) : ''}
                      </td>
                      <td className="text-right tabular-nums">
                        {amount < 0n ? formatNaira(-amount) : ''}
                      </td>
                    </tr>
                  );
                }),
              )}
            </Table>
          )}
        </div>
      )}
    </>
  );
}
