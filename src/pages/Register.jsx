import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { createUserWithEmailAndPassword, sendEmailVerification, signOut, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { ArrowRight, Gift, Lock, Mail, MailCheck, Phone, User } from 'lucide-react';
import { auth, db } from '../firebase';
import { useApp } from '../context/AppContext';
import AuthLayout from '../components/layout/AuthLayout';
import { Alert, Button, Input, PasswordInput } from '../components/ui';
import PasswordStrength from '../components/PasswordStrength';

const Register = () => {
  const { user } = useApp();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phoneNumber: '', password: '', confirmPassword: '', referralCode: '' });
  const [showReferral, setShowReferral] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const mismatch = useMemo(() => form.confirmPassword && form.password !== form.confirmPassword, [form.password, form.confirmPassword]);

  if (user?.emailVerified && !isLoading && !registeredEmail) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const { firstName, lastName, email, phoneNumber, password, confirmPassword, referralCode } = form;

    if (!firstName || !lastName || !email || !phoneNumber || !password || !confirmPassword) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    try {
      const { user: created } = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(created);
      await updateProfile(created, {
        displayName: firstName,
        photoURL: 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_960_720.png',
      });
      await setDoc(doc(db, 'users', created.uid), {
        firstName,
        lastName,
        availableBalance: 0,
        investmentBalance: 0,
        uid: created.uid,
        email: created.email,
        phoneNumber,
        referralCode,
        createdAt: new Date().toISOString(),
      });
      // Sign-in is only allowed once the email is verified
      await signOut(auth);
      setRegisteredEmail(email);
    } catch (err) {
      const messages = {
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/invalid-email': 'That email address looks invalid.',
        'auth/weak-password': 'Please choose a stronger password.',
      };
      setError(messages[err.code] || `Couldn't create your account: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (registeredEmail) {
    return (
      <AuthLayout title="Check your inbox" subtitle="One last step before you start investing.">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-3xl border border-line bg-surface p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <MailCheck className="h-8 w-8" />
          </div>
          <h2 className="mt-5 text-lg font-bold">Verify your email</h2>
          <p className="mt-2 text-sm text-muted">
            We sent a verification link to <strong className="text-fg">{registeredEmail}</strong>. Click it to activate your account, then sign in.
          </p>
          <Button to="/sign-in" className="mt-6 w-full" iconRight={ArrowRight}>
            Continue to sign in
          </Button>
          <p className="mt-4 text-xs text-muted">Can’t find it? Check your spam folder.</p>
        </motion.div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="Start growing your money with agriculture in minutes.">
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" icon={User} autoComplete="given-name" placeholder="Ada" value={form.firstName} onChange={update('firstName')} required />
          <Input label="Last name" autoComplete="family-name" placeholder="Okafor" value={form.lastName} onChange={update('lastName')} required />
        </div>
        <Input label="Email address" type="email" icon={Mail} autoComplete="email" placeholder="you@example.com" value={form.email} onChange={update('email')} required />
        <Input
          label="Phone number"
          type="tel"
          icon={Phone}
          autoComplete="tel"
          placeholder="0801 234 5678"
          value={form.phoneNumber}
          onChange={update('phoneNumber')}
          required
        />
        <PasswordInput label="Password" icon={Lock} autoComplete="new-password" placeholder="Create a password" value={form.password} onChange={update('password')} required />
        <PasswordStrength password={form.password} />
        <PasswordInput
          label="Confirm password"
          icon={Lock}
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          error={mismatch ? "Passwords don't match" : ''}
          required
        />

        <AnimatePresence initial={false}>
          {showReferral ? (
            <motion.div key="ref" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <Input label="Referral code (optional)" icon={Gift} placeholder="e.g. FARM2025" value={form.referralCode} onChange={update('referralCode')} />
            </motion.div>
          ) : (
            <button type="button" onClick={() => setShowReferral(true)} className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
              <Gift className="h-4 w-4" /> Have a referral code?
            </button>
          )}
        </AnimatePresence>

        <Button type="submit" size="lg" className="w-full" loading={isLoading} iconRight={ArrowRight}>
          Create account
        </Button>

        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/sign-in" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default Register;
