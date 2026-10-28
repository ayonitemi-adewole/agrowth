import { Suspense } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Settings, Sprout, UserRound, Wallet } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { cn } from '../../lib/format';
import { Avatar, Logo } from '../ui';
import ThemeToggle from '../ThemeToggle';
import FullPageLoader, { PageLoader } from './FullPageLoader';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Home', icon: Home, match: ['/dashboard'] },
  { to: '/invest', label: 'Invest', icon: Sprout, match: ['/invest', '/product'] },
  { to: '/transact', label: 'Wallet', icon: Wallet, match: ['/transact'] },
  { to: '/profile', label: 'Profile', icon: UserRound, match: ['/profile', '/settings'] },
];

// Focused flows get the full screen on mobile so their sticky actions aren't covered
const FOCUS_ROUTES = ['/transact/deposit', '/transact/withdraw', '/product/', '/invest/product/', '/invest/quick-invest/'];

const isActive = (pathname, match) => match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const Sidebar = ({ pathname }) => {
  const { user, displayName, profile } = useApp();
  const items = [...NAV_ITEMS.slice(0, 3), { ...NAV_ITEMS[3], match: ['/profile'] }, { to: '/settings', label: 'Settings', icon: Settings, match: ['/settings'] }];

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
      <Logo to="/dashboard" className="px-2" />
      <nav className="mt-10 flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon, match }) => {
          const active = isActive(pathname, match);
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                active ? 'text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'
              )}
            >
              {active && (
                <motion.span layoutId="sidebar-active" className="absolute inset-0 rounded-xl bg-accent/10" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
              )}
              <Icon className="relative h-5 w-5" />
              <span className="relative">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-3">
        <Avatar src={user?.photoURL} name={`${profile?.firstName || displayName} ${profile?.lastName || ''}`} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{profile?.firstName || displayName}</p>
          <p className="truncate text-xs text-muted">{user?.email}</p>
        </div>
        <ThemeToggle className="h-9 w-9" />
      </div>
    </aside>
  );
};

const BottomNav = ({ pathname }) => (
  <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-safe lg:hidden">
    <div className="mx-auto mb-3 flex max-w-md items-center justify-around rounded-3xl border border-line bg-surface/90 p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl">
      {NAV_ITEMS.map(({ to, label, icon: Icon, match }) => {
        const active = isActive(pathname, match);
        return (
          <NavLink
            key={to}
            to={to}
            className={cn('relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-semibold transition-colors', active ? 'text-accent' : 'text-muted')}
          >
            {active && (
              <motion.span layoutId="bottom-nav-active" className="absolute inset-0 rounded-2xl bg-accent/10" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
            )}
            <motion.span whileTap={{ scale: 0.85 }} className="relative">
              <Icon className="h-5.5 w-5.5" strokeWidth={active ? 2.4 : 2} />
            </motion.span>
            <span className="relative">{label}</span>
          </NavLink>
        );
      })}
    </div>
  </nav>
);

const AppLayout = () => {
  const { user, authReady } = useApp();
  const { pathname } = useLocation();

  if (!authReady) return <FullPageLoader />;
  if (!user) return <Navigate to="/sign-in" replace state={{ from: pathname }} />;

  const focused = FOCUS_ROUTES.some((route) => pathname.startsWith(route));

  return (
    <div className="min-h-dvh">
      <Sidebar pathname={pathname} />
      <main className={cn('lg:pl-64', focused ? 'pb-8' : 'pb-28 lg:pb-10')}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mx-auto w-full max-w-5xl px-4 pt-5 sm:px-6 lg:px-10 lg:pt-8"
        >
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </main>
      {!focused && <BottomNav pathname={pathname} />}
    </div>
  );
};

export default AppLayout;
