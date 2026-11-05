import { Home, LogOut, Menu, Sprout, Users, UsersRound, Warehouse, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { can, ROLE_LABELS } from '../lib/roles';

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold text-green-800">
      <span className="grid size-8 place-items-center rounded-lg bg-green-700 text-white">
        <Sprout className="size-5" aria-hidden />
      </span>
      Agrowth
    </span>
  );
}

export function Layout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const role = profile?.role;

  const links = [
    { to: '/', label: 'Overview', icon: Home, show: true },
    { to: '/cooperatives', label: 'Cooperatives', icon: Warehouse, show: can.readRegistry(role) },
    { to: '/farmers', label: 'Farmers', icon: UsersRound, show: can.readRegistry(role) },
    { to: '/users', label: 'Users', icon: Users, show: can.manageUsers(role) },
  ].filter((l) => l.show);

  const nav = (
    <nav className="space-y-1">
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
              isActive ? 'bg-green-50 text-green-800' : 'text-stone-600 hover:bg-stone-100'
            }`
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const account = (
    <div className="border-t border-stone-200 pt-4">
      <p className="truncate text-sm font-medium text-stone-900">
        {profile?.full_name || profile?.email}
      </p>
      <p className="text-xs text-stone-500">{role ? ROLE_LABELS[role] : ''}</p>
      <button
        onClick={signOut}
        className="mt-3 flex items-center gap-2 text-sm text-stone-600 hover:text-stone-900"
      >
        <LogOut className="size-4" aria-hidden /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-stone-200 bg-white p-4 lg:flex">
        <div className="space-y-6">
          <Logo />
          {nav}
        </div>
        {account}
      </aside>

      {/* Mobile header */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'}>
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </header>
      {open && (
        <div className="space-y-4 border-b border-stone-200 bg-white p-4 lg:hidden">
          {nav}
          {account}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
