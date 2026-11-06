import {
  BadgeCheck,
  BookOpenCheck,
  BriefcaseBusiness,
  Landmark,
  TrendingUp,
  Store,
  TicketCheck,
  ClipboardCheck,
  Home,
  LogOut,
  Menu,
  Sprout,
  Users,
  UsersRound,
  Warehouse,
  Wheat,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { demo } from '../lib/demo';
import { can, ROLE_LABELS } from '../lib/roles';
import type { Role } from '../lib/types';
import { DemoSwitcher } from './DemoSignIn';
import { Avatar, cx } from './ui';

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span
      className={cx(
        'flex items-center gap-2.5 text-lg font-semibold tracking-tight',
        inverted ? 'text-white' : 'text-brand-900',
      )}
    >
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm">
        <Sprout className="size-5" aria-hidden />
      </span>
      Agrowth
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  show: (r?: Role) => boolean;
}

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Overview', icon: Home, show: can.useStaffApp }] },
  {
    title: 'Invest',
    items: [
      { to: '/invest', label: 'Marketplace', icon: TrendingUp, show: can.invest },
      { to: '/portfolio', label: 'My investments', icon: BriefcaseBusiness, show: can.invest },
      { to: '/profile', label: 'Profile and KYC', icon: BadgeCheck, show: can.invest },
    ],
  },
  {
    title: 'Shop counter',
    items: [
      { to: '/redeem', label: 'Redeem vouchers', icon: TicketCheck, show: can.redeemVouchers },
    ],
  },
  {
    title: 'Registry',
    items: [
      { to: '/cooperatives', label: 'Cooperatives', icon: Warehouse, show: can.readRegistry },
      { to: '/farmers', label: 'Farmers', icon: UsersRound, show: can.readRegistry },
      { to: '/vendors', label: 'Vendors', icon: Store, show: can.readVendors },
    ],
  },
  {
    title: 'Cycles',
    items: [
      { to: '/cycles', label: 'Funding cycles', icon: Wheat, show: can.readCycles },
      { to: '/field', label: 'Field visits', icon: ClipboardCheck, show: can.doFieldVisits },
    ],
  },
  {
    title: 'Oversight',
    items: [
      { to: '/investors', label: 'Investors', icon: Landmark, show: can.readInvestors },
      { to: '/ledger', label: 'Ledger', icon: BookOpenCheck, show: can.readLedger },
      { to: '/users', label: 'Users', icon: Users, show: can.manageUsers },
    ],
  },
];

export function Layout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const role = profile?.role;

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-950 px-4 py-5">
      <div className="px-2">
        <Logo inverted />
      </div>
      <nav className="mt-8 flex-1 space-y-6 overflow-y-auto">
        {SECTIONS.map((section, i) => {
          const items = section.items.filter((item) => item.show(role));
          if (items.length === 0) return null;
          return (
            <div key={i}>
              {section.title && (
                <p className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-brand-300/60 uppercase">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-brand-100/70 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          className={cx(
                            'size-4',
                            isActive
                              ? 'text-brand-300'
                              : 'text-brand-300/50 group-hover:text-brand-300',
                          )}
                          aria-hidden
                        />
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <DemoSwitcher />
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/5 p-3">
        <Avatar
          name={profile?.full_name || profile?.email || ''}
          className="bg-brand-300 text-brand-950"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {profile?.full_name || profile?.email}
          </p>
          <p className="truncate text-xs text-brand-200/70">{role ? ROLE_LABELS[role] : ''}</p>
        </div>
        <button
          onClick={signOut}
          className="rounded-lg p-1.5 text-brand-200/70 hover:bg-white/10 hover:text-white"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-950/5 bg-white/80 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-zinc-950/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 animate-slide-up">
            {sidebar}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-5 right-3 rounded-lg p-1.5 text-brand-100 hover:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      {demo.hosted && (
        <div className="border-b border-amber-600/15 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Demo environment with a sample portfolio. Other visitors see what you change. Use{' '}
          <span className="font-medium">Demo: switch account</span> in the menu to act as another
          role.
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
