import { MapPinned, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { FarmMap } from '../../components/FarmMap';
import { useToast } from '../../components/Toast';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  KycBadge,
  Modal,
  Spinner,
  Table,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatHectares } from '../../lib/format';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import { useAsync } from '../../lib/useAsync';
import type { CycleFarm, TabProps } from './useCycleData';

export function FarmsTab({ data, reload }: TabProps) {
  const role = useAuth().profile?.role;
  const toast = useToast();
  const editable = data.cycle.status === 'draft' && can.manageCycles(role);
  const [adding, setAdding] = useState(false);

  const remove = async (farmId: string) => {
    const { error } = await supabase
      .from('cycle_farms')
      .delete()
      .eq('cycle_id', data.cycle.id)
      .eq('farm_id', farmId);
    if (error) toast.error(errorMessage(error));
    else reload();
  };

  const unverified = data.farms.filter((f) => f.kyc_status !== 'verified').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          {data.farms.length} farms · {formatHectares(data.hectares)} mapped
        </p>
        {editable && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add farms
          </Button>
        )}
      </div>

      {unverified > 0 && (
        <Alert tone="warning">
          {unverified} farmer{unverified === 1 ? ' has' : 's have'} not passed KYC. Compliance must
          verify every farmer before the cycle can be submitted.
        </Alert>
      )}

      {data.farms.length === 0 ? (
        <EmptyState icon={<MapPinned />} title="No farms yet">
          Add mapped farms from the registry. Each farm can be in only one live cycle at a time.
        </EmptyState>
      ) : (
        <>
          <FarmMap farms={data.farms} className="h-80 w-full rounded-2xl ring-1 ring-zinc-950/5" />
          <Table head={['Farmer', 'Farm', 'Area', 'Crop', 'KYC', '']}>
            {data.farms.map((f) => (
              <tr key={f.id}>
                <td className="font-medium text-zinc-900">
                  <Link to={`/farmers/${f.farmer_id}`} className="hover:text-brand-700">
                    {f.farmer_name}
                  </Link>
                </td>
                <td className="text-zinc-600">{f.name ?? '—'}</td>
                <td className="text-zinc-600 tabular-nums">{formatHectares(f.area_hectares)}</td>
                <td className="text-zinc-600">{f.primary_crop ?? '—'}</td>
                <td>
                  <KycBadge status={f.kyc_status} />
                </td>
                <td className="text-right">
                  {editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(f.id)}
                      aria-label={`Remove ${f.farmer_name}'s farm`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add farms to this cycle" wide>
        <AddFarms
          cycleId={data.cycle.id}
          cooperativeId={data.cycle.cooperative_id}
          existing={data.farms}
          onDone={(added) => {
            setAdding(false);
            if (added) {
              toast.success(`${added} farm${added === 1 ? '' : 's'} added`);
              reload();
            }
          }}
        />
      </Modal>
    </div>
  );
}

function AddFarms({
  cycleId,
  cooperativeId,
  existing,
  onDone,
}: {
  cycleId: string;
  cooperativeId: string | null;
  existing: CycleFarm[];
  onDone: (added: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const farms = useAsync(async () => {
    let q = supabase
      .from('farm_maps')
      .select('*, farmers(full_name, kyc_status)')
      .order('created_at');
    if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
    const { data, error } = await q.limit(500);
    if (error) throw error;
    const taken = new Set(existing.map((f) => f.id));
    return (
      data as (CycleFarm & {
        farmers: { full_name: string; kyc_status: CycleFarm['kyc_status'] };
      })[]
    )
      .filter((f) => !taken.has(f.id))
      .map((f) => ({ ...f, farmer_name: f.farmers.full_name, kyc_status: f.farmers.kyc_status }));
  }, [cooperativeId]);

  const term = search.trim().toLowerCase();
  const shown = (farms.data ?? []).filter(
    (f) =>
      !term ||
      f.farmer_name.toLowerCase().includes(term) ||
      (f.name ?? '').toLowerCase().includes(term),
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('cycle_farms')
      .insert([...selected].map((farm_id) => ({ cycle_id: cycleId, farm_id })));
    setBusy(false);
    if (error) setError(errorMessage(error));
    else onDone(selected.size);
  };

  const selectedHa = (farms.data ?? [])
    .filter((f) => selected.has(f.id))
    .reduce((s, f) => s + Number(f.area_hectares), 0);

  return (
    <div className="space-y-4">
      {cooperativeId && (
        <p className="text-sm text-zinc-500">Showing farms of this cycle's cooperative.</p>
      )}
      <Input
        type="search"
        placeholder="Search by farmer or farm name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {farms.loading ? (
        <Spinner />
      ) : farms.error ? (
        <Alert>{errorMessage(farms.error)}</Alert>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">No more mapped farms to add.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-zinc-950/5 overflow-y-auto rounded-xl ring-1 ring-zinc-950/10">
          {shown.map((f) => (
            <li key={f.id}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                  className="size-4 rounded border-zinc-300 accent-brand-700"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">
                    {f.farmer_name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {f.name ?? 'Farm'} · {formatHectares(f.area_hectares)}
                    {f.primary_crop ? ` · ${f.primary_crop}` : ''}
                  </span>
                </span>
                <KycBadge status={f.kyc_status} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex items-center justify-between gap-2 border-t border-zinc-950/5 pt-4">
        <span className="text-sm text-zinc-500">
          {selected.size} selected · {formatHectares(selectedHa)}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onDone(0)}>
            Cancel
          </Button>
          <Button disabled={selected.size === 0} busy={busy} onClick={save}>
            Add {selected.size || ''} farms
          </Button>
        </div>
      </div>
    </div>
  );
}
