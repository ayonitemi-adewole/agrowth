import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Lottie from 'lottie-react';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { AlertTriangle, RotateCcw, SearchX, UserX, XCircle } from 'lucide-react';
import { db } from '../firebase';
import { formatNaira } from '../lib/format';
import { Button, Logo, Spinner } from '../components/ui';
import successAnimation from '../animations/success.json';

const BASE_URL = 'https://smart-farmer-ercaspay-api.onrender.com';

const STATES = {
  failed: { icon: XCircle, tone: 'text-red-500 bg-red-500/12', title: 'Payment failed', text: "We couldn't confirm your payment. If you were charged, it will be reversed by your bank." },
  'user-not-found': { icon: UserX, tone: 'text-amber-500 bg-amber-500/15', title: 'Account not found', text: "We couldn't match this payment to an account. Please contact support with your reference." },
  invalid: { icon: SearchX, tone: 'text-red-500 bg-red-500/12', title: 'Invalid payment link', text: 'The transaction reference is missing or invalid.' },
  error: { icon: AlertTriangle, tone: 'text-red-500 bg-red-500/12', title: 'Something went wrong', text: "We couldn't verify your payment right now. Please check your wallet shortly or try again." },
};

const DepositSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { width, height } = useWindowSize();
  const [status, setStatus] = useState('verifying');
  const [amount, setAmount] = useState(0);
  const [newBalance, setNewBalance] = useState(0);
  const transRef = searchParams.get('transRef');
  const reference = searchParams.get('reference');

  // Guard against StrictMode's double effect run crediting the wallet twice
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const verifyPayment = async () => {
      if (!transRef || !reference) {
        setStatus('invalid');
        return;
      }

      try {
        const res = await fetch(`${BASE_URL}/api/ercaspay/verify-payment?transactionRef=${transRef}`);
        const data = await res.json();

        if (!(data.success && data.status === 'SUCCESSFUL')) {
          setStatus('failed');
          return;
        }

        let uid = null;
        try {
          const meta = typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata;
          uid = meta?.userId;
        } catch (parseError) {
          console.error('Metadata parsing failed:', parseError);
          setStatus('error');
          return;
        }

        const paidAmount = parseFloat(data.amount || 0);
        if (!uid || Number.isNaN(paidAmount) || paidAmount <= 0) {
          setStatus('error');
          return;
        }

        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          setStatus('user-not-found');
          return;
        }

        const txnSnapshot = await getDocs(query(collection(db, 'transactions'), where('reference', '==', reference)));
        if (txnSnapshot.empty) {
          setStatus('error');
          return;
        }

        const transactionDoc = txnSnapshot.docs[0];
        if (transactionDoc.data().status === 'successful') {
          navigate('/dashboard', { replace: true });
          return;
        }

        const updatedBalance = (userSnap.data().availableBalance || 0) + paidAmount;
        await updateDoc(userRef, { availableBalance: updatedBalance });
        await updateDoc(transactionDoc.ref, {
          status: 'successful',
          verifiedAt: new Date().toISOString(),
          transactionId: data.transactionReference || transRef,
          paymentMethod: data.paymentMethod || 'unknown',
          rawResponse: data,
        });

        setAmount(paidAmount);
        setNewBalance(updatedBalance);
        setStatus('success');
      } catch (err) {
        console.error('Verification error:', err);
        setStatus('error');
      }
    };

    verifyPayment();
  }, [transRef, reference, navigate]);

  const failure = STATES[status];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas p-5">
      {status === 'success' && <Confetti width={width} height={height} recycle={false} numberOfPieces={350} />}
      <Logo className="mb-8" to="/dashboard" />

      <motion.div
        key={status}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md rounded-[2rem] border border-line bg-surface p-8 text-center shadow-xl shadow-black/5"
      >
        {status === 'verifying' && (
          <div className="py-6">
            <Spinner className="h-12 w-12 border-4" />
            <h1 className="mt-6 text-xl font-extrabold">Confirming your payment</h1>
            <p className="mt-2 text-sm text-muted">This usually takes a few seconds. Please don’t close this page.</p>
          </div>
        )}

        {status === 'success' && (
          <>
            <Lottie animationData={successAnimation} loop={false} className="mx-auto -my-4 h-40 w-40" />
            <h1 className="text-2xl font-extrabold">Deposit successful 🎉</h1>
            <p className="mt-2 text-muted">Your wallet has been funded.</p>
            <p className="mt-6 text-4xl font-extrabold tracking-tight text-accent tabular-nums">+{formatNaira(amount)}</p>
            <div className="mt-6 flex justify-between rounded-2xl bg-surface-2/70 px-4 py-3 text-sm">
              <span className="text-muted">New balance</span>
              <span className="font-bold tabular-nums">{formatNaira(newBalance)}</span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button to="/invest" variant="secondary">
                Start investing
              </Button>
              <Button to="/dashboard">Go to dashboard</Button>
            </div>
          </>
        )}

        {failure && (
          <>
            <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${failure.tone}`}>
              <failure.icon className="h-8 w-8" />
            </div>
            <h1 className="mt-5 text-xl font-extrabold">{failure.title}</h1>
            <p className="mt-2 text-sm text-muted">{failure.text}</p>
            {reference && <p className="mt-4 break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs text-muted">Ref: {reference}</p>}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button to="/dashboard" variant="secondary">
                Dashboard
              </Button>
              <Button to="/transact/deposit" icon={RotateCcw}>
                Try again
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
};

export default DepositSuccess;
