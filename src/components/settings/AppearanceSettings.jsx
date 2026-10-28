import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ACCENT_PRESETS, readableTextOn } from '../../lib/color';
import { cn } from '../../lib/format';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun, preview: 'bg-[#f4f7f5]', surface: 'bg-white', line: 'bg-[#e1e8e4]' },
  { value: 'dark', label: 'Dark', icon: Moon, preview: 'bg-[#0a110f]', surface: 'bg-[#17221e]', line: 'bg-[#22302b]' },
  { value: 'system', label: 'System', icon: Monitor, preview: 'bg-gradient-to-r from-[#f4f7f5] from-50% to-[#0a110f] to-50%', surface: 'bg-white/70', line: 'bg-[#8c9a95]/40' },
];

const AppearanceSettings = () => {
  const { themePreference, accent, setAccent, updateAppearance } = useApp();
  const saveTimer = useRef(null);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const save = (changes) =>
    updateAppearance(changes)
      .then(() => toast.success('Appearance saved', { toastId: 'appearance', autoClose: 1500 }))
      .catch((err) => {
        console.error(err);
        toast.error('Could not save your preferences.', { toastId: 'appearance-error' });
      });

  // The native colour picker fires on every drag; preview live and save once it settles
  const handleCustomColor = (value) => {
    setAccent(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save({ accent: value }), 600);
  };

  const isPreset = ACCENT_PRESETS.some((p) => p.value.toLowerCase() === accent.toLowerCase());

  return (
    <div className="space-y-8">
      <section>
        <h3 className="font-bold">Theme</h3>
        <p className="mb-4 text-sm text-muted">Choose how Agrowth looks on this and your other devices.</p>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map(({ value, label, icon: Icon, preview, surface, line }) => {
            const selected = themePreference === value;
            return (
              <button
                key={value}
                onClick={() => save({ theme: value })}
                className={cn('rounded-2xl border-2 p-2 text-left transition', selected ? 'border-accent' : 'border-line hover:border-muted/50')}
                aria-pressed={selected}
              >
                <div className={cn('flex h-20 flex-col gap-1.5 overflow-hidden rounded-xl p-2.5', preview)}>
                  <div className={cn('h-3 w-2/3 rounded', surface)} />
                  <div className="h-3 w-1/3 rounded bg-accent" />
                  <div className={cn('mt-auto h-2 w-full rounded', line)} />
                </div>
                <div className="mt-2 flex items-center justify-between px-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Icon className="h-4 w-4" /> {label}
                  </span>
                  {selected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-on-accent">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="font-bold">Accent colour</h3>
        <p className="mb-4 text-sm text-muted">Used for buttons, highlights and your balance card.</p>
        <div className="flex flex-wrap gap-3">
          {ACCENT_PRESETS.map(({ name, value }) => {
            const selected = accent.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={value}
                onClick={() => save({ accent: value })}
                className={cn('flex h-11 w-11 items-center justify-center rounded-full transition hover:scale-110', selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
                style={{ backgroundColor: value, color: readableTextOn(value) }}
                aria-label={name}
                title={name}
              >
                {selected && <Check className="h-5 w-5" strokeWidth={3} />}
              </button>
            );
          })}
          <label
            className={cn(
              'relative flex h-11 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-line transition hover:scale-110',
              !isPreset && 'border-solid ring-2 ring-accent ring-offset-2 ring-offset-surface'
            )}
            style={!isPreset ? { backgroundColor: accent } : { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
            title="Custom colour"
          >
            <input type="color" value={accent} onChange={(e) => handleCustomColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom accent colour" />
          </label>
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-bold">Preview</h3>
        <div className="accent-gradient rounded-3xl p-5 text-white">
          <p className="text-xs text-white/75">Total balance</p>
          <p className="text-2xl font-extrabold">₦ 125,000</p>
        </div>
        <div className="mt-3 flex gap-2">
          <span className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent">Primary</span>
          <span className="rounded-xl bg-accent/12 px-4 py-2 text-sm font-semibold text-accent">Soft</span>
          <span className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">Outline</span>
        </div>
      </section>
    </div>
  );
};

export default AppearanceSettings;
