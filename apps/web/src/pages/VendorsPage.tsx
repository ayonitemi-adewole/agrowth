import { Plus, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
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
  PageHeader,
  Select,
  Spinner,
  Table,
} from '../components/ui';
import { VENDOR_KIND, VENDOR_STATUS } from '../lib/cycles';
import { errorMessage } from '../lib/errors';
import { filterValue, formatDate } from '../lib/format';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Profile, Vendor, VendorKind, VendorStatus } from '../lib/types';
import { useAsync, useDebounced } from '../lib/useAsync';

export function VendorsPage() {
  const role = useAuth().profile?.role;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<VendorStatus | ''>('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const term = useDebounced(search.trim(), 300);

  const list = useAsync(async () => {
    let q = supabase.from('vendors').select('*').order('name');
    if (term)
      q = q.or(`name.ilike.${filterValue(`%${term}%`)},lga.ilike.${filterValue(`%${term}%`)}`);
    if (status) q = q.eq('status', status);
    const { data, error } = await q.limit(300);
    if (error) throw error;
    return data as Vendor[];
  }, [term, status]);

  return (
    <>
      <PageHeader
        title="Vendors"
        description="Agro-dealers and service providers where farmers redeem input vouchers. Compliance approves each one, and the trustee pays only their registered account."
        actions={
          can.editVendors(role) ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Register vendor
            </Button>
          ) : null
        }
      />

      {role === 'admin' && <ScanSetting />}

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          placeholder="Search by name or LGA"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search vendors"
          className="max-w-sm"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as VendorStatus | '')}
          aria-label="Filter by status"
          className="w-48"
        >
          <option value="">All statuses</option>
          {Object.entries(VENDOR_STATUS).map(([k, { label }]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {list.loading ? (
        <Spinner />
      ) : list.error ? (
        <Alert>{errorMessage(list.error)}</Alert>
      ) : list.data!.length === 0 ? (
        <EmptyState icon={<Store />}>
          {search || status ? 'No vendors match.' : 'No vendors registered yet.'}
        </EmptyState>
      ) : (
        <Table head={['Name', 'Type', 'Location', 'Pays to', 'Counter sign-in', 'Status']}>
          {list.data!.map((v) => (
            <tr
              key={v.id}
              className="cursor-pointer hover:bg-zinc-50"
              onClick={() => setSelected(v)}
            >
              <td>
                <p className="font-medium text-zinc-900">{v.name}</p>
                {v.registration_number && (
                  <p className="text-xs text-zinc-500">{v.registration_number}</p>
                )}
              </td>
              <td className="text-zinc-600">{VENDOR_KIND[v.kind]}</td>
              <td className="text-zinc-600">
                {v.lga}, {v.state}
              </td>
              <td className="text-zinc-600">
                {v.bank_name} {v.account_number}
              </td>
              <td className="text-zinc-600">{v.user_id ? 'Linked' : '—'}</td>
              <td>
                <Badge tone={VENDOR_STATUS[v.status].tone} dot>
                  {VENDOR_STATUS[v.status].label}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Register vendor' : 'Edit vendor'}
        description={
          editing && editing !== 'new' && editing.status === 'approved'
            ? 'Changing the bank details sends this vendor back to compliance for approval.'
            : undefined
        }
        wide
      >
        {editing !== null && (
          <VendorForm
            vendor={editing === 'new' ? undefined : editing}
            onDone={(saved) => {
              setEditing(null);
              if (saved) {
                setSelected(null);
                list.reload();
              }
            }}
          />
        )}
      </Modal>

      <Modal
        open={selected !== null && editing === null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        wide
      >
        {selected && (
          <VendorDetail
            vendor={selected}
            onEdit={() => setEditing(selected)}
            onChanged={() => {
              setSelected(null);
              list.reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function VendorDetail({
  vendor: v,
  onEdit,
  onChanged,
}: {
  vendor: Vendor;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<VendorStatus | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState(v.user_id ?? '');

  const accounts = useAsync(async () => {
    if (!can.linkVendorAccounts(role)) return [];
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('role', 'vendor')
      .order('email');
    if (error) throw error;
    return data as Pick<Profile, 'id' | 'email' | 'full_name'>[];
  }, [role]);

  const setStatus = async (status: VendorStatus) => {
    setBusy(status);
    setError(null);
    const { error } = await supabase.rpc('set_vendor_status', {
      p_vendor_id: v.id,
      p_status: status,
      p_note: note.trim() || null,
    });
    setBusy(null);
    if (error) setError(errorMessage(error));
    else {
      toast.success(`${v.name} is now ${VENDOR_STATUS[status].label.toLowerCase()}`);
      onChanged();
    }
  };

  const link = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('link');
    setError(null);
    const { error } = await supabase.rpc('link_vendor_account', {
      p_vendor_id: v.id,
      p_user_id: account || null,
    });
    setBusy(null);
    if (error) setError(errorMessage(error));
    else {
      toast.success(account ? 'Counter sign-in linked' : 'Counter sign-in removed');
      onChanged();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Badge tone={VENDOR_STATUS[v.status].tone} dot>
          {VENDOR_STATUS[v.status].label}
        </Badge>
        {v.status_note && <span className="text-sm text-zinc-500">{v.status_note}</span>}
      </div>
      <DescriptionList
        items={[
          ['Type', VENDOR_KIND[v.kind]],
          ['Registration no.', v.registration_number ?? '—'],
          ['Phone', v.contact_phone],
          ['Email', v.contact_email ?? '—'],
          ['Location', `${v.address ? `${v.address}, ` : ''}${v.lga}, ${v.state}`],
          ['Pays to', `${v.account_name} · ${v.bank_name} ${v.account_number}`],
          ['Registered', formatDate(v.created_at)],
          ['Last reviewed', v.reviewed_at ? formatDate(v.reviewed_at) : 'Not yet'],
        ]}
      />

      {can.reviewVendors(role) && (
        <div className="space-y-3 border-t border-zinc-950/5 pt-5">
          <p className="text-sm font-medium text-zinc-900">Compliance review</p>
          <Field label="Note" hint="Required to suspend">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              placeholder="e.g. CAC certificate and shop visit checked"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {v.status !== 'approved' && (
              <Button busy={busy === 'approved'} onClick={() => setStatus('approved')}>
                Approve
              </Button>
            )}
            {v.status !== 'suspended' && (
              <Button
                variant="danger"
                busy={busy === 'suspended'}
                onClick={() => setStatus('suspended')}
              >
                Suspend
              </Button>
            )}
          </div>
        </div>
      )}

      {can.linkVendorAccounts(role) && (
        <form onSubmit={link} className="space-y-3 border-t border-zinc-950/5 pt-5">
          <p className="text-sm font-medium text-zinc-900">Counter sign-in</p>
          <p className="text-sm text-zinc-500">
            The account the shop uses to redeem vouchers. Give the user the Vendor role on the Users
            page first.
          </p>
          <div className="flex flex-wrap gap-2">
            <Select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              aria-label="Vendor account"
              className="max-w-sm"
            >
              <option value="">Not linked</option>
              {(accounts.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ? `${p.full_name} (${p.email})` : p.email}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              variant="secondary"
              busy={busy === 'link'}
              disabled={account === (v.user_id ?? '')}
            >
              Save
            </Button>
          </div>
        </form>
      )}

      {error && <Alert>{error}</Alert>}

      {can.editVendors(role) && (
        <div className="flex justify-end border-t border-zinc-950/5 pt-5">
          <Button variant="secondary" onClick={onEdit}>
            Edit details
          </Button>
        </div>
      )}
    </div>
  );
}

function VendorForm({ vendor, onDone }: { vendor?: Vendor; onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState({
    name: vendor?.name ?? '',
    kind: vendor?.kind ?? ('agro_dealer' as VendorKind),
    registration_number: vendor?.registration_number ?? '',
    contact_phone: vendor?.contact_phone ?? '',
    contact_email: vendor?.contact_email ?? '',
    state: vendor?.state ?? '',
    lga: vendor?.lga ?? '',
    address: vendor?.address ?? '',
    bank_name: vendor?.bank_name ?? '',
    account_number: vendor?.account_number ?? '',
    account_name: vendor?.account_name ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const row = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
    );
    const { error } = vendor
      ? await supabase.from('vendors').update(row).eq('id', vendor.id)
      : await supabase.from('vendors').insert(row);
    setBusy(false);
    if (error) {
      setError(
        error.code === '23505'
          ? 'A vendor with this registration number already exists'
          : errorMessage(error),
      );
      return;
    }
    onDone(true);
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name" className="sm:col-span-2">
        <Input value={form.name} onChange={set('name')} required minLength={2} maxLength={200} />
      </Field>
      <Field label="Type">
        <Select value={form.kind} onChange={set('kind')}>
          {Object.entries(VENDOR_KIND).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="CAC or dealer licence no." hint="Optional, but must be unique">
        <Input
          value={form.registration_number}
          onChange={set('registration_number')}
          maxLength={60}
        />
      </Field>
      <Field label="Phone">
        <Input
          value={form.contact_phone}
          onChange={set('contact_phone')}
          required
          pattern="\+?[0-9]{10,15}"
          title="10–15 digits, optionally starting with +"
        />
      </Field>
      <Field label="Email" hint="Optional">
        <Input
          type="email"
          value={form.contact_email}
          onChange={set('contact_email')}
          maxLength={200}
        />
      </Field>
      <Field label="State">
        <Input value={form.state} onChange={set('state')} required minLength={2} maxLength={60} />
      </Field>
      <Field label="LGA">
        <Input value={form.lga} onChange={set('lga')} required minLength={2} maxLength={100} />
      </Field>
      <Field label="Shop address" className="sm:col-span-2" hint="Optional">
        <Input value={form.address} onChange={set('address')} maxLength={300} />
      </Field>
      <Field label="Bank">
        <Input
          value={form.bank_name}
          onChange={set('bank_name')}
          required
          minLength={2}
          maxLength={100}
        />
      </Field>
      <Field label="Account number" hint="10-digit NUBAN">
        <Input
          value={form.account_number}
          onChange={set('account_number')}
          required
          inputMode="numeric"
          pattern="[0-9]{10}"
          title="10 digits"
        />
      </Field>
      <Field label="Account name" className="sm:col-span-2">
        <Input
          value={form.account_name}
          onChange={set('account_name')}
          required
          minLength={2}
          maxLength={200}
        />
      </Field>
      {error && (
        <div className="sm:col-span-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {vendor ? 'Save changes' : 'Register vendor'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Admin only: whether a scanned voucher also needs the farmer's phone digits. Off, a scan
 * alone is enough, so whoever holds a slip can spend it; on, a lost slip is useless alone.
 */
function ScanSetting() {
  const toast = useToast();
  const setting = useAsync(async () => {
    const { data, error } = await supabase
      .from('voucher_settings')
      .select('scan_needs_phone, updated_at')
      .single();
    if (error) throw error;
    return data as { scan_needs_phone: boolean; updated_at: string };
  }, []);
  const [busy, setBusy] = useState(false);

  const toggle = async (needsPhone: boolean) => {
    setBusy(true);
    const { error } = await supabase
      .from('voucher_settings')
      .update({ scan_needs_phone: needsPhone })
      .eq('id', true);
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else {
      toast.success(
        needsPhone
          ? 'Scanned vouchers now also need the phone digits'
          : 'A scan alone now verifies a voucher',
      );
      setting.reload();
    }
  };

  if (!setting.data) return null;
  return (
    <Card className="mb-6">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 rounded text-brand-600"
          checked={setting.data.scan_needs_phone}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-zinc-900">
            Ask for the farmer's phone digits after scanning a voucher
          </span>
          <span className="block text-sm text-zinc-500">
            {setting.data.scan_needs_phone
              ? 'On: the shop scans the slip, then asks for the last 4 digits of the farmer’s phone. A lost slip can’t be used by whoever finds it.'
              : 'Off: scanning the slip’s QR code is enough, which is quicker at the counter, but whoever holds a slip can spend it. Typed codes always need the phone digits.'}
          </span>
        </span>
      </label>
    </Card>
  );
}
