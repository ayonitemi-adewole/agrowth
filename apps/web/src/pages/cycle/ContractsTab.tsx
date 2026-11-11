import {
  FileCheck2,
  FileText,
  Handshake,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Select,
  Textarea,
} from '../../components/ui';
import { openFile, uploadFile } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { formatDate, titleCase } from '../../lib/format';
import { formatNaira, nairaInput, parseNaira } from '../../lib/money';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { InsuranceCover, InsurancePolicy, OfftakeContract, PriceTerms } from '../../lib/types';
import { ClaimsSection } from './ClaimsSection';
import type { TabProps } from './useCycleData';

const BUCKET = 'cycle-documents';

export function ContractsTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const editable = data.cycle.status === 'draft' && can.manageCycles(role);
  const [offtake, setOfftake] = useState<OfftakeContract | 'new' | null>(null);
  const [policy, setPolicy] = useState<InsurancePolicy | 'new' | null>(null);

  const remove = async (table: string, id: string) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) toast.error(errorMessage(error));
    else reload();
  };

  const minVolume = Math.round(data.cycle.yield_low_t_per_ha * data.hectares * 1000) / 1000;
  const contracted = data.offtake
    .filter((o) => o.document_path && o.signed_on)
    .reduce((s, o) => s + Number(o.volume_tonnes), 0);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section>
        <SectionTitle
          title="Offtake agreements"
          description={`A signed buyer must cover at least the low-yield harvest: ${minVolume} t. Signed so far: ${contracted} t.`}
          actions={
            editable && (
              <Button size="sm" onClick={() => setOfftake('new')}>
                <Plus aria-hidden /> Add agreement
              </Button>
            )
          }
        />
        {data.offtake.length === 0 ? (
          <EmptyState icon={<Handshake />} title="No buyer yet">
            Offtake first: a cycle can't open for funding until a buyer has signed.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {data.offtake.map((o) => (
              <Card key={o.id}>
                <Header
                  title={o.buyer_name}
                  badge={
                    o.status === 'approved' ? (
                      <Badge tone="green" dot>
                        Approved
                      </Badge>
                    ) : o.document_path && o.signed_on ? (
                      <Badge tone="blue" dot>
                        Signed
                      </Badge>
                    ) : (
                      <Badge tone="amber" dot>
                        Not signed
                      </Badge>
                    )
                  }
                  onEdit={editable ? () => setOfftake(o) : undefined}
                  onDelete={editable ? () => remove('offtake_contracts', o.id) : undefined}
                />
                <DescriptionList
                  items={[
                    ['Commodity', `${titleCase(o.commodity)} · ${o.volume_tonnes} t`],
                    ['Price', priceText(o)],
                    [
                      'Delivery',
                      o.delivery_window_start
                        ? `${formatDate(o.delivery_window_start)} – ${formatDate(o.delivery_window_end)}`
                        : '—',
                    ],
                    ['Signed', formatDate(o.signed_on)],
                  ]}
                />
                <DocumentLink path={o.document_path} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title="Insurance"
          description="Area-yield or weather-index cover, with the trustee as loss payee, for at least the cycle's budget."
          actions={
            editable && (
              <Button size="sm" onClick={() => setPolicy('new')}>
                <Plus aria-hidden /> Add policy
              </Button>
            )
          }
        />
        {data.insurance.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="Not insured yet">
            Every funded cycle carries insurance so a bad season doesn't land entirely on funders.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {data.insurance.map((p) => (
              <Card key={p.id}>
                <Header
                  title={p.insurer_name}
                  badge={
                    p.document_path ? (
                      <Badge tone="green" dot>
                        Bound
                      </Badge>
                    ) : (
                      <Badge tone="amber" dot>
                        No document
                      </Badge>
                    )
                  }
                  onEdit={editable ? () => setPolicy(p) : undefined}
                  onDelete={editable ? () => remove('insurance_policies', p.id) : undefined}
                />
                <DescriptionList
                  items={[
                    ['Policy', `${p.policy_number} · ${titleCase(p.cover_type)}`],
                    ['Sum insured', formatNaira(p.sum_insured_kobo)],
                    ['Premium', formatNaira(p.premium_kobo)],
                    ['Cover', `${formatDate(p.cover_start)} – ${formatDate(p.cover_end)}`],
                    ['Loss payee', p.loss_payee],
                  ]}
                />
                <DocumentLink path={p.document_path} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <ClaimsSection data={data} reload={reload} />

      <Modal
        open={offtake !== null}
        onClose={() => setOfftake(null)}
        title="Offtake agreement"
        wide
      >
        {offtake !== null && (
          <OfftakeForm
            cycleId={data.cycle.id}
            crop={data.cycle.crop}
            contract={offtake === 'new' ? undefined : offtake}
            onDone={(saved) => {
              setOfftake(null);
              if (saved) reload();
            }}
          />
        )}
      </Modal>
      <Modal open={policy !== null} onClose={() => setPolicy(null)} title="Insurance policy" wide>
        {policy !== null && (
          <PolicyForm
            cycleId={data.cycle.id}
            defaults={{
              start: data.cycle.start_date,
              end: data.cycle.expected_harvest_date,
              sum: data.cycle.target_amount_kobo,
            }}
            policy={policy === 'new' ? undefined : policy}
            onDone={(saved) => {
              setPolicy(null);
              if (saved) reload();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function priceText(o: OfftakeContract) {
  if (o.price_terms === 'fixed') return `Fixed ${formatNaira(o.price_per_tonne_kobo)}/t`;
  if (o.price_terms === 'floor')
    return `Market, floor ${formatNaira(o.price_floor_per_tonne_kobo)}/t`;
  return o.price_formula ?? 'Formula';
}

function Header({
  title,
  badge,
  onEdit,
  onDelete,
}: {
  title: string;
  badge: ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-zinc-950">{title}</p>
        {badge}
      </div>
      <div className="flex gap-1.5">
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit" title="Edit">
            <Pencil aria-hidden />
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Delete" title="Delete">
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function DocumentLink({ path }: { path: string | null }) {
  const toast = useToast();
  if (!path) return null;
  return (
    <button
      onClick={() => openFile(BUCKET, path).catch((e) => toast.error(errorMessage(e)))}
      className="mt-4 flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand-800"
    >
      <FileText className="size-4" aria-hidden /> View signed document
    </button>
  );
}

/** Pick a file; it's uploaded when the form is saved. */
function FilePicker({
  file,
  existing,
  onChange,
}: {
  file: File | null;
  existing: string | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm hover:border-brand-400 hover:bg-brand-50/40">
      {file || existing ? (
        <FileCheck2 className="size-5 text-brand-600" aria-hidden />
      ) : (
        <Upload className="size-5 text-zinc-400" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-zinc-700">
        {file
          ? file.name
          : existing
            ? 'Document uploaded — choose a file to replace it'
            : 'Upload the signed PDF or photo'}
      </span>
      <input
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function OfftakeForm({
  cycleId,
  crop,
  contract,
  onDone,
}: {
  cycleId: string;
  crop: string;
  contract?: OfftakeContract;
  onDone: (saved: boolean) => void;
}) {
  const [form, setForm] = useState({
    buyer_name: contract?.buyer_name ?? '',
    buyer_contact: contract?.buyer_contact ?? '',
    commodity: contract?.commodity ?? crop,
    volume_tonnes: contract?.volume_tonnes?.toString() ?? '',
    price_terms: (contract?.price_terms ?? 'floor') as PriceTerms,
    price: nairaInput(
      contract?.price_terms === 'fixed'
        ? contract.price_per_tonne_kobo
        : contract?.price_floor_per_tonne_kobo,
    ),
    price_formula: contract?.price_formula ?? '',
    delivery_window_start: contract?.delivery_window_start ?? '',
    delivery_window_end: contract?.delivery_window_end ?? '',
    signed_on: contract?.signed_on ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const price = form.price_terms === 'formula' ? null : parseNaira(form.price);
    if (form.price_terms !== 'formula' && price === null) {
      setError('Enter the price per tonne in naira');
      return;
    }
    setBusy(true);
    try {
      const document_path = file
        ? await uploadFile(BUCKET, cycleId, file)
        : (contract?.document_path ?? null);
      const row = {
        buyer_name: form.buyer_name.trim(),
        buyer_contact: form.buyer_contact.trim() || null,
        commodity: form.commodity.trim().toLowerCase(),
        volume_tonnes: Number(form.volume_tonnes),
        price_terms: form.price_terms,
        price_per_tonne_kobo: form.price_terms === 'fixed' ? price!.toString() : null,
        price_floor_per_tonne_kobo: form.price_terms === 'floor' ? price!.toString() : null,
        price_formula: form.price_terms === 'formula' ? form.price_formula.trim() : null,
        delivery_window_start: form.delivery_window_start || null,
        delivery_window_end: form.delivery_window_end || null,
        signed_on: form.signed_on || null,
        document_path,
      };
      const { error } = contract
        ? await supabase.from('offtake_contracts').update(row).eq('id', contract.id)
        : await supabase.from('offtake_contracts').insert({ ...row, cycle_id: cycleId });
      if (error) throw error;
      onDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Buyer">
          <Input
            value={form.buyer_name}
            onChange={set('buyer_name')}
            required
            maxLength={200}
            placeholder="Northern Mills Ltd"
          />
        </Field>
        <Field label="Buyer contact" hint="Optional">
          <Input value={form.buyer_contact} onChange={set('buyer_contact')} maxLength={200} />
        </Field>
        <Field label="Commodity">
          <Input value={form.commodity} onChange={set('commodity')} required maxLength={60} />
        </Field>
        <Field label="Volume (tonnes)">
          <Input
            type="number"
            step="0.001"
            min="0.001"
            value={form.volume_tonnes}
            onChange={set('volume_tonnes')}
            required
          />
        </Field>
        <Field label="Price terms">
          <Select value={form.price_terms} onChange={set('price_terms')}>
            <option value="floor">Market price with a floor</option>
            <option value="fixed">Fixed price</option>
            <option value="formula">Formula</option>
          </Select>
        </Field>
        {form.price_terms === 'formula' ? (
          <Field label="Formula">
            <Textarea
              rows={2}
              value={form.price_formula}
              onChange={set('price_formula')}
              required
            />
          </Field>
        ) : (
          <Field
            label={
              form.price_terms === 'fixed' ? 'Price per tonne (₦)' : 'Floor price per tonne (₦)'
            }
          >
            <Input value={form.price} onChange={set('price')} required inputMode="decimal" />
          </Field>
        )}
        <Field label="Delivery from">
          <Input
            type="date"
            value={form.delivery_window_start}
            onChange={set('delivery_window_start')}
          />
        </Field>
        <Field label="Delivery until">
          <Input
            type="date"
            value={form.delivery_window_end}
            onChange={set('delivery_window_end')}
          />
        </Field>
        <Field label="Signed on" hint="Leave empty until the buyer has signed">
          <Input type="date" value={form.signed_on} onChange={set('signed_on')} />
        </Field>
      </div>
      <FilePicker file={file} existing={contract?.document_path ?? null} onChange={setFile} />
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Save agreement
        </Button>
      </div>
    </form>
  );
}

function PolicyForm({
  cycleId,
  policy,
  defaults,
  onDone,
}: {
  cycleId: string;
  policy?: InsurancePolicy;
  defaults: { start: string | null; end: string | null; sum: number | string };
  onDone: (saved: boolean) => void;
}) {
  const [form, setForm] = useState({
    insurer_name: policy?.insurer_name ?? '',
    policy_number: policy?.policy_number ?? '',
    cover_type: (policy?.cover_type ?? 'area_yield') as InsuranceCover,
    sum_insured: nairaInput(policy?.sum_insured_kobo ?? defaults.sum),
    premium: nairaInput(policy?.premium_kobo),
    loss_payee: policy?.loss_payee ?? 'Trustee, on behalf of the cycle funders',
    cover_start: policy?.cover_start ?? defaults.start ?? '',
    cover_end: policy?.cover_end ?? defaults.end ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const sum = parseNaira(form.sum_insured);
    const premium = parseNaira(form.premium);
    if (sum === null || premium === null) {
      setError('Enter the sum insured and premium in naira');
      return;
    }
    setBusy(true);
    try {
      const document_path = file
        ? await uploadFile(BUCKET, cycleId, file)
        : (policy?.document_path ?? null);
      const row = {
        insurer_name: form.insurer_name.trim(),
        policy_number: form.policy_number.trim(),
        cover_type: form.cover_type,
        sum_insured_kobo: sum.toString(),
        premium_kobo: premium.toString(),
        loss_payee: form.loss_payee.trim(),
        cover_start: form.cover_start,
        cover_end: form.cover_end,
        document_path,
      };
      const { error } = policy
        ? await supabase.from('insurance_policies').update(row).eq('id', policy.id)
        : await supabase.from('insurance_policies').insert({ ...row, cycle_id: cycleId });
      if (error) throw error;
      onDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Insurer">
          <Input
            value={form.insurer_name}
            onChange={set('insurer_name')}
            required
            maxLength={200}
          />
        </Field>
        <Field label="Policy number">
          <Input
            value={form.policy_number}
            onChange={set('policy_number')}
            required
            maxLength={100}
          />
        </Field>
        <Field label="Cover type">
          <Select value={form.cover_type} onChange={set('cover_type')}>
            <option value="area_yield">Area yield</option>
            <option value="weather_index">Weather index</option>
            <option value="multi_peril">Multi-peril</option>
          </Select>
        </Field>
        <Field label="Loss payee">
          <Input value={form.loss_payee} onChange={set('loss_payee')} required maxLength={200} />
        </Field>
        <Field label="Sum insured (₦)">
          <Input
            value={form.sum_insured}
            onChange={set('sum_insured')}
            required
            inputMode="decimal"
          />
        </Field>
        <Field label="Premium (₦)">
          <Input value={form.premium} onChange={set('premium')} required inputMode="decimal" />
        </Field>
        <Field label="Cover starts">
          <Input type="date" value={form.cover_start} onChange={set('cover_start')} required />
        </Field>
        <Field label="Cover ends">
          <Input type="date" value={form.cover_end} onChange={set('cover_end')} required />
        </Field>
      </div>
      <FilePicker file={file} existing={policy?.document_path ?? null} onChange={setFile} />
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Save policy
        </Button>
      </div>
    </form>
  );
}
