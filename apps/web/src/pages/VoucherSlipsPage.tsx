import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Logo } from '../components/Layout';
import { Alert, Button, PageSkeleton, Select } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate, titleCase } from '../lib/format';
import { formatNaira, toKobo } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { Voucher } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { formatVoucherCode, voucherScanUrl } from '../lib/vouchers';
import { QrCode } from '../components/QrCode';

type SlipVoucher = Voucher & {
  farms: { name: string | null; farmers: { full_name: string } };
  milestones: { sequence: number; name: string };
};

/** One slip per active voucher, laid out to print on A4 and cut. */
export function VoucherSlipsPage() {
  const { id } = useParams<{ id: string }>();
  const [milestone, setMilestone] = useState('');

  const state = useAsync(async () => {
    const [cycle, vouchers, tokens, settings] = await Promise.all([
      supabase
        .from('cycles')
        .select('code, crop, season, cooperatives(name)')
        .eq('id', id!)
        .single(),
      supabase
        .from('vouchers')
        .select('*, farms(name, farmers(full_name)), milestones(sequence, name)')
        .eq('cycle_id', id!)
        .eq('status', 'active')
        .order('issued_at')
        .order('code'),
      supabase.rpc('voucher_slip_tokens', { p_cycle_id: id! }),
      supabase.from('voucher_settings').select('scan_needs_phone').maybeSingle(),
    ]);
    if (cycle.error) throw cycle.error;
    if (vouchers.error) throw vouchers.error;
    if (tokens.error) throw tokens.error;
    return {
      tokens: new Map(
        (tokens.data as { voucher_id: string; token: string }[]).map((t) => [
          t.voucher_id,
          t.token,
        ]),
      ),
      scanNeedsPhone: Boolean(settings.data?.scan_needs_phone),
      cycle: cycle.data as unknown as {
        code: string;
        crop: string;
        season: string;
        cooperatives: { name: string } | null;
      },
      vouchers: vouchers.data as SlipVoucher[],
    };
  }, [id]);

  if (state.loading && (!state.data || state.stale)) return <PageSkeleton variant="cards" />;
  if (state.error) return <Alert>{errorMessage(state.error)}</Alert>;
  const { cycle, vouchers, tokens, scanNeedsPhone } = state.data!;
  const milestones = [
    ...new Map(vouchers.map((v) => [v.milestone_id, v.milestones])).entries(),
  ].sort((a, b) => a[1].sequence - b[1].sequence);
  const shown = milestone ? vouchers.filter((v) => v.milestone_id === milestone) : vouchers;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link to={`/cycles/${id}`} className="link-back">
            ← Back to cycle
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-zinc-950">
            Voucher slips · <span className="font-mono">{cycle.code}</span>
          </h1>
          <p className="text-sm text-zinc-500">
            {shown.length} active voucher(s). Hand each farmer their own slip.
          </p>
        </div>
        <div className="flex gap-2">
          {milestones.length > 1 && (
            <Select
              value={milestone}
              onChange={(e) => setMilestone(e.target.value)}
              aria-label="Milestone"
            >
              <option value="">All milestones</option>
              {milestones.map(([mid, m]) => (
                <option key={mid} value={mid}>
                  {m.sequence}. {m.name}
                </option>
              ))}
            </Select>
          )}
          <Button onClick={() => window.print()} disabled={shown.length === 0}>
            <Printer aria-hidden /> Print
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-600">No active vouchers to print.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-0">
          {shown.map((v) => (
            <article
              key={v.id}
              className="break-inside-avoid rounded-xl border border-dashed border-zinc-400 bg-white p-5 print:rounded-none"
            >
              <div className="flex items-center justify-between">
                <Logo />
                <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  Input voucher
                </span>
              </div>
              <p className="mt-4 text-lg font-semibold text-zinc-950">
                {v.farms.farmers.full_name}
              </p>
              <p className="text-sm text-zinc-600">
                {cycle.cooperatives?.name ?? 'Cooperative'} · {v.farms.name ?? 'Farm'}
              </p>
              <p className="mt-3 text-sm text-zinc-700">
                {titleCase(cycle.crop)} {cycle.season} · {v.milestones.name}: {v.purpose}
              </p>
              <div className="mt-4 flex items-center gap-4 rounded-lg bg-zinc-100 px-4 py-3 print:bg-white print:ring-1 print:ring-zinc-300">
                {tokens.get(v.id) && (
                  <QrCode
                    value={voucherScanUrl(tokens.get(v.id)!, window.location.origin)}
                    size={112}
                    label={`QR code for voucher ${formatVoucherCode(v.code)}`}
                    className="shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1 text-center">
                  <p className="font-mono text-xl font-semibold tracking-widest text-zinc-950 sm:text-2xl">
                    {formatVoucherCode(v.code)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-700">
                    Worth up to{' '}
                    <span className="font-semibold">
                      {formatNaira(toKobo(v.value_kobo) - toKobo(v.redeemed_kobo))}
                    </span>{' '}
                    · valid until {formatDate(v.expires_on)}
                  </p>
                </div>
              </div>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-zinc-600">
                <li>Use it at any Agrowth-approved agro-dealer, in one visit or several.</li>
                <li>
                  {scanNeedsPhone
                    ? 'The shop scans the QR code or types the code, then asks for the last 4 digits of your registered phone number.'
                    : 'The shop scans the QR code. If it types the code instead, it will ask for the last 4 digits of your registered phone number.'}
                </li>
                <li>
                  It can't be exchanged for cash.{' '}
                  {scanNeedsPhone
                    ? 'Keep the code private.'
                    : 'Keep the slip safe: whoever has it can use it, like cash.'}
                </li>
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
