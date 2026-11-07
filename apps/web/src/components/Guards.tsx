import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { can } from '../lib/roles';
import type { Role } from '../lib/types';
import { Logo } from './Layout';
import { Button, Card, Spinner } from './ui';

/** Sends signed-out visitors to sign in; holds non-staff on a waiting page. */
export function RequireStaff() {
  const { session, profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/sign-in" replace state={{ from: location }} />;

  if (!profile || !profile.is_active || !can.useStaffApp(profile.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center">
            <Logo />
          </div>
          <Card>
            <ShieldAlert className="mb-3 size-6 text-amber-600" aria-hidden />
            <h1 className="text-lg font-semibold text-zinc-900">
              {profile && !profile.is_active ? 'Your account is deactivated' : 'Waiting for access'}
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              {profile && !profile.is_active
                ? 'Contact an Agrowth admin if you think this is a mistake.'
                : 'Your account exists, but an admin still needs to give you a staff role. The investor portal is coming in a later release.'}
            </p>
            <p className="mt-3 text-xs text-zinc-500">Signed in as {session.user.email}</p>
            <Button variant="secondary" className="mt-5" onClick={signOut}>
              Sign out
            </Button>
          </Card>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

/** Shows children only to the given roles; everyone else gets a short notice. */
export function RoleGate({
  allow,
  children,
}: {
  allow: (role?: Role) => boolean;
  children: ReactNode;
}) {
  const { profile } = useAuth();
  if (!allow(profile?.role)) {
    return <p className="text-sm text-zinc-600">Your role does not have access to this page.</p>;
  }
  return <>{children}</>;
}
