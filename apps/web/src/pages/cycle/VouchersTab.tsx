import { Banknote, Printer, Store, Ticket, TicketCheck, TimerOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Stat,
  Table,
} from '../../components/ui';
import { isoDate, VOUCHER_STATUS } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatNaira, toKobo } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Voucher } from '../../lib/types';
import { formatVoucherCode } from '../../lib/vouchers';
import { PaymentActions, PaymentStatus } from '../../components/PaymentCells';
import { useGatewayPayouts } from '../../lib/payouts';
import type { RedemptionRow, TabProps } from './useCycleData';

type Action = { kind: 'close'; voucher: Voucher } | { kind: 'void'; redemption: RedemptionRow };

export function VouchersTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [closingExpired, setClosingExpired] = useState(false);
  const { vouchers, redemptions, farms, milestones } = data;

  const live = redemptions.filter((r) => !r.voided_at);
  const unpaid = live.filter((r) => !r.paid_at);
  // Where each vendor payment stands (in a payment file, out through Paystack), and paying
  // it, the same as settlement payouts.
  const gateway = useGatewayPayouts(can.readBankFiles(role) && unpaid.length > 0, data.cycle.id);
  const refresh = () => {
    gateway.reload();
    reload();
  };
  const issued = vouchers.reduce((s, v) => s + toKobo(v.value_kobo), 0n);
  const redeemed = live.reduce((s, r) => s + toKobo(r.amount_kobo), 0n);
  const paid = live.filter((r) => r.paid_at).reduce((s, r) => s + toKobo(r.amount_kobo), 0n);
  const returned = vouchers
    .filter((v) => v.status === 'closed')
    .reduce((s, v) => s + toKobo(v.value_kobo) - toKobo(v.redeemed_kobo), 0n);
  const today = isoDate();
  const expired = vouchers.filter((v) => v.status === 'active' && v.expires_on < today);

  const farmerOf = (farmId: string) => farms.find((f) => f.id === farmId);
  const voucherOf = (id: string) => vouchers.find((v) => v.id === id);
  const sequenceOf = (milestoneId: string) =>
    milestones.find((m) => m.id === milestoneId)?.sequence;

  const closeExpired = async () => {
    setClosingExpired(true);
    const { data: n, error } = await supabase.rpc('close_expired_vouchers', {
      p_cycle_id: data.cycle.id,
    });
    setClosingExpired(false);
    if (error) toast.error(errorMessage(error));
    else {
      toast.success(`${n} expired voucher(s) closed; unused value returned to the cycle`);
      reload();
    }
  };

  if (vouchers.length === 0) {
    return (
      <EmptyState icon={<Ticket />} title="No vouchers yet">
        When a milestone release includes an <em>Input vouchers</em> line, the trustee issues one
        voucher per farm. Farmers redeem them at approved agro-dealers, who are paid on redemption.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Ticket />}
          label="Issued"
          value={formatNaira(issued)}
          sub={`${vouchers.length} vouchers`}
        />
        <Stat
          icon={<TicketCheck />}
          label="Redeemed"
          value={formatNaira(redeemed)}
          sub={`${live.length} redemptions`}
          tone="blue"
        />
        <Stat
          icon={<Banknote />}
          label="Paid to vendors"
          value={formatNaira(paid)}
          sub={redeemed > paid ? `${formatNaira(redeemed - paid)} owed` : 'Nothing owed to vendors'}
          tone="violet"
        />
        <Stat
          icon={<TimerOff />}
          label="Returned unused"
          value={formatNaira(returned)}
          sub={`${vouchers.filter((v) => v.status === 'active').length} still active`}
          tone="amber"
        />
      </div>

      <section>
        <SectionTitle
          title="Vouchers"
          description="Give each farmer their slip. At the shop they show the code and confirm the last four digits of their phone."
          actions={
            <div className="flex flex-wrap gap-2">
              {expired.length > 0 && can.manageCycles(role) && (
                <Button variant="secondary" busy={closingExpired} onClick={closeExpired}>
                  <TimerOff aria-hidden /> Close {expired.length} expired
                </Button>
              )}
              <Link to={`/cycles/${data.cycle.id}/vouchers/print`} target="_blank">
                <Button variant="secondary">
                  <Printer aria-hidden /> Print slips
                </Button>
              </Link>
            </div>
          }
        />
        <Table head={['Code', 'Farmer', 'Milestone', 'Value', 'Used', 'Valid until', 'Status', '']}>
          {vouchers.map((v) => {
            const farm = farmerOf(v.farm_id);
            const isExpired = v.status === 'active' && v.expires_on < today;
            return (
              <tr key={v.id}>
                <td className="font-mono text-xs whitespace-nowrap text-zinc-900">
                  {formatVoucherCode(v.code)}
                </td>
                <td>
                  <p className="font-medium text-zinc-900">{farm?.farmer_name ?? '—'}</p>
                  <p className="text-xs text-zinc-500">{farm?.name ?? 'Farm'}</p>
                </td>
                <td className="text-zinc-600">{sequenceOf(v.milestone_id)}</td>
                <td className="text-zinc-900 tabular-nums">{formatNaira(v.value_kobo)}</td>
                <td className="text-zinc-600 tabular-nums">{formatNaira(v.redeemed_kobo)}</td>
                <td className="whitespace-nowrap text-zinc-600">{formatDate(v.expires_on)}</td>
                <td>
                  {isExpired ? (
                    <Badge tone="red" dot>
                      Expired
                    </Badge>
                  ) : (
                    <Badge tone={VOUCHER_STATUS[v.status].tone} dot>
                      {VOUCHER_STATUS[v.status].label}
                    </Badge>
                  )}
                  {v.close_reason && <p className="mt-1 text-xs text-zinc-500">{v.close_reason}</p>}
                </td>
                <td className="text-right">
                  {v.status === 'active' && can.manageCycles(role) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAction({ kind: 'close', voucher: v })}
                    >
                      Close
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </section>

      <section>
        <SectionTitle
          title="Redemptions"
          description={`What vendors supplied against vouchers. The trustee pays each vendor's registered account${gateway.data?.provider ? ', through Paystack or from the bank' : ' from the bank'}; payments in a bank payment file are confirmed from the bank statement.`}
        />
        {redemptions.length === 0 ? (
          <EmptyState icon={<Store />}>No vouchers have been redeemed yet.</EmptyState>
        ) : (
          <Table head={['Date', 'Vendor', 'Voucher', 'Supplied', 'Amount', 'Payment', '']}>
            {redemptions.map((r) => {
              const voucher = voucherOf(r.voucher_id);
              const farmer = voucher ? farmerOf(voucher.farm_id)?.farmer_name : undefined;
              return (
                <tr key={r.id} className={r.voided_at ? 'text-zinc-400 line-through' : undefined}>
                  <td className="whitespace-nowrap">{formatDate(r.redeemed_at)}</td>
                  <td className="font-medium">{r.vendors.name}</td>
                  <td className="whitespace-nowrap">
                    <span className="font-mono text-xs">
                      {voucher ? formatVoucherCode(voucher.code) : '—'}
                    </span>
                    {farmer && <p className="text-xs text-zinc-500 no-underline">{farmer}</p>}
                  </td>
                  <td className="max-w-xs">{r.items}</td>
                  <td className="tabular-nums">{formatNaira(r.amount_kobo)}</td>
                  <td className="min-w-48 no-underline">
                    <PaymentStatus
                      kind="vendor_payment"
                      id={r.id}
                      paidAt={r.paid_at}
                      reference={r.trustee_reference}
                      gateway={gateway.data}
                      voided={r.voided_at ? (r.void_reason ?? 'Voided') : null}
                      onHold={
                        r.vendors.status !== 'approved'
                          ? `${r.vendors.name} is ${r.vendors.status}, so its payments are held`
                          : null
                      }
                    />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {!r.voided_at && !r.paid_at && (
                      <PaymentActions
                        kind="vendor_payment"
                        id={r.id}
                        gateway={gateway.data}
                        trustee={can.actAsTrustee(role)}
                        reload={refresh}
                        record={
                          r.vendors.status === 'approved'
                            ? {
                                rpc: 'confirm_redemption_payment',
                                args: { p_redemption_id: r.id },
                                amountKobo: r.amount_kobo,
                                payee: r.vendors.name,
                                account: `${r.vendors.account_name}, ${r.vendors.bank_name} ${r.vendors.account_number}`,
                              }
                            : undefined
                        }
                      >
                        {can.voidRedemptions(role) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAction({ kind: 'void', redemption: r })}
                          >
                            Void
                          </Button>
                        )}
                      </PaymentActions>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>

      <Modal
        open={action !== null}
        onClose={() => setAction(null)}
        title={action?.kind === 'close' ? 'Close voucher' : 'Void redemption'}
        description={action ? describe(action) : undefined}
      >
        {action && (
          <ActionForm
            action={action}
            onDone={(message) => {
              setAction(null);
              if (message) {
                toast.success(message);
                refresh();
              }
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function describe(action: Action) {
  if (action.kind === 'close') {
    const left = toKobo(action.voucher.value_kobo) - toKobo(action.voucher.redeemed_kobo);
    return `The farmer can no longer use voucher ${formatVoucherCode(action.voucher.code)}. Its unused ${formatNaira(left)} goes back to the cycle's cash.`;
  }
  const r = action.redemption;
  return `Cancel ${r.vendors.name}'s claim of ${formatNaira(r.amount_kobo)}, for example if the goods were never handed over. The value goes back on the farmer's voucher.`;
}

/** Closing a voucher or voiding a redemption, with the reason. */
function ActionForm({
  action,
  onDone,
}: {
  action: Action;
  onDone: (message: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } =
      action.kind === 'close'
        ? await supabase.rpc('close_voucher', { p_voucher_id: action.voucher.id, p_reason: value })
        : await supabase.rpc('void_redemption', {
            p_redemption_id: action.redemption.id,
            p_reason: value,
          });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    onDone(action.kind === 'close' ? 'Voucher closed' : 'Redemption voided');
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Reason">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          autoFocus
          maxLength={300}
          placeholder={
            action.kind === 'close'
              ? 'e.g. Farmer left the cooperative'
              : 'e.g. Goods not handed over'
          }
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(null)}>
          Back
        </Button>
        <Button type="submit" busy={busy} variant="danger">
          {action.kind === 'close' ? 'Close voucher' : 'Void redemption'}
        </Button>
      </div>
    </form>
  );
}
