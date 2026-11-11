import { Store, TicketCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  PageSkeleton,
  SectionTitle,
  Table,
} from '../components/ui';
import { VENDOR_STATUS } from '../lib/cycles';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { formatNaira, toKobo } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { Vendor, VoucherRedemption } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { formatVoucherCode, scanTokenFrom } from '../lib/vouchers';
import { Counter } from './RedeemCounter';

type MyRedemption = VoucherRedemption & { vouchers: { code: string } | null };

/** The shop counter: check a farmer's voucher, record what was supplied, see what's been paid. */
export function RedeemPage() {
  // Opened from a voucher slip's QR code: /redeem?v=<scan token>. The token is taken once
  // and dropped from the address, so a refresh or the back button doesn't reuse it.
  const [params, setParams] = useSearchParams();
  const [initialScan] = useState(() => scanTokenFrom(params.get('v') ?? ''));
  useEffect(() => {
    if (params.has('v')) setParams({}, { replace: true });
  }, [params, setParams]);

  const shop = useAsync(async () => {
    const [vendor, redemptions] = await Promise.all([
      supabase.from('vendors').select('*').maybeSingle(),
      supabase
        .from('voucher_redemptions')
        .select('*, vouchers(code)')
        .order('redeemed_at', { ascending: false })
        .limit(100),
    ]);
    if (vendor.error) throw vendor.error;
    if (redemptions.error) throw redemptions.error;
    return {
      vendor: vendor.data as Vendor | null,
      redemptions: redemptions.data as MyRedemption[],
    };
  }, []);

  if (shop.loading && !shop.data) return <PageSkeleton variant="detail" />;
  if (shop.error) return <Alert>{errorMessage(shop.error)}</Alert>;
  const { vendor, redemptions } = shop.data!;

  if (!vendor) {
    return (
      <EmptyState icon={<Store />} title="Your account isn't linked to a shop yet">
        Ask an Agrowth admin to link this sign-in to your registered shop on the Vendors page.
      </EmptyState>
    );
  }

  const live = redemptions.filter((r) => !r.voided_at);
  const owed = live.filter((r) => !r.paid_at).reduce((s, r) => s + toKobo(r.amount_kobo), 0n);

  return (
    <>
      <PageHeader
        title="Redeem vouchers"
        description={
          <>
            {vendor.name} · paid to {vendor.bank_name} {vendor.account_number}
          </>
        }
        actions={
          <Badge tone={VENDOR_STATUS[vendor.status].tone} dot>
            {VENDOR_STATUS[vendor.status].label}
          </Badge>
        }
      />

      {vendor.status !== 'approved' ? (
        <Alert>
          Your shop is {VENDOR_STATUS[vendor.status].label.toLowerCase()}, so it can't redeem
          vouchers right now.{vendor.status_note ? ` ${vendor.status_note}.` : ''}
        </Alert>
      ) : (
        <Counter onRedeemed={shop.reload} initialScan={initialScan} />
      )}

      <section className="mt-10">
        <SectionTitle
          title="Your redemptions"
          description={
            owed > 0n
              ? `${formatNaira(owed)} waiting to be paid by the trustee.`
              : 'Everything you have redeemed has been paid.'
          }
        />
        {redemptions.length === 0 ? (
          <EmptyState icon={<TicketCheck />}>Nothing redeemed yet.</EmptyState>
        ) : (
          <Table head={['Date', 'Voucher', 'Supplied', 'Amount', 'Payment']}>
            {redemptions.map((r) => (
              <tr key={r.id} className={r.voided_at ? 'text-zinc-400' : undefined}>
                <td className="whitespace-nowrap">{formatDate(r.redeemed_at)}</td>
                <td className="font-mono text-xs whitespace-nowrap">
                  {r.vouchers ? formatVoucherCode(r.vouchers.code) : '—'}
                </td>
                <td className="max-w-xs">{r.items}</td>
                <td className="tabular-nums">{formatNaira(r.amount_kobo)}</td>
                <td>
                  {r.voided_at ? (
                    <Badge tone="neutral">Voided: {r.void_reason}</Badge>
                  ) : r.paid_at ? (
                    <Badge tone="green" dot>
                      Paid {formatDate(r.paid_at)} · {r.trustee_reference}
                    </Badge>
                  ) : (
                    <Badge tone="amber" dot>
                      Awaiting payment
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </>
  );
}
