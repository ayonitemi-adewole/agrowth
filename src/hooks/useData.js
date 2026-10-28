import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { toDate } from '../lib/format';

const byNewest = (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);

export const useNow = (intervalMs = 60000) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

export const useInvestments = (uid) => {
  const [state, setState] = useState({ data: [], loading: true });

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      collection(db, 'users', uid, 'investments'),
      (snapshot) => {
        const now = new Date();
        const data = snapshot.docs.map((docSnap) => {
          const inv = { id: docSnap.id, ...docSnap.data() };
          // Activate pending investments once their start date has passed
          const start = toDate(inv.startDate);
          if (inv.status === 'Pending' && start && now >= start) {
            updateDoc(docSnap.ref, { status: 'Active' }).catch((err) => console.error('Error activating investment:', err));
            inv.status = 'Active';
          }
          return inv;
        });
        setState({ data: data.sort(byNewest), loading: false });
      },
      (error) => {
        console.error('Error loading investments:', error);
        setState({ data: [], loading: false });
      }
    );
  }, [uid]);

  return { investments: state.data, loading: state.loading };
};

export const useInvestment = (uid, id, initial) => {
  const [investment, setInvestment] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (!uid || !id) return undefined;
    return onSnapshot(
      doc(db, 'users', uid, 'investments', id),
      (snap) => {
        if (snap.exists()) setInvestment({ id: snap.id, ...snap.data() });
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [uid, id]);

  return { investment, loading };
};

// Deposits are stored with `uid`, investments and withdrawals with `userId`
export const useTransactions = (uid) => {
  const [byField, setByField] = useState({ uid: null, userId: null });

  useEffect(() => {
    if (!uid) return undefined;
    const unsubscribers = ['uid', 'userId'].map((field) =>
      onSnapshot(
        query(collection(db, 'transactions'), where(field, '==', uid)),
        (snapshot) => setByField((prev) => ({ ...prev, [field]: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) })),
        (error) => {
          console.error('Error loading transactions:', error);
          setByField((prev) => ({ ...prev, [field]: [] }));
        }
      )
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [uid]);

  const transactions = useMemo(() => {
    const merged = new Map();
    [...(byField.uid || []), ...(byField.userId || [])].forEach((txn) => merged.set(txn.id, txn));
    return [...merged.values()].sort(byNewest);
  }, [byField]);

  return { transactions, loading: byField.uid === null || byField.userId === null };
};

export const useInvestmentProducts = () => {
  const [state, setState] = useState({ data: [], loading: true });

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'investmentProducts'),
        (snapshot) =>
          setState({
            data: snapshot.docs.map((d) => ({ id: d.id, name: d.data().name || d.id, ...d.data() })),
            loading: false,
          }),
        (error) => {
          console.error('Error loading investment products:', error);
          setState({ data: [], loading: false });
        }
      ),
    []
  );

  return { products: state.data, loading: state.loading };
};

export const useProduct = (id, initial) => {
  const [product, setProduct] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (!id) return undefined;
    return onSnapshot(
      doc(db, 'investmentProducts', id),
      (snap) => {
        if (snap.exists()) setProduct({ id: snap.id, name: snap.data().name || snap.id, ...snap.data() });
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id]);

  return { product, loading };
};

export const useQuickInvestments = () => {
  const [state, setState] = useState({ data: [], loading: true });

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'quickInvestments'),
        (snapshot) => setState({ data: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false }),
        (error) => {
          console.error('Error loading quick investments:', error);
          setState({ data: [], loading: false });
        }
      ),
    []
  );

  return { quickInvestments: state.data, loading: state.loading };
};

let banksCache = null;

export const useBanks = () => {
  const [banks, setBanks] = useState(banksCache || []);
  const [loading, setLoading] = useState(!banksCache);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (banksCache) return;
    let cancelled = false;
    fetch('https://api.paystack.co/bank')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.status) return;
        // Paystack lists a few banks twice under different slugs
        const unique = new Map(data.data.map((bank) => [bank.code, { name: bank.name, code: bank.code }]));
        banksCache = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
        setBanks(banksCache);
      })
      .catch((err) => {
        console.error('Error fetching banks:', err);
        if (!cancelled) setError(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { banks, loading, error };
};
