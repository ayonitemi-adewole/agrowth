import { useState } from 'react';
import { toast } from 'react-toastify';
import { Activity, Megaphone, Sprout } from 'lucide-react';
import { Switch } from '../ui';

const OPTIONS = [
  { key: 'accountActivity', label: 'Account activity', hint: 'Deposits, withdrawals and sign-ins', icon: Activity },
  { key: 'investment', label: 'Investment updates', hint: 'Cycle starts, milestones and payouts', icon: Sprout },
  { key: 'promotions', label: 'News & offers', hint: 'New farms and special opportunities', icon: Megaphone },
];

const DEFAULTS = { accountActivity: true, investment: true, promotions: false };

const load = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('notificationSettings') || '{}') };
  } catch {
    return DEFAULTS;
  }
};

const NotificationSettings = () => {
  const [settings, setSettings] = useState(load);

  const toggle = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      localStorage.setItem('notificationSettings', JSON.stringify(next));
      toast.success('Preferences saved', { toastId: 'notifications', autoClose: 1500 });
    } catch {
      toast.error('Could not save preferences on this device.');
    }
  };

  return (
    <div className="divide-y divide-line">
      {OPTIONS.map(({ key, label, hint, icon: Icon }) => (
        <div key={key} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Icon className="h-5 w-5" />
          </span>
          <label htmlFor={`notify-${key}`} className="flex-1 cursor-pointer">
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-xs text-muted">{hint}</span>
          </label>
          <Switch id={`notify-${key}`} checked={settings[key]} onChange={(value) => toggle(key, value)} label={label} />
        </div>
      ))}
    </div>
  );
};

export default NotificationSettings;
