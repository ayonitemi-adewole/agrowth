import { CheckCircle2, Handshake, Scale, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { CycleStatusBadge } from '../components/StatusBadges';
import { useToast } from '../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PageSkeleton,
  Progress,
  SectionTitle,
  Stat,
  Table,
  Textarea,
} from '../components/ui';
import { HARVEST_GRADE } from '../lib/cycles';
import { errorMessage } from '../lib/errors';
import { formatDate, titleCase } from '../lib/format';
import { formatNaira, toKobo } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { CycleStatus, HarvestGrade } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Load {
  id: string;
  delivered_on: string;
  weight_kg: number;
  grade: HarvestGrade;
  moisture_pct: number | null;
  waybill_reference: string;
  farm: string;
  voided: boolean;
  void_reason: string | null;
  confirmed_at: string | null;
  disputed_at: string | null;
  dispute: string | null;
}

interface Agreement {
  id: string;
  cycle_code: string;
  crop: string;
  season: string;
  cycle_status: CycleStatus;
  cooperative: string | null;
  state: string | null;
  lga: string | null;
  commodity: string;
  volume_tonnes: number;
  price_terms: 'fixed' | 'floor' | 'formula';
  price_per_tonne_kobo: string | null;
  price_floor_per_tonne_kobo: string | null;
  price_formula: string | null;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  expected_harvest_date: string | null;
  accepted_kg: number;
  rejected_kg: number;
  paid_kobo: string;
  value_kobo: string | null;
  deliveries: Load[];
}

const tonnes = (kg: number) =>
  `${(kg / 1000).toLocaleString('en-NG', { maximumFractionDigits: 1 })} t`;

const price = (a: Agreement) =>
  a.price_terms === 'fixed'
    ? `${formatNaira(a.price_per_tonne_kobo!)} per tonne, fixed`
    : a.price_terms === 'floor'
      ? `At least ${formatNaira(a.price_floor_per_tonne_kobo!)} per tonne`
      : (a.price_formula ?? 'By formula');

/**
 * The offtaker's own view: the harvests it has agreed to buy, each load weighed and graded
 * for it (to confirm or dispute), and what it has paid and owes.
 */
export function BuyerPortalPage() {
  const portal = useAsync(async () => {
    const { data, error } = await supabase.rpc('offtaker_portal');
    if (error) throw error;
    return data as { offtaker: { name: string } | null; contracts: Agreement[] };
  }, []);

  if (portal.loading && !portal.data) return <PageSkeleton variant="detail" />;
  if (portal.error) return <Alert>{errorMessage(portal.error)}</Alert>;
  const { offtaker, contracts } = portal.data!;

  if (!offtaker) {
    return (
      <EmptyState icon={<Handshake />} title="Your account isn't linked to a buyer yet">
        Ask an Agrowth admin to link this sign-in to your company on the Users page.
      </EmptyState>
    );
  }

  const contracted = contracts.reduce((s, c) => s + Number(c.volume_tonnes) * 1000, 0);
  const accepted = contracts.reduce((s, c) => s + c.accepted_kg, 0);
  const paid = contracts.reduce((s, c) => s + toKobo(c.paid_kobo), 0n);
  const owed = contracts.reduce(
    (s, c) =>
      s +
      (c.value_kobo && toKobo(c.value_kobo) > toKobo(c.paid_kobo)
        ? toKobo(c.value_kobo) - toKobo(c.paid_kobo)
        : 0n),
    0n,
  );
  const toConfirm = contracts
    .flatMap((c) => c.deliveries)
    .filter((d) => !d.voided && !d.confirmed_at).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Buyer portal"
        title={offtaker.name}
        description="The harvests you've agreed to buy through Agrowth. Check each load as it's weighed and graded for you, and confirm it or say what's wrong."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Handshake />}
          label="Contracted"
          value={tonnes(contracted)}
          sub={`${contracts.length} agreement(s)`}
        />
        <Stat
          icon={<Truck />}
          tone="blue"
          label="Delivered and accepted"
          value={tonnes(accepted)}
          sub={toConfirm ? `${toConfirm} load(s) for you to confirm` : 'Every load confirmed'}
        />
        <Stat
          icon={<Wallet />}
          tone="violet"
          label="Paid"
          value={formatNaira(paid, { compact: true })}
        />
        <Stat
          icon={<Scale />}
          tone="amber"
          label="Still to pay (estimate)"
          value={formatNaira(owed, { compact: true })}
          sub="Accepted tonnes at the agreed or floor price"
        />
      </div>

      {contracts.length === 0 ? (
        <EmptyState icon={<Handshake />}>No agreements yet.</EmptyState>
      ) : (
        contracts.map((c) => <AgreementCard key={c.id} agreement={c} onChange={portal.reload} />)
      )}
    </div>
  );
}

function AgreementCard({ agreement: a, onChange }: { agreement: Agreement; onChange: () => void }) {
  const volumeKg = Number(a.volume_tonnes) * 1000;
  const owed = a.value_kobo ? toKobo(a.value_kobo) - toKobo(a.paid_kobo) : null;
  const toConfirm = a.deliveries.filter((d) => !d.voided && !d.confirmed_at).length;
  return (
    <Card>
      <SectionTitle
        title={`${titleCase(a.crop)} · ${a.season}`}
        description={[a.cooperative, a.lga && a.state ? `${a.lga}, ${a.state}` : null, a.cycle_code]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {toConfirm > 0 && <Badge tone="amber">{toConfirm} to confirm</Badge>}
            <CycleStatusBadge status={a.cycle_status} />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <DescriptionList
          items={[
            [
              'Agreed volume',
              `${Number(a.volume_tonnes).toLocaleString('en-NG')} t of ${a.commodity}`,
            ],
            ['Price', price(a)],
            [
              'Delivery window',
              a.delivery_window_start
                ? `${formatDate(a.delivery_window_start)} – ${formatDate(a.delivery_window_end)}`
                : `Harvest expected ${formatDate(a.expected_harvest_date)}`,
            ],
            ['Paid', formatNaira(a.paid_kobo)],
            ...(owed !== null
              ? ([['Still to pay (estimate)', owed > 0n ? formatNaira(owed) : 'Nothing']] as [
                  string,
                  string,
                ][])
              : []),
          ]}
        />
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-zinc-600">Delivered and accepted</span>
            <span className="font-medium text-zinc-900 tabular-nums">
              {tonnes(a.accepted_kg)} of {Number(a.volume_tonnes).toLocaleString('en-NG')} t
            </span>
          </div>
          <Progress value={volumeKg > 0 ? a.accepted_kg / volumeKg : 0} />
          {a.rejected_kg > 0 && (
            <p className="mt-2 text-xs text-zinc-500">{tonnes(a.rejected_kg)} rejected on grade.</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        {a.deliveries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No loads yet. They appear here as they're weighed and graded for you.
          </p>
        ) : (
          <Table head={['Delivered', 'Farm', 'Waybill', 'Weight', 'Grade', 'Your confirmation']}>
            {a.deliveries.map((d) => (
              <tr key={d.id} className={d.voided ? 'opacity-50' : undefined}>
                <td className="whitespace-nowrap text-zinc-600">{formatDate(d.delivered_on)}</td>
                <td className="font-medium text-zinc-900">{d.farm}</td>
                <td className="font-mono text-xs text-zinc-600">{d.waybill_reference}</td>
                <td className="whitespace-nowrap tabular-nums">
                  {d.weight_kg.toLocaleString('en-NG')} kg
                  {d.moisture_pct !== null && (
                    <span className="block text-xs text-zinc-500">{d.moisture_pct}% moisture</span>
                  )}
                </td>
                <td>
                  <Badge tone={HARVEST_GRADE[d.grade].tone}>{HARVEST_GRADE[d.grade].label}</Badge>
                </td>
                <td className="min-w-56">
                  <LoadAnswer load={d} onChange={onChange} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

/** The buyer's answer on a load: confirmed, disputed (and still open), or the buttons. */
function LoadAnswer({ load: d, onChange }: { load: Load; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (d.voided) {
    return <span className="text-xs text-zinc-500">Voided: {d.void_reason}</span>;
  }
  if (d.confirmed_at) {
    return (
      <>
        <Badge tone="green" dot>
          Confirmed
        </Badge>
        <span className="mt-1 block text-xs text-zinc-500">{formatDate(d.confirmed_at)}</span>
      </>
    );
  }

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('confirm_harvest_delivery', { p_delivery_id: d.id });
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else {
      toast.success(`Load ${d.waybill_reference} confirmed`);
      onChange();
    }
  };
  const dispute = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('dispute_harvest_delivery', {
      p_delivery_id: d.id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else {
      toast.success(`Load ${d.waybill_reference} disputed; the field team will check it`);
      setDisputing(false);
      onChange();
    }
  };

  return (
    <>
      {d.disputed_at && (
        <div className="mb-2">
          <Badge tone="red" dot>
            Disputed
          </Badge>
          <span className="mt-1 block text-xs text-zinc-500">{d.dispute}</span>
        </div>
      )}
      <span className="inline-flex flex-wrap gap-2">
        <Button size="sm" busy={busy && !disputing} onClick={confirm}>
          <CheckCircle2 aria-hidden /> {d.disputed_at ? 'Confirm after all' : 'Confirm'}
        </Button>
        {!d.disputed_at && (
          <Button size="sm" variant="ghost" onClick={() => setDisputing(true)}>
            Dispute
          </Button>
        )}
      </span>
      <Modal
        open={disputing}
        onClose={() => setDisputing(false)}
        title={`Dispute load ${d.waybill_reference}`}
        description={`${d.weight_kg.toLocaleString('en-NG')} kg, ${HARVEST_GRADE[d.grade].label}, from ${d.farm} on ${formatDate(d.delivered_on)}. The field team sees your reason and re-records the load if you're right.`}
      >
        <div className="space-y-4">
          <Field label="What's wrong with it?">
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Our weighbridge ticket shows 2,360 kg; or: grade B, not A, at our lab"
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDisputing(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={reason.trim().length < 5}
              onClick={dispute}
            >
              Dispute the load
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
