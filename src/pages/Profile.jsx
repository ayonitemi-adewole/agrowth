import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { signOut } from 'firebase/auth';
import { toast } from 'react-toastify';
import { Bell, ChevronRight, CreditCard, History, LogOut, Moon, Palette, Pencil, ShieldCheck, Sprout, TriangleAlert, UserRound } from 'lucide-react';
import { auth } from '../firebase';
import { useApp } from '../context/AppContext';
import { cn, formatDate, formatNaira } from '../lib/format';
import { Avatar, Badge, Button, Card, Modal, Switch } from '../components/ui';

const MenuItem = ({ icon: Icon, label, hint, to, onClick, trailing, danger }) => {
  const content = (
    <>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', danger ? 'bg-red-500/12 text-red-500' : 'bg-accent/10 text-accent')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-semibold', danger && 'text-red-500')}>{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
      {trailing ?? <ChevronRight className="h-5 w-5 text-muted" />}
    </>
  );
  const classes = 'flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-surface-2/70';
  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }
  if (!onClick) return <div className={classes}>{content}</div>;
  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
};

const MenuGroup = ({ title, children }) => (
  <section>
    <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted">{title}</h2>
    <Card className="divide-y divide-line overflow-hidden">{children}</Card>
  </section>
);

const Profile = () => {
  const navigate = useNavigate();
  const { user, profile, displayName, availableBalance, investmentBalance, theme, updateAppearance } = useApp();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const fullName = [profile?.firstName || displayName, profile?.lastName].filter(Boolean).join(' ');

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut(auth);
      toast.success('Signed out. See you soon!');
      navigate('/sign-in', { replace: true });
    } catch (err) {
      console.error('Sign out error:', err);
      toast.error('Could not sign out. Please try again.');
      setLoggingOut(false);
    }
  };

  const toggleDark = (dark) => updateAppearance({ theme: dark ? 'dark' : 'light' }).catch(() => toast.error('Theme changed on this device only.'));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          <div className="accent-gradient h-24" />
          <div className="-mt-12 flex flex-col items-center px-6 pb-6 text-center">
            <div className="relative">
              <Avatar src={user?.photoURL} name={fullName} size={96} className="ring-4" />
              <Link
                to="/settings/profile"
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent shadow-md ring-4 ring-surface"
                aria-label="Edit profile"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>
            <h1 className="mt-3 text-xl font-extrabold tracking-tight">{fullName}</h1>
            <p className="text-sm text-muted">{user?.email}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {user?.emailVerified && (
                <Badge className="bg-accent/12 text-accent">
                  <ShieldCheck className="h-3.5 w-3.5" /> Verified
                </Badge>
              )}
              {user?.metadata?.creationTime && <Badge className="bg-surface-2 text-muted">Member since {formatDate(user.metadata.creationTime, { month: 'short', year: 'numeric' })}</Badge>}
            </div>

            <div className="mt-6 grid w-full grid-cols-2 gap-3">
              <div className="rounded-2xl bg-surface-2/70 p-4 text-left">
                <p className="text-xs text-muted">Available</p>
                <p className="font-extrabold tabular-nums">{formatNaira(availableBalance)}</p>
              </div>
              <div className="rounded-2xl bg-surface-2/70 p-4 text-left">
                <p className="text-xs text-muted">Invested</p>
                <p className="font-extrabold tabular-nums">{formatNaira(investmentBalance)}</p>
              </div>
            </div>
            <Button to="/transact/deposit" className="mt-4 w-full">
              Fund account
            </Button>
          </div>
        </Card>
      </motion.div>

      <MenuGroup title="Account">
        <MenuItem icon={UserRound} label="Personal details" hint="Name, phone and photo" to="/settings/profile" />
        <MenuItem icon={ShieldCheck} label="Security" hint="Password and two-factor authentication" to="/settings/security" />
        <MenuItem icon={CreditCard} label="Withdrawal details" hint="Bank account for payouts" to="/settings/withdrawals" />
      </MenuGroup>

      <MenuGroup title="Activity">
        <MenuItem icon={Sprout} label="My investments" to="/invest" />
        <MenuItem icon={History} label="Transaction history" to="/transact" />
      </MenuGroup>

      <MenuGroup title="Preferences">
        <MenuItem icon={Moon} label="Dark mode" trailing={<Switch checked={theme === 'dark'} onChange={toggleDark} label="Dark mode" />} />
        <MenuItem icon={Palette} label="Appearance" hint="Theme and accent colour" to="/settings/appearance" />
        <MenuItem icon={Bell} label="Notifications" to="/settings/notifications" />
      </MenuGroup>

      <MenuGroup title="Other">
        <MenuItem icon={LogOut} label="Sign out" onClick={() => setLogoutOpen(true)} />
        <MenuItem icon={TriangleAlert} label="Danger zone" hint="Deactivate or delete your account" to="/settings/danger" danger />
      </MenuGroup>

      <p className="pb-4 text-center text-xs text-muted">Agrowth · Grow with every harvest</p>

      <Modal
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Sign out?"
        description="You'll need your email and password to sign back in."
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setLogoutOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={handleLogout} loading={loggingOut} icon={LogOut}>
              Sign out
            </Button>
          </>
        }
      />
    </div>
  );
};

export default Profile;
