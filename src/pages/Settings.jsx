import { Navigate, NavLink, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Bell, ChevronRight, CreditCard, Palette, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { cn } from '../lib/format';
import { Card, PageHeader } from '../components/ui';
import ProfileSettings from '../components/settings/ProfileSettings';
import SecuritySettings from '../components/settings/SecuritySettings';
import AppearanceSettings from '../components/settings/AppearanceSettings';
import NotificationSettings from '../components/settings/NotificationSettings';
import WithdrawalSettings from '../components/settings/WithdrawalSettings';
import DangerZone from '../components/settings/DangerZone';

const SECTIONS = [
  { key: 'profile', label: 'Personal details', hint: 'Name, phone and photo', icon: UserRound, component: ProfileSettings },
  { key: 'security', label: 'Security', hint: 'Password and 2FA', icon: ShieldCheck, component: SecuritySettings },
  { key: 'appearance', label: 'Appearance', hint: 'Theme and accent colour', icon: Palette, component: AppearanceSettings },
  { key: 'notifications', label: 'Notifications', hint: 'What we tell you about', icon: Bell, component: NotificationSettings },
  { key: 'withdrawals', label: 'Withdrawals', hint: 'Payout bank account', icon: CreditCard, component: WithdrawalSettings },
  { key: 'danger', label: 'Danger zone', hint: 'Deactivate or delete account', icon: TriangleAlert, component: DangerZone, danger: true },
];

const Settings = () => {
  const { section } = useParams();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const active = SECTIONS.find((s) => s.key === section);

  if (section && !active) return <Navigate to="/settings" replace />;
  if (!section && isDesktop) return <Navigate to="/settings/profile" replace />;

  // Mobile index: list of sections
  if (!active) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Settings" subtitle="Manage your account and preferences" back="/profile" />
        <Card className="divide-y divide-line overflow-hidden">
          {SECTIONS.map(({ key, label, hint, icon: Icon, danger }) => (
            <NavLink key={key} to={`/settings/${key}`} className="flex items-center gap-4 px-4 py-4 transition hover:bg-surface-2/70">
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', danger ? 'bg-red-500/12 text-red-500' : 'bg-accent/10 text-accent')}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex-1">
                <span className={cn('block text-sm font-semibold', danger && 'text-red-500')}>{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-muted" />
            </NavLink>
          ))}
        </Card>
      </div>
    );
  }

  const Section = active.component;

  return (
    <div>
      <PageHeader title={isDesktop ? 'Settings' : active.label} subtitle={isDesktop ? 'Manage your account and preferences' : active.hint} back={isDesktop ? '/profile' : '/settings'} />
      <div className="grid gap-6 md:grid-cols-[230px_1fr]">
        <nav className="hidden flex-col gap-1 md:flex">
          {SECTIONS.map(({ key, label, icon: Icon, danger }) => {
            const isActive = key === active.key;
            return (
              <NavLink
                key={key}
                to={`/settings/${key}`}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive ? (danger ? 'text-red-500' : 'text-accent') : 'text-muted hover:bg-surface-2 hover:text-fg'
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="settings-active"
                    className={cn('absolute inset-0 rounded-xl', danger ? 'bg-red-500/10' : 'bg-accent/10')}
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className="relative h-4.5 w-4.5" />
                <span className="relative">{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <motion.div key={active.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Card className="p-5 sm:p-7">
            {isDesktop && (
              <div className="mb-6 border-b border-line pb-5">
                <h2 className={cn('text-lg font-bold', active.danger && 'text-red-500')}>{active.label}</h2>
                <p className="text-sm text-muted">{active.hint}</p>
              </div>
            )}
            <Section />
          </Card>
        </motion.div>
      </div>
    </div>
  );
};

export default Settings;
