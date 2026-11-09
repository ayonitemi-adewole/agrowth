import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Badge, Button, Input, PageHeader, Select, Spinner, Table } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { ALL_ROLES, ROLE_LABELS } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Profile, Role } from '../lib/types';
import { useAsync } from '../lib/useAsync';

/**
 * New staff sign up themselves, then an admin gives them a role here. Nobody can
 * change their own role or deactivate themselves (the database enforces this too).
 */
export function UsersPage() {
  const { profile: me } = useAuth();
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useAsync(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as Profile[];
  }, []);

  // Offtaker accounts are linked to the buyer they work for.
  const buyers = useAsync(async () => {
    const [list, links] = await Promise.all([
      supabase.from('offtakers').select('id, name').order('name'),
      supabase.from('offtaker_users').select('user_id, offtaker_id'),
    ]);
    if (list.error) throw list.error;
    if (links.error) throw links.error;
    return {
      list: list.data as { id: string; name: string }[],
      linked: new Map(
        (links.data as { user_id: string; offtaker_id: string }[]).map((l) => [
          l.user_id,
          l.offtaker_id,
        ]),
      ),
    };
  }, []);
  const linkBuyer = async (u: Profile, offtakerId: string) => {
    await run(u.id, () =>
      supabase.rpc('link_offtaker_account', {
        p_user_id: u.id,
        p_offtaker_id: offtakerId || null,
      }),
    );
    buyers.reload();
  };

  const run = async (userId: string, call: () => PromiseLike<{ error: unknown }>) => {
    setBusyId(userId);
    setError(null);
    const { error } = await call();
    setBusyId(null);
    if (error) setError(errorMessage(error));
    users.reload();
  };

  const setRole = (u: Profile, role: Role) =>
    run(u.id, () => supabase.rpc('admin_set_user_role', { p_user_id: u.id, p_role: role }));
  const setActive = (u: Profile, active: boolean) =>
    run(u.id, () => supabase.rpc('admin_set_user_active', { p_user_id: u.id, p_active: active }));

  const term = search.trim().toLowerCase();
  const shown = (users.data ?? []).filter(
    (u) =>
      !term || u.email.toLowerCase().includes(term) || u.full_name.toLowerCase().includes(term),
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff sign up with their own email, then you give them a role here."
      />
      <div className="mb-4 max-w-sm">
        <Input
          type="search"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {users.loading && !users.data ? (
        <Spinner />
      ) : users.error ? (
        <Alert>{errorMessage(users.error)}</Alert>
      ) : (
        <Table head={['Name', 'Email', 'Role', 'Status', 'Joined', '']}>
          {shown.map((u) => {
            const self = u.id === me?.id;
            return (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {u.full_name || '—'} {self && <Badge>You</Badge>}
                </td>
                <td className="px-4 py-3 text-zinc-600">{u.email}</td>
                <td className="px-4 py-3">
                  <Select
                    value={u.role}
                    disabled={self || busyId === u.id}
                    onChange={(e) => setRole(u, e.target.value as Role)}
                    aria-label={`Role for ${u.email}`}
                    className="min-w-44"
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  {u.role === 'offtaker' && buyers.data && (
                    <Select
                      value={buyers.data.linked.get(u.id) ?? ''}
                      disabled={busyId === u.id}
                      onChange={(e) => void linkBuyer(u, e.target.value)}
                      aria-label={`Buyer that ${u.email} works for`}
                      className="mt-2 min-w-44"
                    >
                      <option value="">Works for: not linked</option>
                      {buyers.data.list.map((b) => (
                        <option key={b.id} value={b.id}>
                          Works for {b.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.is_active ? (
                    <Badge tone="green">Active</Badge>
                  ) : (
                    <Badge tone="red">Deactivated</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {!self && (
                    <Button
                      variant="secondary"
                      busy={busyId === u.id}
                      onClick={() => setActive(u, !u.is_active)}
                    >
                      {u.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
