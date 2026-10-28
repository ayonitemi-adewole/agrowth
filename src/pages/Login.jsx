import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { toast } from 'react-toastify';
import { ArrowRight, Lock, Mail, MailCheck } from 'lucide-react';
import { auth } from '../firebase';
import { useApp } from '../context/AppContext';
import AuthLayout from '../components/layout/AuthLayout';
import { Alert, Button, Input, Modal, PasswordInput } from '../components/ui';

const ERROR_MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Reset your password or try again later.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
};

const Login = () => {
  const { user } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);

  const redirectTo = location.state?.from || '/dashboard';

  if (user?.emailVerified && !isLoading) return <Navigate to={redirectTo} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setUnverified(false);

    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setIsLoading(true);
    try {
      const { user: signedIn } = await signInWithEmailAndPassword(auth, email, password);

      if (!signedIn.emailVerified) {
        await sendEmailVerification(signedIn);
        await signOut(auth);
        setUnverified(true);
        return;
      }

      toast.success(`Welcome back${signedIn.displayName ? `, ${signedIn.displayName}` : ''}!`);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(ERROR_MESSAGES[err.code] || `Couldn't sign in: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const openReset = () => {
    setResetEmail(email);
    setResetOpen(true);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (!resetEmail) return;
    setResetSending(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      toast.success('Password reset email sent. Check your inbox.');
      setResetOpen(false);
    } catch (err) {
      toast.error(ERROR_MESSAGES[err.code] || `Couldn't send reset email: ${err.message}`);
    } finally {
      setResetSending(false);
    }
  };

  return (
    <AuthLayout title="Welcome back 👋" subtitle="Sign in to check on your farms and wallet.">
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        {unverified && (
          <Alert tone="info" title="Verify your email to continue">
            We’ve sent a fresh verification link to <strong>{email}</strong>. Open it, then sign in again.
          </Alert>
        )}

        <Input
          label="Email address"
          type="email"
          icon={Mail}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordInput
          label="Password"
          icon={Lock}
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          labelAction={
            <button type="button" onClick={openReset} className="text-sm font-semibold text-accent hover:underline">
              Forgot password?
            </button>
          }
        />

        <Button type="submit" size="lg" className="w-full" loading={isLoading} iconRight={ArrowRight}>
          Sign in
        </Button>

        <p className="text-center text-sm text-muted">
          New to Agrowth?{' '}
          <Link to="/sign-up" className="font-semibold text-accent hover:underline">
            Create an account
          </Link>
        </p>
      </form>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset your password"
        description="We'll email you a secure link to choose a new password."
      >
        <form onSubmit={handleReset} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            icon={MailCheck}
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            required
          />
          <Button type="submit" className="w-full" loading={resetSending} disabled={!resetEmail}>
            Send reset link
          </Button>
        </form>
      </Modal>
    </AuthLayout>
  );
};

export default Login;
