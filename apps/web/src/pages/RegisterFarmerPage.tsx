import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { duplicateFarmerId, errorMessage } from '../lib/errors';
import { describeOutcomes, runIdentityChecks } from '../lib/identity';
import { supabase } from '../lib/supabase';
import type { Cooperative } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const empty = {
  first_name: '',
  last_name: '',
  phone: '',
  gender: '',
  date_of_birth: '',
  nin: '',
  bvn: '',
  state: '',
  lga: '',
  ward: '',
  cooperative_id: '',
};

export function RegisterFarmerPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; existingId: string | null } | null>(null);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const cooperatives = useAsync(async () => {
    const { data, error } = await supabase
      .from('cooperatives')
      .select('id, name, state, lga')
      .order('name');
    if (error) throw error;
    return data as Pick<Cooperative, 'id' | 'name' | 'state' | 'lga'>[];
  }, []);

  /** Picking a cooperative fills in its location, which is usually the farmer's too. */
  const pickCooperative = (id: string) => {
    const coop = cooperatives.data?.find((c) => c.id === id);
    setForm({
      ...form,
      cooperative_id: id,
      state: form.state || coop?.state || '',
      lga: form.lga || coop?.lga || '',
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.nin.trim() && !form.bvn.trim()) {
      setError({
        message: 'Enter a NIN or BVN so the farmer can be checked for duplicates.',
        existingId: null,
      });
      return;
    }
    setBusy(true);
    const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
    const { data, error } = await supabase.rpc('register_farmer', {
      p_first_name: form.first_name,
      p_last_name: form.last_name,
      p_phone: form.phone,
      p_state: form.state,
      p_lga: form.lga,
      p_nin: orNull(form.nin),
      p_bvn: orNull(form.bvn),
      p_gender: orNull(form.gender),
      p_date_of_birth: orNull(form.date_of_birth),
      p_ward: orNull(form.ward),
      p_cooperative_id: orNull(form.cooperative_id),
    });
    if (error) {
      setBusy(false);
      setError({ message: errorMessage(error), existingId: duplicateFarmerId(error) });
      return;
    }
    // Enrolled. Now check the numbers with the identity provider; the farmer's page shows
    // the outcome. A failure here doesn't undo the enrolment: the check can be rerun there.
    const farmerId = data as string;
    let identityNotice: { ok: boolean; message: string };
    try {
      identityNotice = describeOutcomes(
        await runIdentityChecks(
          'farmer',
          farmerId,
          (['nin', 'bvn'] as const)
            .filter((t) => form[t].trim())
            .map((t) => ({ number_type: t, number: form[t] })),
        ),
      );
    } catch (err) {
      identityNotice = { ok: false, message: errorMessage(err) };
    }
    setBusy(false);
    navigate(`/farmers/${farmerId}`, { state: { justEnrolled: true, identityNotice } });
  };

  const idPattern = '[0-9 \\-]{11,15}';

  return (
    <>
      <PageHeader
        title="Enrol a farmer"
        description="NIN and BVN are checked with the identity provider, then kept only as a fingerprint that stops duplicate enrolments, and the last four digits."
      />
      <Card className="max-w-3xl">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input value={form.first_name} onChange={set('first_name')} required maxLength={100} />
          </Field>
          <Field label="Last name">
            <Input value={form.last_name} onChange={set('last_name')} required maxLength={100} />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={set('phone')}
              required
              pattern="\+?[0-9]{10,15}"
              title="10–15 digits, optionally starting with +"
              placeholder="+2348012345678"
              inputMode="tel"
            />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={set('gender')}>
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Date of birth">
            <Input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
          </Field>
          <div className="hidden sm:block" />
          <Field label="NIN" hint="11 digits">
            <Input
              value={form.nin}
              onChange={set('nin')}
              pattern={idPattern}
              title="11 digits"
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
          <Field label="BVN" hint="11 digits — at least one of NIN or BVN is required">
            <Input
              value={form.bvn}
              onChange={set('bvn')}
              pattern={idPattern}
              title="11 digits"
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
          <Field label="Cooperative" className="sm:col-span-2">
            <Select value={form.cooperative_id} onChange={(e) => pickCooperative(e.target.value)}>
              <option value="">Not in a cooperative</option>
              {cooperatives.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.lga}, {c.state})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="State">
            <Input
              value={form.state}
              onChange={set('state')}
              required
              minLength={2}
              maxLength={60}
            />
          </Field>
          <Field label="LGA">
            <Input value={form.lga} onChange={set('lga')} required minLength={2} maxLength={100} />
          </Field>
          <Field label="Ward">
            <Input value={form.ward} onChange={set('ward')} maxLength={100} />
          </Field>

          {error && (
            <div className="sm:col-span-2">
              <Alert>
                {error.message}
                {error.existingId && (
                  <>
                    {' '}
                    <Link to={`/farmers/${error.existingId}`} className="font-medium underline">
                      View the existing record
                    </Link>
                  </>
                )}
              </Alert>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" busy={busy}>
              Enrol farmer
            </Button>
            <Link to="/farmers">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
