import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  KycBadge,
  ListSkeleton,
  PageHeader,
  Select,
  Table,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import { filterValue } from '../lib/format';
import { can } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Cooperative, Farmer, KycStatus } from '../lib/types';
import { useAsync, useDebounced } from '../lib/useAsync';

const PAGE_SIZE = 25;

export function FarmersPage() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const cooperativeId = params.get('cooperative') ?? '';
  const kyc = (params.get('kyc') ?? '') as KycStatus | '';
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(0);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(0);
  };

  const cooperatives = useAsync(async () => {
    const { data, error } = await supabase.from('cooperatives').select('id, name').order('name');
    if (error) throw error;
    return data as Pick<Cooperative, 'id' | 'name'>[];
  }, []);

  const farmers = useAsync(async () => {
    let q = supabase
      .from('farmers')
      .select('*, cooperatives(name)', { count: 'exact' })
      .order('last_name')
      .order('first_name')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
    if (kyc) q = q.eq('kyc_status', kyc);
    if (term) {
      const like = filterValue(`%${term}%`);
      q = q.or(`full_name.ilike.${like},phone.ilike.${like}`);
    }
    const { data, error, count } = await q;
    if (error) throw error;
    return {
      items: data as (Farmer & { cooperatives: { name: string } | null })[],
      total: count ?? 0,
    };
  }, [cooperativeId, kyc, term, page]);

  const total = farmers.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Farmers"
        description="Everyone enrolled in the registry. Each person can be enrolled only once."
        actions={
          can.enrol(profile?.role) ? (
            <Link to="/farmers/new">
              <Button>
                <UserPlus className="size-4" aria-hidden /> Enrol farmer
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          type="search"
          placeholder="Search by name or phone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          aria-label="Search farmers"
        />
        <Select
          value={cooperativeId}
          onChange={(e) => setFilter('cooperative', e.target.value)}
          aria-label="Filter by cooperative"
        >
          <option value="">All cooperatives</option>
          {cooperatives.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={kyc}
          onChange={(e) => setFilter('kyc', e.target.value)}
          aria-label="Filter by KYC status"
        >
          <option value="">Any KYC status</option>
          <option value="pending">KYC pending</option>
          <option value="verified">KYC verified</option>
          <option value="rejected">KYC rejected</option>
        </Select>
      </div>

      {farmers.loading && !farmers.data ? (
        <ListSkeleton rows={8} />
      ) : farmers.error ? (
        <Alert>{errorMessage(farmers.error)}</Alert>
      ) : farmers.data!.items.length === 0 ? (
        <EmptyState>No farmers match these filters.</EmptyState>
      ) : (
        <>
          <Table head={['Name', 'Phone', 'Cooperative', 'Location', 'KYC']}>
            {farmers.data!.items.map((f) => (
              <tr key={f.id} className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-900">
                  <Link to={`/farmers/${f.id}`} className="link">
                    {f.full_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600">{f.phone}</td>
                <td className="px-4 py-3 text-zinc-600">{f.cooperatives?.name ?? '—'}</td>
                <td className="px-4 py-3 text-zinc-600">
                  {f.lga}, {f.state}
                </td>
                <td className="px-4 py-3">
                  <KycBadge status={f.kyc_status} />
                </td>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex items-center justify-between text-sm text-zinc-600">
            <span>
              {total.toLocaleString()} farmer{total === 1 ? '' : 's'}
            </span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page + 1} of {pages}
                </span>
                <Button
                  variant="secondary"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
