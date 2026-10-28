const DAY_MS = 24 * 60 * 60 * 1000;

// Firestore data mixes ISO strings, Timestamps and serialized {seconds} maps
export const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const nairaFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatNaira = (amount, { compact = false } = {}) => {
  const value = Number(amount) || 0;
  return (compact && Math.abs(value) >= 100000 ? compactFormatter : nairaFormatter).format(value);
};

export const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-NG');

export const formatDate = (value, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  const date = toDate(value);
  return date ? date.toLocaleDateString('en-NG', options) : '—';
};

export const formatTime = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' }) : '';
};

export const dayLabel = (value) => {
  const date = toDate(value);
  if (!date) return 'Unknown date';
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return formatDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// Keeps only digits so amount inputs can show thousands separators
export const parseAmount = (raw) => raw.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

export const cn = (...classes) => classes.filter(Boolean).join(' ');
