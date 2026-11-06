import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '../../components/Toast';
import { Alert, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { isoDate } from '../../lib/cycles';
import { errorMessage } from '../../lib/errors';
import { nairaInput, parseNaira } from '../../lib/money';
import { PROGRAMME_KIND, REPAYMENT_MODE } from '../../lib/programmes';
import { supabase } from '../../lib/supabase';
import type { Programme, ProgrammeKind, RepaymentMode } from '../../lib/types';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Creates a draft programme, or edits a draft's terms. */
export function ProgrammeForm({
  programme,
  onDone,
}: {
  programme?: Programme;
  onDone: (saved: boolean) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    code: programme?.code ?? '',
    name: programme?.name ?? '',
    sponsor: programme?.sponsor ?? '',
    description: programme?.description ?? '',
    kind: (programme?.kind ?? 'input_loan') as ProgrammeKind,
    budget: nairaInput(programme?.budget_kobo),
    commodities: programme?.commodities.join(', ') ?? '',
    target_states: programme?.target_states.join(', ') ?? '',
    target_lgas: programme?.target_lgas.join(', ') ?? '',
    max_hectares: programme?.max_hectares_per_farmer?.toString() ?? '',
    require_cooperative: programme?.require_cooperative ?? true,
    input_package: programme?.input_package ?? '',
    max_per_ha: nairaInput(programme?.max_budget_per_ha_kobo),
    repayment_pct: programme ? String(programme.repayment_bps / 100) : '100',
    repayment_mode: (programme?.repayment_mode ?? 'produce') as RepaymentMode,
    starts_on: programme?.starts_on ?? isoDate(),
    ends_on: programme?.ends_on ?? isoDate(365),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const budget = parseNaira(form.budget);
    if (!budget) {
      setError('Enter the budget in naira');
      return;
    }
    const perHa = form.max_per_ha.trim() ? parseNaira(form.max_per_ha) : null;
    if (form.max_per_ha.trim() && !perHa) {
      setError('Enter the input package value per hectare in naira');
      return;
    }
    const repayment = form.kind === 'grant' ? 0 : Math.round(Number(form.repayment_pct) * 100);
    if (!Number.isFinite(repayment) || repayment < 0 || repayment > 10_000) {
      setError('Repayment must be a percentage between 0 and 100');
      return;
    }
    const row = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      sponsor: form.sponsor.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      budget_kobo: budget.toString(),
      commodities: list(form.commodities),
      target_states: list(form.target_states),
      target_lgas: list(form.target_lgas),
      max_hectares_per_farmer: form.max_hectares.trim() ? Number(form.max_hectares) : null,
      require_cooperative: form.require_cooperative,
      input_package: form.input_package.trim() || null,
      max_budget_per_ha_kobo: perHa?.toString() ?? null,
      repayment_bps: repayment,
      repayment_mode: form.repayment_mode,
      starts_on: form.starts_on,
      ends_on: form.ends_on,
    };
    setBusy(true);
    const result = programme
      ? await supabase.from('programmes').update(row).eq('id', programme.id).select('id').single()
      : await supabase.from('programmes').insert(row).select('id').single();
    setBusy(false);
    if (result.error) {
      setError(errorMessage(result.error));
      return;
    }
    toast.success(programme ? 'Programme saved' : 'Programme drafted');
    onDone(true);
    if (!programme) navigate(`/programmes/${result.data.id}`);
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
          Programme
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={set('name')}
              required
              maxLength={200}
              placeholder="Kano Wheat Input Credit Programme"
            />
          </Field>
          <Field label="Code" hint="Letters, numbers and dashes">
            <Input
              value={form.code}
              onChange={set('code')}
              required
              maxLength={40}
              pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,39}"
              placeholder="KN-WHEAT-ICP-27"
            />
          </Field>
          <Field label="Sponsor" hint="The ministry, agency or donor" className="sm:col-span-2">
            <Input
              value={form.sponsor}
              onChange={set('sponsor')}
              required
              maxLength={200}
              placeholder="Kano State Ministry of Agriculture"
            />
          </Field>
          <Field label="Budget (₦)">
            <Input value={form.budget} onChange={set('budget')} required inputMode="decimal" />
          </Field>
          <Field label="Starts">
            <Input type="date" value={form.starts_on} onChange={set('starts_on')} required />
          </Field>
          <Field label="Ends">
            <Input type="date" value={form.ends_on} onChange={set('ends_on')} required />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} value={form.description} onChange={set('description')} />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
          Who and what it funds
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Commodities" hint="Separated by commas, e.g. wheat, rice">
            <Input value={form.commodities} onChange={set('commodities')} required />
          </Field>
          <Field label="Target states" hint="Separated by commas">
            <Input value={form.target_states} onChange={set('target_states')} required />
          </Field>
          <Field label="Target LGAs" hint="Leave empty for every LGA in the target states">
            <Input value={form.target_lgas} onChange={set('target_lgas')} />
          </Field>
          <Field label="Most hectares per farmer" hint="Leave empty for no limit">
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={form.max_hectares}
              onChange={set('max_hectares')}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-zinc-800">
          <input
            type="checkbox"
            checked={form.require_cooperative}
            onChange={(e) => setForm((f) => ({ ...f, require_cooperative: e.target.checked }))}
            className="size-4 rounded border-zinc-300 text-brand-600"
          />
          Farmers must belong to a registered cooperative
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
          Input package and terms
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Input package" hint="What each hectare receives" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.input_package}
              onChange={set('input_package')}
              placeholder="120 kg certified seed, 4 bags NPK, 2 bags urea, herbicide and ploughing per hectare"
            />
          </Field>
          <Field
            label="Package value per hectare (₦)"
            hint="A cycle's budget per hectare can't be higher"
          >
            <Input value={form.max_per_ha} onChange={set('max_per_ha')} inputMode="decimal" />
          </Field>
          <Field label="Type">
            <Select value={form.kind} onChange={set('kind')}>
              {(Object.keys(PROGRAMME_KIND) as ProgrammeKind[]).map((k) => (
                <option key={k} value={k}>
                  {PROGRAMME_KIND[k]}
                </option>
              ))}
            </Select>
          </Field>
          {form.kind === 'input_loan' && (
            <>
              <Field
                label="Repaid (% of programme money)"
                hint="Farmers repay this share from the harvest sale"
              >
                <Input
                  type="number"
                  min={1}
                  max={100}
                  step={0.01}
                  value={form.repayment_pct}
                  onChange={set('repayment_pct')}
                  required
                />
              </Field>
              <Field label="Repaid">
                <Select value={form.repayment_mode} onChange={set('repayment_mode')}>
                  {(Object.keys(REPAYMENT_MODE) as RepaymentMode[]).map((k) => (
                    <option key={k} value={k}>
                      {REPAYMENT_MODE[k]}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>
      </fieldset>

      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {programme ? 'Save programme' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}
