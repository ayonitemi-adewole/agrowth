import { useEffect, useRef, useState } from 'react';
import { RecaptchaVerifier, linkWithPhoneNumber } from 'firebase/auth';
import { toast } from 'react-toastify';
import { MessageSquareCode, Smartphone, ShieldCheck } from 'lucide-react';
import { auth } from '../../firebase';
import { Alert, Badge, Button, Input } from '../ui';

const TwoFactorAuth = () => {
  const linkedPhone = auth.currentUser?.phoneNumber;
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [enabledPhone, setEnabledPhone] = useState(linkedPhone || '');
  const verifier = useRef(null);

  useEffect(() => () => verifier.current?.clear(), []);

  const sendOTP = async () => {
    setError('');
    if (!/^\+\d{10,15}$/.test(phone)) {
      setError('Enter your number in international format, e.g. +2348012345678.');
      return;
    }
    setBusy(true);
    try {
      verifier.current ??= new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      setConfirmation(await linkWithPhoneNumber(auth.currentUser, phone, verifier.current));
      toast.success('Code sent to your phone');
    } catch (err) {
      console.error(err);
      setError(`Failed to send code: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const verifyOTP = async () => {
    setError('');
    setBusy(true);
    try {
      await confirmation.confirm(otp);
      setEnabledPhone(phone);
      setConfirmation(null);
      setOtp('');
      toast.success('Two-factor authentication enabled');
    } catch (err) {
      console.error(err);
      setError('Invalid code or linking failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-accent" />
        <h3 className="font-bold">Two-factor authentication</h3>
        {enabledPhone ? <Badge className="bg-accent/12 text-accent">On</Badge> : <Badge className="bg-surface-2 text-muted">Off</Badge>}
      </div>
      <p className="text-sm text-muted">Add an extra layer of security by linking your phone number. We’ll send a one-time code to confirm it.</p>

      {error && <Alert tone="error">{error}</Alert>}

      {enabledPhone ? (
        <Alert tone="success">Your account is linked to {enabledPhone}.</Alert>
      ) : (
        <div className="space-y-4">
          <Input
            label="Phone number"
            icon={Smartphone}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
            placeholder="+2348012345678"
            disabled={Boolean(confirmation)}
          />
          {confirmation && (
            <Input
              label="Verification code"
              icon={MessageSquareCode}
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              autoFocus
            />
          )}
          <div className="flex justify-end gap-2">
            {confirmation ? (
              <>
                <Button variant="ghost" onClick={() => setConfirmation(null)} disabled={busy}>
                  Change number
                </Button>
                <Button onClick={verifyOTP} loading={busy} disabled={otp.length < 6}>
                  Verify & enable
                </Button>
              </>
            ) : (
              <Button variant="soft" onClick={sendOTP} loading={busy} disabled={!phone}>
                Send code
              </Button>
            )}
          </div>
        </div>
      )}
      <div id="recaptcha-container" />
    </div>
  );
};

export default TwoFactorAuth;
