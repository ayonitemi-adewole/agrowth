import { Check } from 'lucide-react';
import { cn } from '../lib/format';

const PASSWORD_RULES = [
  { label: '8+ characters', test: (p) => p.length >= 8 },
  { label: 'A number', test: (p) => /\d/.test(p) },
  { label: 'Upper & lowercase', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'A symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH = [
  { label: 'Too weak', color: 'bg-red-500' },
  { label: 'Weak', color: 'bg-red-500' },
  { label: 'Fair', color: 'bg-amber-500' },
  { label: 'Good', color: 'bg-lime-500' },
  { label: 'Strong', color: 'bg-emerald-500' },
];

const PasswordStrength = ({ password }) => {
  if (!password) return null;
  const passed = PASSWORD_RULES.filter((rule) => rule.test(password)).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {PASSWORD_RULES.map((rule, i) => (
            <div key={rule.label} className={cn('h-1.5 flex-1 rounded-full transition-colors', i < passed ? STRENGTH[passed].color : 'bg-line')} />
          ))}
        </div>
        <span className="w-14 text-right text-xs font-semibold text-muted">{STRENGTH[passed].label}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(password);
          return (
            <span key={rule.label} className={cn('flex items-center gap-1 text-xs', ok ? 'text-accent' : 'text-muted')}>
              <Check className={cn('h-3 w-3', !ok && 'opacity-30')} strokeWidth={3} /> {rule.label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default PasswordStrength;
