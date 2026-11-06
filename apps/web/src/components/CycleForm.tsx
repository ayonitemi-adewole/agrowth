import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { FUNDING_SOURCE, isoDate } from '../lib/cycles';
import { errorMessage } from '../lib/errors';
import { nairaInput, parseNaira } from '../lib/money';
import { supabase } from '../lib/supabase';
import type { Cooperative, Cycle, FundingSource, Programme } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useToast } from './Toast';
import { Alert, Button, Field, Input, Select, Textarea } from './ui';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/** Creates a draft cycle, or edits an existing draft's basics. */
export function CycleForm({ cycle, onDone }: { cycle?: Cycle; onDone: (saved: boolean) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    code: cycle?.code ?? '',
    crop: cycle?.crop ?? '',
    season: cycle?.season ?? '',
    funding_source: (cycle?.funding_source ?? 'investor') as FundingSource,
    cooperative_id: cycle?.cooperative_id ?? '',
    programme_id: cycle?.programme_id ?? '',
    target: nairaInput(cycle?.target_amount_kobo),
    budget_per_ha: nairaInput(cycle?.budget_per_hectare_kobo),
    yield_low: cycle?.yield_low_t_per_ha?.toString() ?? '',
    yield_expected: cycle?.yield_expected_t_per_ha?.toString() ?? '',
    yield_high: cycle?.yield_high_t_per_ha?.toString() ?? '',
    price_low: nairaInput(cycle?.price_low_per_tonne_kobo),
    price_expected: nairaInput(cycle?.price_expected_per_tonne_kobo),
    price_high: nairaInput(cycle?.price_high_per_tonne_kobo),
    funding_deadline: cycle?.funding_deadline ?? '',
    start_date: cycle?.start_date ?? '',
    expected_harvest_date: cycle?.expected_harvest_date ?? '',
    description: cycle?.description ?? '',
    fee_pct: ((cycle?.management_fee_bps ?? 0) / 100).toString(),
    funder_share_pct: ((cycle?.funder_profit_share_bps ?? 3000) / 100).toString(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const cooperatives = useAsync(async () => {
    const { data, error } = await supabase.from('cooperatives').select('id, name').order('name');
    if (error) throw error;
    return data as Pick<Cooperative, 'id' | 'name'>[];
  }, []);

  // Programmes a cycle can join: active ones, plus drafts being set up (and the current one).
  const programmes = useAsync(async () => {
    const { data, error } = await supabase
      .from('programmes')
      .select('id, code, name, status')
      .neq('status', 'closed')
      .order('code');
    if (error) throw error;
    return data as Pick<Programme, 'id' | 'code' | 'name' | 'status'>[];
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const money = (label: string, v: string, required: boolean) => {
      if (!v.trim()) {
        if (required) throw new Error(`${label} is required`);
        return null;
      }
      const kobo = parseNaira(v);
      if (kobo === null || kobo <= 0n)
        throw new Error(`${label} must be an amount in naira, e.g. 1250000`);
      return kobo.toString();
    };
    const num = (v: string) => Number(v);
    const bps = (label: string, v: string, max: number) => {
      const pct = Number(v);
      if (v.trim() === '' || !Number.isFinite(pct) || pct < 0 || pct > max)
        throw new Error(`${label} must be a percentage between 0 and ${max}`);
      return Math.round(pct * 100);
    };

    let row: Record<string, unknown>;
    try {
      row = {
        code: form.code.trim().toUpperCase(),
        crop: form.crop.trim().toLowerCase(),
        season: form.season.trim(),
        funding_source: form.funding_source,
        cooperative_id: form.cooperative_id || null,
        programme_id: form.funding_source === 'investor' ? null : form.programme_id || null,
        target_amount_kobo: money('Target amount', form.target, true),
        budget_per_hectare_kobo: money('Budget per hectare', form.budget_per_ha, true),
        yield_low_t_per_ha: num(form.yield_low),
        yield_expected_t_per_ha: num(form.yield_expected),
        yield_high_t_per_ha: num(form.yield_high),
        price_low_per_tonne_kobo: money('Low price', form.price_low, false),
        price_expected_per_tonne_kobo: money('Expected price', form.price_expected, false),
        price_high_per_tonne_kobo: money('High price', form.price_high, false),
        funding_deadline: form.funding_deadline || null,
        start_date: form.start_date || null,
        expected_harvest_date: form.expected_harvest_date || null,
        description: form.description.trim() || null,
        management_fee_bps: bps('Management fee', form.fee_pct, 20),
        funder_profit_share_bps: bps("Funders' share of profit", form.funder_share_pct, 100),
      };
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    if (!(
      (row.yield_low_t_per_ha as number) <= (row.yield_expected_t_per_ha as number) &&
      (row.yield_expected_t_per_ha as number) <= (row.yield_high_t_per_ha as number)
    )) {
      setError('Yields must go low ≤ expected ≤ high');
      return;
    }

    setBusy(true);
    const result = cycle
      ? await supabase.from('cycles').update(row).eq('id', cycle.id).select('id').single()
      : await supabase.from('cycles').insert(row).select('id').single();
    setBusy(false);
    if (result.error) {
      const e = result.error;
      setError(
        e.code === '23505'
          ? 'Another cycle already uses this code'
          : e.code === '23514'
            ? 'Check the order of values: yields and prices go low ≤ expected ≤ high; the funding deadline must be on or before the start, and harvest after it.'
            : errorMessage(e),
      );
      return;
    }
    toast.success(cycle ? 'Cycle details saved' : 'Draft cycle created');
    onDone(true);
    if (!cycle) navigate(`/cycles/${result.data.id}`);
  };

  return (
    <form onSubmit={submit} className="space-y-8">
      <Group title="Basics">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cycle code" hint="e.g. KD-MAIZE-2027-001">
            <Input
              value={form.code}
              onChange={set('code')}
              required
              pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,39}"
              title="3–40 letters, numbers and dashes"
              className="font-mono uppercase"
            />
          </Field>
          <Field label="Crop">
            <Input
              value={form.crop}
              onChange={set('crop')}
              required
              placeholder="maize"
              maxLength={60}
            />
          </Field>
          <Field label="Season">
            <Input
              value={form.season}
              onChange={set('season')}
              required
              placeholder="2027 wet"
              maxLength={40}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Funded by">
            <Select value={form.funding_source} onChange={set('funding_source')}>
              {Object.entries(FUNDING_SOURCE).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cooperative">
            <Select value={form.cooperative_id} onChange={set('cooperative_id')}>
              <option value="">No single cooperative</option>
              {cooperatives.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {form.funding_source !== 'investor' && (
            <Field
              label="Programme"
              hint="The cycle must meet the programme's rules before it can be submitted"
              className="sm:col-span-2"
            >
              <Select value={form.programme_id} onChange={set('programme_id')}>
                <option value="">Not part of a programme</option>
                {programmes.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                    {p.status === 'draft' ? ' (draft)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Group>

      <Group title="Budget">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Target amount (₦)"
            hint="What the cycle raises; milestones must add up to this"
          >
            <Input
              value={form.target}
              onChange={set('target')}
              required
              inputMode="decimal"
              placeholder="90000000"
            />
          </Field>
          <Field
            label="Budget per hectare (₦)"
            hint="The target can't exceed this × mapped hectares"
          >
            <Input
              value={form.budget_per_ha}
              onChange={set('budget_per_ha')}
              required
              inputMode="decimal"
              placeholder="500000"
            />
          </Field>
        </div>
      </Group>

      <Group title="Assumptions — shown as a range, never a promise">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Yield, low (t/ha)">
            <Input
              type="number"
              step="0.001"
              min="0"
              value={form.yield_low}
              onChange={set('yield_low')}
              required
            />
          </Field>
          <Field label="Yield, expected (t/ha)">
            <Input
              type="number"
              step="0.001"
              min="0"
              value={form.yield_expected}
              onChange={set('yield_expected')}
              required
            />
          </Field>
          <Field label="Yield, high (t/ha)">
            <Input
              type="number"
              step="0.001"
              min="0"
              value={form.yield_high}
              onChange={set('yield_high')}
              required
            />
          </Field>
          <Field label="Price, low (₦/t)">
            <Input value={form.price_low} onChange={set('price_low')} inputMode="decimal" />
          </Field>
          <Field label="Price, expected (₦/t)">
            <Input
              value={form.price_expected}
              onChange={set('price_expected')}
              inputMode="decimal"
            />
          </Field>
          <Field label="Price, high (₦/t)">
            <Input value={form.price_high} onChange={set('price_high')} inputMode="decimal" />
          </Field>
        </div>
      </Group>

      <Group title="Settlement terms">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Management fee (% of capital)" hint="Paid first at settlement; up to 20%">
            <Input
              value={form.fee_pct}
              onChange={set('fee_pct')}
              type="number"
              min={0}
              max={20}
              step={0.01}
              required
            />
          </Field>
          <Field
            label="Funders' share of profit (%)"
            hint="After capital is returned; farmers share the rest by kg delivered"
          >
            <Input
              value={form.funder_share_pct}
              onChange={set('funder_share_pct')}
              type="number"
              min={0}
              max={100}
              step={0.01}
              required
            />
          </Field>
        </div>
      </Group>

      <Group title="Dates">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Funding deadline">
            <Input
              type="date"
              min={isoDate()}
              value={form.funding_deadline}
              onChange={set('funding_deadline')}
            />
          </Field>
          <Field label="Season starts">
            <Input type="date" value={form.start_date} onChange={set('start_date')} />
          </Field>
          <Field label="Expected harvest">
            <Input
              type="date"
              value={form.expected_harvest_date}
              onChange={set('expected_harvest_date')}
            />
          </Field>
        </div>
        <Field label="Notes" hint="Optional: anything a reviewer or funder should know">
          <Textarea
            rows={3}
            value={form.description}
            onChange={set('description')}
            maxLength={5000}
          />
        </Field>
      </Group>

      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2 border-t border-zinc-950/5 pt-5">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {cycle ? 'Save changes' : 'Create draft'}
        </Button>
      </div>
    </form>
  );
}
