import { toDate } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

// "Fast Vegetables" is the quick-invest product: its period is in days and it starts on purchase
export const isQuickInvestment = (inv) => inv?.productName === 'Fast Vegetables';

export const getStartDate = (inv) => toDate(isQuickInvestment(inv) ? inv.createdAt : inv.startDate);

export const getTotalDays = (inv) =>
  isQuickInvestment(inv) ? Number(inv.investmentPeriod) || 0 : (Number(inv.investmentPeriod) || 0) * 30;

export const getMaturityDate = (inv) => {
  const start = getStartDate(inv);
  return start ? new Date(start.getTime() + getTotalDays(inv) * DAY_MS) : null;
};

export const getProgress = (inv, now = new Date()) => {
  if (inv.status === 'Completed') return 100;
  const start = getStartDate(inv);
  const duration = getTotalDays(inv) * DAY_MS;
  if (!start || !duration) return 0;
  return Math.min(Math.max(((now - start) / duration) * 100, 0), 100);
};

export const getTimeLeft = (inv, now = new Date()) => {
  const end = getMaturityDate(inv);
  if (!end) return { ms: 0, label: '—' };
  const ms = end - now;
  if (ms <= 0) return { ms: 0, label: 'Matured' };
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return { ms, label: `${days} day${days === 1 ? '' : 's'} left` };
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / 60000);
  return { ms, label: `${hours}h ${minutes}m left` };
};

export const getExpectedProfit = (inv) => ((Number(inv.investmentAmount) || 0) * (Number(inv.expectedROI) || 0)) / 100;

export const getPeriodLabel = (inv) => {
  const period = Number(inv.investmentPeriod) || 0;
  return isQuickInvestment(inv)
    ? `${period} day${period === 1 ? '' : 's'}`
    : `${period} month${period === 1 ? '' : 's'}`;
};

export const STATUS_STYLES = {
  Active: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  Pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  Completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};

const CROP_EMOJI = [
  [/pepper|chili/i, '🌶️'],
  [/tomato/i, '🍅'],
  [/maize|corn/i, '🌽'],
  [/rice|wheat|grain|sorghum|millet/i, '🌾'],
  [/yam|potato|cassava/i, '🍠'],
  [/cucumber/i, '🥒'],
  [/onion/i, '🧅'],
  [/carrot/i, '🥕'],
  [/pineapple/i, '🍍'],
  [/plantain|banana/i, '🍌'],
  [/water ?melon/i, '🍉'],
  [/okra|okro|bean|soy|groundnut|peanut/i, '🫛'],
  [/vegetable|lettuce|cabbage|spinach|ugwu/i, '🥬'],
  [/cocoa|coffee/i, '🫘'],
  [/poultry|chicken|egg/i, '🐔'],
  [/fish/i, '🐟'],
];

export const cropEmoji = (name = '') => CROP_EMOJI.find(([pattern]) => pattern.test(name))?.[1] || '🌱';
