import { CheckCircle2, ScanLine, Store, TicketCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Spinner,
  Table,
} from '../components/ui';
import { VENDOR_STATUS } from '../lib/cycles';
import { errorMessage } from '../lib/errors';
import { formatDate, titleCase } from '../lib/format';
import { formatNaira, parseNaira, toKobo } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { Vendor, VoucherCheck, VoucherRedemption } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { formatVoucherCode, isVoucherCode, normaliseVoucherCode } from '../lib/vouchers';

type MyRedemption = VoucherRedemption & { vouchers: { code: string } | null };

/** The shop counter: check a farmer's voucher, record what was supplied, see what's been paid. */
export function RedeemPage() {
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

  if (shop.loading && !shop.data) return <Spinner />;
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
        <Counter onRedeemed={shop.reload} />
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

function Counter({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<VoucherCheck | null>(null);
  const [amount, setAmount] = useState('');
  const [items, setItems] = useState('');
  const [done, setDone] = useState<VoucherCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCode('');
    setPhone('');
    setFound(null);
    setAmount('');
    setItems('');
    setDone(null);
    setError(null);
  };

  const check = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('check_voucher', {
      p_code: code,
      p_phone_last4: phone,
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    const result = data as VoucherCheck;
    if (!result.ok) return setError(result.message ?? 'No voucher matches');
    setFound(result);
    setAmount('');
  };

  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    const kobo = parseNaira(amount);
    if (kobo === null || kobo <= 0n) return setError('Enter the value in naira, e.g. 45000');
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc('redeem_voucher', {
      p_code: code,
      p_phone_last4: phone,
      p_amount_kobo: kobo.toString(),
      p_items: items,
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    const result = data as VoucherCheck;
    if (!result.ok) return setError(result.message ?? 'No voucher matches');
    setDone({ ...result, value_kobo: kobo.toString() });
    onRedeemed();
  };

  if (done) {
    return (
      <Card className="max-w-xl">
        <CheckCircle2 className="mb-3 size-8 text-brand-600" aria-hidden />
        <h2 className="text-lg font-semibold text-zinc-950">
          Redeemed {formatNaira(done.value_kobo!)}
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Hand the goods to {done.farmer}. {formatNaira(done.remaining_kobo!)} is left on voucher{' '}
          <span className="font-mono">{formatVoucherCode(done.code!)}</span>. The trustee pays your
          account; you'll see it below.
        </p>
        <Button className="mt-5" onClick={reset}>
          Next farmer
        </Button>
      </Card>
    );
  }

  if (found) {
    const remaining = toKobo(found.remaining_kobo);
    return (
      <Card className="max-w-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-zinc-500">{formatVoucherCode(found.code!)}</p>
            <h2 className="text-lg font-semibold text-zinc-950">{found.farmer}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            Start again
          </Button>
        </div>
        <DescriptionList
          items={[
            ['Cooperative', found.cooperative ?? '—'],
            ['Season', `${titleCase(found.crop ?? '')} · ${found.cycle_code}`],
            ['For', found.purpose],
            ['Left on voucher', formatNaira(remaining)],
            ['Valid until', formatDate(found.expires_on)],
          ]}
        />
        {found.unusable_reason ? (
          <div className="mt-5">
            <Alert>{found.unusable_reason}. Don't hand anything over.</Alert>
          </div>
        ) : (
          <form onSubmit={redeem} className="mt-6 space-y-4 border-t border-zinc-950/5 pt-5">
            <Field label="What you are supplying">
              <Input
                value={items}
                onChange={(e) => setItems(e.target.value)}
                required
                minLength={3}
                maxLength={500}
                placeholder="e.g. 2 bags NPK 15-15-15, 25 kg certified maize seed"
              />
            </Field>
            <Field label="Value (₦)" hint={`At most ${formatNaira(remaining)}`}>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                inputMode="decimal"
              />
            </Field>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" busy={busy}>
              <TicketCheck aria-hidden /> Redeem
            </Button>
          </form>
        )}
      </Card>
    );
  }

  return (
    <Card className="max-w-xl">
      <form onSubmit={check} className="space-y-4">
        <Field label="Voucher code" hint="12 letters and numbers on the farmer's slip">
          <Input
            value={formatVoucherCode(code)}
            onChange={(e) => setCode(normaliseVoucherCode(e.target.value).slice(0, 12))}
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-wider uppercase"
            placeholder="ABCD-EFGH-JKLM"
          />
        </Field>
        <Field
          label="Last 4 digits of the farmer's phone"
          hint="Ask the farmer; it's not on the slip"
        >
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 4))}
            required
            inputMode="numeric"
            pattern="[0-9]{4}"
            title="4 digits"
            autoComplete="off"
            className="w-32 font-mono tracking-widest"
          />
        </Field>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" busy={busy} disabled={!isVoucherCode(code) || phone.length !== 4}>
          <ScanLine aria-hidden /> Check voucher
        </Button>
      </form>
    </Card>
  );
}
