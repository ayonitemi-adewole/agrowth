import { forwardRef, useId, useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { cn, formatNumber, parseAmount } from '../../lib/format';

const controlClasses = (hasIcon, hasError) =>
  cn(
    'w-full h-12 rounded-xl border bg-surface px-4 text-[15px] text-fg placeholder:text-muted/70',
    'transition-all duration-150 outline-none',
    'focus:border-accent focus:ring-4 focus:ring-accent/15',
    'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
    hasIcon && 'pl-11',
    hasError ? 'border-red-500 focus:border-red-500 focus:ring-red-500/15' : 'border-line'
  );

export const Field = ({ label, hint, error, htmlFor, children, className, labelAction }) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    {(label || labelAction) && (
      <div className="flex items-center justify-between">
        {label && (
          <label htmlFor={htmlFor} className="text-sm font-semibold text-fg">
            {label}
          </label>
        )}
        {labelAction}
      </div>
    )}
    {children}
    {error ? (
      <p className="text-xs font-medium text-red-500">{error}</p>
    ) : (
      hint && <p className="text-xs text-muted">{hint}</p>
    )}
  </div>
);

export const Input = forwardRef(({ label, hint, error, icon: Icon, className, fieldClassName, labelAction, id, ...props }, ref) => {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={fieldClassName} labelAction={labelAction}>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted" />}
        <input ref={ref} id={inputId} className={cn(controlClasses(Icon, error), className)} aria-invalid={Boolean(error)} {...props} />
      </div>
    </Field>
  );
});
Input.displayName = 'Input';

export const PasswordInput = forwardRef(({ label, hint, error, icon: Icon, fieldClassName, labelAction, id, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={fieldClassName} labelAction={labelAction}>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted" />}
        <input
          ref={ref}
          id={inputId}
          type={visible ? 'text' : 'password'}
          className={cn(controlClasses(Icon, error), 'pr-12')}
          aria-invalid={Boolean(error)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
        </button>
      </div>
    </Field>
  );
});
PasswordInput.displayName = 'PasswordInput';

// Stores a digits-only string but shows it with thousands separators
export const AmountInput = ({ label, hint, error, value, onChange, fieldClassName, labelAction, id, size = 'lg', ...props }) => {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={fieldClassName} labelAction={labelAction}>
      <div className="relative">
        <span className={cn('pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted', size === 'lg' ? 'text-2xl' : 'text-base')}>
          ₦
        </span>
        <input
          id={inputId}
          inputMode="numeric"
          autoComplete="off"
          value={value ? formatNumber(value) : ''}
          onChange={(e) => onChange(parseAmount(e.target.value))}
          className={cn(controlClasses(false, error), size === 'lg' ? 'h-16 pl-11 text-2xl font-bold tracking-tight' : 'pl-9 font-semibold')}
          aria-invalid={Boolean(error)}
          {...props}
        />
      </div>
    </Field>
  );
};

export const Select = forwardRef(({ label, hint, error, icon: Icon, children, fieldClassName, id, className, ...props }, ref) => {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted" />}
        <select ref={ref} id={inputId} className={cn(controlClasses(Icon, error), 'appearance-none pr-10', className)} {...props}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>
    </Field>
  );
});
Select.displayName = 'Select';

export const Textarea = forwardRef(({ label, hint, error, fieldClassName, id, className, ...props }, ref) => {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <textarea ref={ref} id={inputId} className={cn(controlClasses(false, error), 'h-auto min-h-24 py-3', className)} {...props} />
    </Field>
  );
});
Textarea.displayName = 'Textarea';
