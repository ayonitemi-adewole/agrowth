import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { toast } from 'react-toastify';
import { KeyRound, Lock } from 'lucide-react';
import { auth } from '../../firebase';
import { Alert, Button, PasswordInput } from '../ui';
import PasswordStrength from '../PasswordStrength';
import TwoFactorAuth from './TwoFactorAuth';

const SecuritySettings = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const mismatch = confirmPassword && newPassword !== confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    const user = auth.currentUser;
    if (!user?.email) {
      setError('No authenticated user.');
      return;
    }

    setSaving(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      await updatePassword(user, newPassword);
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') setError('Your current password is incorrect.');
      else if (err.code === 'auth/too-many-requests') setError('Too many attempts. Please try again later.');
      else setError(err.message || 'An error occurred while updating your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-10">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-accent" />
          <h3 className="font-bold">Change password</h3>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <PasswordInput label="Current password" icon={Lock} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
        <PasswordInput label="New password" icon={Lock} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
        <PasswordStrength password={newPassword} />
        <PasswordInput
          label="Confirm new password"
          icon={Lock}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          error={mismatch ? "Passwords don't match" : ''}
          required
        />
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!currentPassword || !newPassword || mismatch}>
            Update password
          </Button>
        </div>
      </form>

      <div className="border-t border-line pt-8">
        <TwoFactorAuth />
      </div>
    </div>
  );
};

export default SecuritySettings;
