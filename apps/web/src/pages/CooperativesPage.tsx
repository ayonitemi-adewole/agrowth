import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListSkeleton,
  PageHeader,
  Table,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { filterValue } from '../lib/format';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Cooperative } from '../lib/types';
import { useAsync, useDebounced } from '../lib/useAsync';

type CooperativeRow = Cooperative & { farmers: { count: number }[] };

export function CooperativesPage() {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const term = useDebounced(search.trim(), 300);

  const list = useAsync(async () => {
    let q = supabase.from('cooperatives').select('*, farmers(count)').order('name');
    if (term)
      q = q.or(`name.ilike.${filterValue(`%${term}%`)},lga.ilike.${filterValue(`%${term}%`)}`);
    const { data, error } = await q.limit(200);
    if (error) throw error;
    return data as CooperativeRow[];
  }, [term]);

  return (
    <>
      <PageHeader
        title="Cooperatives"
        description="Farmer groups that apply for cycles together."
        actions={
          can.editCooperatives(profile?.role) && !creating ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New cooperative
            </Button>
          ) : null
        }
      />

      {creating && (
        <CooperativeForm
          onDone={(saved) => {
            setCreating(false);
            if (saved) list.reload();
          }}
        />
      )}

      <div className="mb-4 max-w-sm">
        <Input
          type="search"
          placeholder="Search by name or LGA"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search cooperatives"
        />
      </div>

      {list.loading && !list.data ? (
        <ListSkeleton />
      ) : list.error ? (
        <Alert>{errorMessage(list.error)}</Alert>
      ) : list.data!.length === 0 ? (
        <EmptyState>
          {search ? 'No cooperatives match your search.' : 'No cooperatives yet.'}
        </EmptyState>
      ) : (
        <Table head={['Name', 'Registration no.', 'State', 'LGA', 'Members']}>
          {list.data!.map((c) => (
            <tr key={c.id} className="hover:bg-zinc-50">
              <td className="px-4 py-3 font-medium text-zinc-900">
                <Link to={`/farmers?cooperative=${c.id}`} className="link">
                  {c.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-600">{c.registration_number ?? '—'}</td>
              <td className="px-4 py-3 text-zinc-600">{c.state}</td>
              <td className="px-4 py-3 text-zinc-600">{c.lga}</td>
              <td className="px-4 py-3 text-zinc-600 tabular-nums">{c.farmers[0]?.count ?? 0}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function CooperativeForm({ onDone }: { onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState({
    name: '',
    registration_number: '',
    state: '',
    lga: '',
    ward: '',
    contact_phone: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const clean = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
    );
    const { error } = await supabase.from('cooperatives').insert(clean);
    setBusy(false);
    if (error) {
      setError(
        error.code === '23505'
          ? 'A cooperative with this registration number already exists'
          : errorMessage(error),
      );
      return;
    }
    onDone(true);
  };

  return (
    <Card className="mb-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input value={form.name} onChange={set('name')} required minLength={2} maxLength={200} />
        </Field>
        <Field label="Registration number" hint="Optional, but must be unique">
          <Input
            value={form.registration_number}
            onChange={set('registration_number')}
            maxLength={60}
          />
        </Field>
        <Field label="Contact phone">
          <Input
            value={form.contact_phone}
            onChange={set('contact_phone')}
            pattern="\+?[0-9]{10,15}"
            title="10–15 digits, optionally starting with +"
          />
        </Field>
        <Field label="State">
          <Input value={form.state} onChange={set('state')} required minLength={2} maxLength={60} />
        </Field>
        <Field label="LGA">
          <Input value={form.lga} onChange={set('lga')} required minLength={2} maxLength={100} />
        </Field>
        <Field label="Ward">
          <Input value={form.ward} onChange={set('ward')} maxLength={100} />
        </Field>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" busy={busy}>
            Save cooperative
          </Button>
          <Button type="button" variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
