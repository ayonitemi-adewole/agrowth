import { CheckCircle2, ScanLine, TicketCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { VoucherScanner } from '../components/VoucherScanner';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  Field,
  Input,
  Spinner,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate, titleCase } from '../lib/format';
import { formatNaira, parseNaira, toKobo } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { VoucherCheck } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { formatVoucherCode, isVoucherCode, normaliseVoucherCode } from '../lib/vouchers';

/**
 * The counter: find a farmer's voucher by scanning its QR code or typing its code, check
 * it, and record what was supplied.
 */
export function Counter({
  onRedeemed,
  initialScan,
}: {
  onRedeemed: () => void;
  initialScan: string | null;
}) {
  // A voucher found by scanning its QR code (its scan token), or null when typing.
  const [scan, setScan] = useState<string | null>(initialScan);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<VoucherCheck | null>(null);
  const [amount, setAmount] = useState('');
  const [items, setItems] = useState('');
  const [done, setDone] = useState<VoucherCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rules = useAsync(async () => {
    const { data, error } = await supabase.rpc('voucher_scan_rules');
    if (error) throw error;
    return data as { needs_phone: boolean };
  }, []);
  const needsPhone = rules.data?.needs_phone ?? false;
  // A scan that needs nothing more is checked straight away.
  const autoCheck = useAsync(
    async () => {
      if (!scan || !rules.data || rules.data.needs_phone) return null;
      const { data, error } = await supabase.rpc('check_scanned_voucher', { p_scanned: scan });
      if (error) throw error;
      return data as VoucherCheck;
    },
    [scan, rules.data?.needs_phone],
    // Each check counts towards the lockout on guessing, so a pull doesn't repeat it.
    { refresh: false },
  );
  const shown = found ?? (autoCheck.data?.ok ? autoCheck.data : null);

  const reset = () => {
    setScan(null);
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
    const { data, error } = scan
      ? await supabase.rpc('check_scanned_voucher', { p_scanned: scan, p_phone_last4: phone })
      : await supabase.rpc('check_voucher', { p_code: code, p_phone_last4: phone });
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
    const { data, error } = scan
      ? await supabase.rpc('redeem_scanned_voucher', {
          p_scanned: scan,
          p_amount_kobo: kobo.toString(),
          p_items: items,
          p_phone_last4: phone || null,
        })
      : await supabase.rpc('redeem_voucher', {
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

  if (shown) {
    const remaining = toKobo(shown.remaining_kobo);
    return (
      <Card className="max-w-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-mono text-sm text-zinc-500">
              {formatVoucherCode(shown.code!)}
              {scan && <Badge tone="blue">Scanned</Badge>}
            </p>
            <h2 className="text-lg font-semibold text-zinc-950">{shown.farmer}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            Start again
          </Button>
        </div>
        <DescriptionList
          items={[
            ['Cooperative', shown.cooperative ?? '—'],
            ['Season', `${titleCase(shown.crop ?? '')} · ${shown.cycle_code}`],
            ['For', shown.purpose],
            ['Left on voucher', formatNaira(remaining)],
            ['Valid until', formatDate(shown.expires_on)],
          ]}
        />
        {shown.unusable_reason ? (
          <div className="mt-5">
            <Alert>{shown.unusable_reason}. Don't hand anything over.</Alert>
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

  const phoneInput = (
    <Field label="Last 4 digits of the farmer's phone" hint="Ask the farmer; it's not on the slip">
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
  );

  if (scan) {
    if (rules.loading || (!needsPhone && autoCheck.loading)) {
      return <Spinner label="Checking the scanned voucher…" />;
    }
    if (needsPhone) {
      return (
        <Card className="max-w-xl">
          <form onSubmit={check} className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-900">
              <ScanLine className="size-4 text-brand-700" aria-hidden /> Voucher scanned
            </p>
            {phoneInput}
            {error && <Alert>{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy} disabled={phone.length !== 4}>
                Check voucher
              </Button>
              <Button variant="ghost" onClick={reset}>
                Type the code instead
              </Button>
            </div>
          </form>
        </Card>
      );
    }
    return (
      <Card className="max-w-xl space-y-4">
        <Alert>
          {autoCheck.error
            ? errorMessage(autoCheck.error)
            : (autoCheck.data?.message ?? 'No voucher matches that scan.')}
        </Alert>
        <Button onClick={reset}>Type the code instead</Button>
      </Card>
    );
  }

  return (
    <Card className="max-w-xl space-y-5">
      <VoucherScanner
        onScan={(token) => {
          setError(null);
          setFound(null);
          setScan(token);
        }}
      />
      <form onSubmit={check} className="space-y-4">
        <Field label="Voucher code" hint="12 letters and numbers on the farmer's slip">
          <Input
            value={formatVoucherCode(code)}
            onChange={(e) => setCode(normaliseVoucherCode(e.target.value).slice(0, 12))}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-wider uppercase"
            placeholder="ABCD-EFGH-JKLM"
          />
        </Field>
        {phoneInput}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" busy={busy} disabled={!isVoucherCode(code) || phone.length !== 4}>
          <ScanLine aria-hidden /> Check voucher
        </Button>
      </form>
    </Card>
  );
}
