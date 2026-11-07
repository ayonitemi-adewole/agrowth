import { CheckCircle2, Plus, Scale, Truck, Undo2, Wheat } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Progress,
  SectionTitle,
  Select,
  Stat,
  Table,
  Textarea,
} from '../../components/ui';
import { HARVEST_GRADE, formatTonnes, isoDate } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { HarvestDelivery, HarvestGrade } from '../../lib/types';
import type { TabProps } from './useCycleData';

/** Deliveries that count: not voided, not rejected by the offtaker. */
export const acceptedKg = (deliveries: HarvestDelivery[]) =>
  deliveries
    .filter((d) => !d.voided_at && d.grade !== 'rejected')
    .reduce((sum, d) => sum + d.weight_kg, 0);

export function HarvestTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const { cycle, farms, deliveries, offtake } = data;
  const accepted = acceptedKg(deliveries);
  const contractKg = offtake.reduce((s, o) => s + Number(o.volume_tonnes) * 1000, 0);
  const lowKg = Number(cycle.yield_low_t_per_ha) * data.hectares * 1000;
  const highKg = Number(cycle.yield_high_t_per_ha) * data.hectares * 1000;
  const open = cycle.status === 'in_progress';

  const perFarm = farms.map((f) => {
    const kg = acceptedKg(deliveries.filter((d) => d.farm_id === f.id));
    return { farm: f, kg, perHa: kg / 1000 / Number(f.area_hectares) };
  });

  return (
    <div className="space-y-6">
      {(open || cycle.status === 'harvested') && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">
            {open
              ? 'Record each load as the offtaker weighs and grades it. Rejected loads are kept for the record but earn nothing.'
              : `Harvest closed on ${formatDate(cycle.harvest_completed_at)}.`}
          </p>
          {open && (
            <div className="flex flex-wrap gap-2">
              {can.manageCycles(role) && <CompleteHarvestButton data={data} reload={reload} />}
              {can.recordHarvest(role) && <RecordDeliveryButton data={data} reload={reload} />}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<Scale />}
          label="Accepted by the offtaker"
          value={formatTonnes(accepted)}
          sub={contractKg > 0 ? `of ${formatTonnes(contractKg)} contracted` : undefined}
        />
        <Stat
          icon={<Wheat />}
          tone="amber"
          label="Yield"
          value={
            data.hectares > 0
              ? `${(accepted / 1000 / data.hectares).toLocaleString('en-NG', { maximumFractionDigits: 2 })} t/ha`
              : '—'
          }
          sub={`Planned ${cycle.yield_low_t_per_ha}–${cycle.yield_high_t_per_ha} t/ha (${formatTonnes(lowKg)}–${formatTonnes(highKg)})`}
        />
        <Stat
          icon={<Truck />}
          tone="blue"
          label="Loads delivered"
          value={deliveries.filter((d) => !d.voided_at).length}
          sub={`${deliveries.filter((d) => d.grade === 'rejected' && !d.voided_at).length} rejected`}
        />
      </div>
      {contractKg > 0 && <Progress value={Math.min(1, accepted / contractKg)} className="h-2.5" />}

      <Card padded={false}>
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          <SectionTitle
            title="By farm"
            description="Farmers share any surplus in proportion to the kilograms they deliver."
          />
        </div>
        <div className="border-t border-zinc-950/5">
          <Table head={['Farm', 'Farmer', 'Hectares', 'Accepted', 'Yield']}>
            {perFarm.map(({ farm, kg, perHa }) => (
              <tr key={farm.id}>
                <td className="font-medium text-zinc-900">{farm.name ?? 'Farm'}</td>
                <td className="text-zinc-600">{farm.farmer_name}</td>
                <td className="text-zinc-600 tabular-nums">
                  {Number(farm.area_hectares).toFixed(2)}
                </td>
                <td className="font-medium text-zinc-900 tabular-nums">{formatTonnes(kg)}</td>
                <td className="text-zinc-600 tabular-nums">
                  {kg > 0 ? `${perHa.toFixed(2)} t/ha` : '—'}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      {deliveries.length === 0 ? (
        <EmptyState icon={<Truck />} title="No deliveries yet">
          {open
            ? 'Deliveries appear here as loads reach the offtaker.'
            : 'Deliveries are recorded once the season is under way.'}
        </EmptyState>
      ) : (
        <Table head={['Delivered', 'Farm', 'Waybill', 'Weight', 'Grade', 'Moisture', '']}>
          {deliveries.map((d) => {
            const farm = farms.find((f) => f.id === d.farm_id);
            return (
              <tr key={d.id} className={d.voided_at ? 'opacity-50' : undefined}>
                <td className="text-zinc-600">{formatDate(d.delivered_on)}</td>
                <td>
                  <span className="font-medium text-zinc-900">{farm?.name ?? 'Farm'}</span>
                  <span className="block text-xs text-zinc-500">{farm?.farmer_name}</span>
                </td>
                <td className="font-mono text-xs text-zinc-600">{d.waybill_reference}</td>
                <td className="font-medium text-zinc-900 tabular-nums">
                  {d.weight_kg.toLocaleString('en-NG')} kg
                </td>
                <td>
                  <Badge tone={HARVEST_GRADE[d.grade].tone}>{HARVEST_GRADE[d.grade].label}</Badge>
                </td>
                <td className="text-zinc-600 tabular-nums">
                  {d.moisture_pct !== null ? `${d.moisture_pct}%` : '—'}
                </td>
                <td className="text-right">
                  {d.voided_at ? (
                    <span className="text-xs text-zinc-500" title={d.void_reason ?? undefined}>
                      Voided: {d.void_reason}
                    </span>
                  ) : (
                    open &&
                    can.recordHarvest(role) && <VoidDeliveryButton delivery={d} reload={reload} />
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

function RecordDeliveryButton({ data, reload }: TabProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const blank = {
    farm_id: data.farms[0]?.id ?? '',
    contract_id: data.offtake[0]?.id ?? '',
    delivered_on: isoDate(),
    weight_kg: '',
    grade: 'grade_a' as HarvestGrade,
    moisture: '',
    waybill: '',
    notes: '',
  };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const kg = Number(form.weight_kg.replace(/[,\s]/g, ''));
    if (!Number.isInteger(kg) || kg <= 0) {
      setError('Enter the weight as a whole number of kilograms');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('record_harvest_delivery', {
      p_cycle_id: data.cycle.id,
      p_farm_id: form.farm_id,
      p_offtake_contract_id: form.contract_id,
      p_delivered_on: form.delivered_on,
      p_weight_kg: kg,
      p_grade: form.grade,
      p_waybill_reference: form.waybill,
      p_moisture_pct: form.moisture ? Number(form.moisture) : null,
      p_notes: form.notes || null,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`${kg.toLocaleString('en-NG')} kg recorded`);
    setOpen(false);
    // Keep the farm and contract: loads usually come in runs from the same place.
    setForm({ ...blank, farm_id: form.farm_id, contract_id: form.contract_id });
    reload();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Record delivery
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a delivery"
        description="One load, as weighed and graded at the offtaker's weighbridge."
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Farm">
              <Select value={form.farm_id} onChange={set('farm_id')} required>
                {data.farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name ?? 'Farm'} · {f.farmer_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Offtake agreement">
              <Select value={form.contract_id} onChange={set('contract_id')} required>
                {data.offtake.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.buyer_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Weight (kg)">
              <Input
                value={form.weight_kg}
                onChange={set('weight_kg')}
                required
                inputMode="numeric"
                autoFocus
              />
            </Field>
            <Field label="Grade">
              <Select value={form.grade} onChange={set('grade')}>
                {Object.entries(HARVEST_GRADE).map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moisture (%)" hint="Optional">
              <Input
                value={form.moisture}
                onChange={set('moisture')}
                inputMode="decimal"
                type="number"
                min={0}
                max={100}
                step={0.1}
              />
            </Field>
            <Field label="Delivered on">
              <Input
                type="date"
                max={isoDate()}
                value={form.delivered_on}
                onChange={set('delivered_on')}
                required
              />
            </Field>
            <Field label="Waybill or weighbridge ticket" className="sm:col-span-2">
              <Input value={form.waybill} onChange={set('waybill')} required maxLength={120} />
            </Field>
            <Field label="Notes" hint="Optional" className="sm:col-span-2">
              <Textarea value={form.notes} onChange={set('notes')} rows={2} maxLength={1000} />
            </Field>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" busy={busy}>
              Record delivery
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function VoidDeliveryButton({
  delivery,
  reload,
}: {
  delivery: HarvestDelivery;
  reload: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('void_harvest_delivery', {
      p_delivery_id: delivery.id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success(`Waybill ${delivery.waybill_reference} voided`);
    setOpen(false);
    reload();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden /> Void
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Void waybill ${delivery.waybill_reference}?`}
        description="The entry stays in the record, marked void, and stops counting towards the harvest."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Reason">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="e.g. Weighed twice"
              autoFocus
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" busy={busy}>
              Void delivery
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function CompleteHarvestButton({ data, reload }: TabProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unreleased = data.milestones.filter((m) => m.status !== 'released');
  const accepted = acceptedKg(data.deliveries);

  const complete = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('complete_harvest', { p_cycle_id: data.cycle.id });
    setBusy(false);
    if (error) {
      setError(errorMessage(error));
      return;
    }
    toast.success('Harvest complete. The trustee can now settle the cycle.');
    setOpen(false);
    reload();
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden /> Complete harvest
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Close the harvest?"
        description="No more deliveries can be recorded afterwards. The trustee then records the offtaker's payment and settles the cycle."
      >
        <div className="space-y-4">
          {unreleased.length > 0 ? (
            <Alert tone="warning">
              Release every milestone first. Still open:{' '}
              {unreleased.map((m) => `${m.sequence}. ${m.name}`).join(', ')}.
            </Alert>
          ) : (
            <p className="text-sm text-zinc-600">
              {formatTonnes(accepted)} accepted by the offtaker from{' '}
              {data.deliveries.filter((d) => !d.voided_at).length} load(s).
              {accepted === 0 &&
                ' With nothing delivered, any insurance payout goes to the funders.'}
            </p>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button busy={busy} disabled={unreleased.length > 0} onClick={complete}>
              Complete harvest
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
