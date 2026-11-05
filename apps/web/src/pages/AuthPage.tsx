import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Layout';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/errors';

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-in') {
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

  const isSignUp = mode === 'sign-up';

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card>
          <h1 className="mb-1 text-lg font-semibold text-stone-900">
            {isSignUp ? 'Create an account' : 'Sign in'}
          </h1>
          <p className="mb-5 text-sm text-stone-600">
            {isSignUp
              ? 'Staff accounts are activated by an admin after you sign up.'
              : 'Use the email and password for your Agrowth account.'}
          </p>

          {confirmSent ? (
            <Alert tone="success">
              Check your email for a confirmation link, then come back and sign in.
            </Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
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
                  <Field label="Phone (optional)">
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
        </Card>
        <p className="text-center text-sm text-stone-600">
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <Link to="/sign-in" className="font-medium text-green-800 hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{' '}
              <Link to="/sign-up" className="font-medium text-green-800 hover:underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
