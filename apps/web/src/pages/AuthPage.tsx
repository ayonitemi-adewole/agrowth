import { MapPinned, ShieldCheck, Sprout, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { DemoSignIn } from '../components/DemoSignIn';
import { Logo } from '../components/Layout';
import { Alert, Button, Field, Input } from '../components/ui';
import { demo } from '../lib/demo';
import { errorMessage } from '../lib/errors';

const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: 'Trustee custody',
    text: 'Funds sit with a licensed trustee, never the platform.',
  },
  {
    icon: MapPinned,
    title: 'Verified farms',
    text: 'Every farm is mapped and visited before money moves.',
  },
  {
    icon: Wallet,
    title: 'Staged, in-kind release',
    text: 'Paid to input vendors, milestone by milestone.',
  },
];

export function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { session, signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  if (session) return <Navigate to="/" replace />;

  // A hosted demo leads with the role picker; nobody signs up there.
  const showcase = demo.hosted && demo.accounts.length > 0;
  if (showcase && mode === 'sign-up') return <Navigate to="/sign-in" replace />;
  const isSignUp = mode === 'sign-up';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!isSignUp) {
        await signIn(email.trim(), password);
      } else {
        const { needsConfirmation } = await signUp({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          phone: phone.trim(),
        });
        setConfirmSent(needsConfirmation);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute -top-32 -right-32 size-[32rem] rounded-full bg-brand-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-20 size-[28rem] rounded-full bg-brand-300/10 blur-3xl"
          aria-hidden
        />
        <Logo inverted />
        <div className="relative max-w-md">
          <Sprout className="mb-6 size-10 text-brand-300" aria-hidden />
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            Farm finance you can verify, from wallet to field to buyer.
          </h2>
          <ul className="mt-10 space-y-5">
            {PRINCIPLES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-brand-300">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-brand-100/70">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-200/50">Agrowth 2.0</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-xl">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          {showcase ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                Explore the demo
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Sign in as anyone on the team. Each role sees and does only what its job allows, and
                the database enforces it. The data is a sample portfolio.
              </p>
              <div className="mt-8">
                <DemoSignIn detailed />
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                {isSignUp ? 'Create your account' : 'Welcome back'}
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                {isSignUp
                  ? 'Staff accounts are given a role by an admin after sign-up.'
                  : 'Sign in to your Agrowth workspace.'}
              </p>
            </>
          )}

          {/* In a hosted demo the role buttons replace the form. */}
          <div className={showcase ? 'hidden' : 'mt-8'}>
            {confirmSent ? (
              <Alert tone="success" title="Check your email">
                We've sent a confirmation link. Open it, then come back and sign in.
              </Alert>
            ) : (
              <form onSubmit={submit} className="space-y-5">
                {isSignUp && (
                  <>
                    <Field label="Full name">
                      <Input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        minLength={2}
                        autoComplete="name"
                      />
                    </Field>
                    <Field label="Phone" hint="Optional">
                      <Input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        pattern="\+?[0-9]{10,15}"
                        title="10–15 digits, optionally starting with +"
                        placeholder="+2348012345678"
                        autoComplete="tel"
                      />
                    </Field>
                  </>
                )}
                <Field label="Email">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </Field>
                <Field label="Password" hint={isSignUp ? 'At least 10 characters' : undefined}>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={isSignUp ? 10 : undefined}
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  />
                </Field>
                {error && <Alert>{error}</Alert>}
                <Button type="submit" busy={busy} className="w-full">
                  {isSignUp ? 'Create account' : 'Sign in'}
                </Button>
              </form>
            )}
          </div>

          {!isSignUp && !showcase && <DemoSignIn />}

          <p className={showcase ? 'hidden' : 'mt-8 text-sm text-zinc-500'}>
            {isSignUp ? 'Already have an account? ' : 'New to Agrowth? '}
            <Link
              to={isSignUp ? '/sign-in' : '/sign-up'}
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              {isSignUp ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
