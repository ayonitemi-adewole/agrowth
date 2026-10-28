import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteUser } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { PauseCircle, Trash2 } from 'lucide-react';
import { auth, db } from '../../firebase';
import { Alert, Button, Input, Modal } from '../ui';

const CONFIRM_WORD = 'DELETE';
const RECENT_LOGIN_MS = 4 * 60 * 1000;

const deleteInvestorRecords = async (parentCollection, uid) => {
  const parents = await getDocs(collection(db, parentCollection));
  await Promise.all(
    parents.docs.map(async (parent) => {
      const records = await getDocs(query(collection(parent.ref, 'investors'), where('uid', '==', uid)));
      return Promise.all(records.docs.map((record) => deleteDoc(record.ref)));
    })
  );
};

const DangerZone = () => {
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (busy) return;
    setModal(null);
    setConfirmText('');
    setError('');
  };

  const handleDeactivate = async () => {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { isActive: false });
      toast.success('Account deactivated');
      setModal(null);
    } catch (err) {
      console.error(err);
      setError('There was an issue deactivating your account. Please try again later.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setError('');

    // Firebase rejects deleteUser() for stale sessions; check first so data isn't wiped while the account survives
    const lastSignIn = new Date(user.metadata.lastSignInTime).getTime();
    if (!lastSignIn || Date.now() - lastSignIn > RECENT_LOGIN_MS) {
      setError('For your security, please sign out and sign back in, then try again.');
      return;
    }

    setBusy(true);
    try {
      // Deposits are keyed by `uid`, investments and withdrawals by `userId`
      for (const field of ['userId', 'uid']) {
        const txns = await getDocs(query(collection(db, 'transactions'), where(field, '==', user.uid)));
        await Promise.all(txns.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, 'users', user.uid));
      await deleteInvestorRecords('quickInvestments', user.uid);
      await deleteInvestorRecords('investmentProducts', user.uid);
      await deleteUser(user);

      toast.success('Your account has been deleted.');
      navigate('/sign-up', { replace: true });
    } catch (err) {
      console.error(err);
      setError(
        err.code === 'auth/requires-recent-login'
          ? 'For your security, please sign out and sign back in, then try again.'
          : 'There was an issue deleting your account. Please try again later.'
      );
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 sm:flex-row sm:items-center">
        <PauseCircle className="h-8 w-8 shrink-0 text-amber-500" />
        <div className="flex-1">
          <h3 className="font-bold">Deactivate account</h3>
          <p className="text-sm text-muted">Temporarily pause your account. You can reactivate it later.</p>
        </div>
        <Button variant="outline" onClick={() => setModal('deactivate')}>
          Deactivate
        </Button>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-red-500/30 bg-red-500/5 p-5 sm:flex-row sm:items-center">
        <Trash2 className="h-8 w-8 shrink-0 text-red-500" />
        <div className="flex-1">
          <h3 className="font-bold">Delete account</h3>
          <p className="text-sm text-muted">Permanently remove your account, investments and transaction history.</p>
        </div>
        <Button variant="danger" onClick={() => setModal('delete')}>
          Delete
        </Button>
      </div>

      <Modal
        open={modal === 'deactivate'}
        onClose={close}
        title="Deactivate your account?"
        description="Your data is kept and you can reactivate later."
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="warning" className="flex-1" onClick={handleDeactivate} loading={busy}>
              Deactivate
            </Button>
          </>
        }
      >
        {error ? <Alert tone="error">{error}</Alert> : <p className="text-sm text-muted">You won’t receive updates while your account is deactivated.</p>}
      </Modal>

      <Modal
        open={modal === 'delete'}
        onClose={close}
        title="Delete your account permanently?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={handleDelete} loading={busy} disabled={confirmText !== CONFIRM_WORD}>
              Delete forever
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning">All your investments, balances and transaction history will be lost. Withdraw any funds first.</Alert>
          {error && <Alert tone="error">{error}</Alert>}
          <Input
            label={
              <>
                Type <span className="font-mono text-red-500">{CONFIRM_WORD}</span> to confirm
              </>
            }
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>
      </Modal>
    </div>
  );
};

export default DangerZone;
