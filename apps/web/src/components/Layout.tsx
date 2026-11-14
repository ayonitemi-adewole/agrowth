import {
  BadgeCheck,
  CloudOff,
  CloudUpload,
  BookOpenCheck,
  BriefcaseBusiness,
  FileSpreadsheet,
  Handshake,
  Landmark,
  LandPlot,
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
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { demo } from '../lib/demo';
import { useOffline } from '../lib/offline/OfflineProvider';
import { can, ROLE_LABELS } from '../lib/roles';
import type { Role } from '../lib/types';
import { preloadRoute } from '../pages/lazy';
import { PullToRefresh } from './PullToRefresh';
import { SplashScreen } from './SplashScreen';
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
      <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-sm">
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
    title: 'Buyer',
    items: [{ to: '/buyer', label: 'Buyer portal', icon: Handshake, show: can.useBuyerPortal }],
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
      { to: '/programmes', label: 'Programmes', icon: LandPlot, show: can.readProgrammes },
      { to: '/field', label: 'Field visits', icon: ClipboardCheck, show: can.doFieldVisits },
    ],
  },
  {
    title: 'Oversight',
    items: [
      { to: '/investors', label: 'Investors', icon: Landmark, show: can.readInvestors },
      { to: '/bank', label: 'Bank files', icon: FileSpreadsheet, show: can.readBankFiles },
      { to: '/ledger', label: 'Ledger', icon: BookOpenCheck, show: can.readLedger },
      { to: '/users', label: 'Users', icon: Users, show: can.manageUsers },
    ],
  },
];

export function Layout() {
  const { profile, signOut } = useAuth();
  const { pending } = useOffline();
  const [open, setOpen] = useState(false);
  const role = profile?.role;

  // Fetch the code for every screen in this person's menu once the browser is idle, so
  // moving between them doesn't wait on a download. Hovering a link fetches it sooner.
  useEffect(() => {
    const paths = SECTIONS.flatMap((s) => s.items)
      .filter((item) => item.show(role))
      .map((item) => item.to);
    const run = () => paths.forEach((path) => void preloadRoute(path));
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, [role]);

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
                    onMouseEnter={() => void preloadRoute(to)}
                    onFocus={() => void preloadRoute(to)}
                    onTouchStart={() => void preloadRoute(to)}
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
      {can.doFieldVisits(role) && <SyncStatus />}
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
          onClick={() => {
            if (
              pending > 0 &&
              !window.confirm(
                `${pending} visit(s) on this phone haven't been sent yet. They stay on the phone and send after you sign in again. Sign out anyway?`,
              )
            ) {
              return;
            }
            void signOut();
          }}
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

      <PullToRefresh />

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" data-no-pull>
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
        {/* A screen still loading shows in the page area; the menu stays put. */}
        <Suspense fallback={<SplashScreen inline />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

/** For field agents: whether there's a connection, and visits still waiting to send. */
function SyncStatus() {
  const { online, pending, failed, syncing, syncNow } = useOffline();
  const { offline: signedInOffline } = useAuth();
  return (
    <div className="mt-4 rounded-xl bg-white/5 px-3 py-2.5 text-xs text-brand-100/80">
      <div className="flex items-center gap-2">
        {online ? (
          <span className="size-2 rounded-full bg-brand-400" aria-hidden />
        ) : (
          <CloudOff className="size-3.5 text-amber-300" aria-hidden />
        )}
        <span className="font-medium text-white">{online ? 'Online' : 'Offline'}</span>
        {pending > 0 && (
          <button
            onClick={() => void syncNow()}
            disabled={!online || syncing}
            className="ml-auto flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 font-medium text-white ring-1 ring-white/15 hover:bg-white/20 disabled:opacity-60"
          >
            <CloudUpload className={cx('size-3.5', syncing && 'animate-pulse')} aria-hidden />
            {pending} to send
          </button>
        )}
      </div>
      {failed > 0 && (
        <p className="mt-1 text-red-300">{failed} visit(s) not accepted: see Field visits</p>
      )}
      {signedInOffline && (
        <p className="mt-1">Working from this phone. Visits send once you&apos;re back online.</p>
      )}
    </div>
  );
}
