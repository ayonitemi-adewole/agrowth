import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/format';

const VARIANTS = {
  primary: 'bg-accent text-on-accent shadow-sm shadow-accent/30 hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-fg hover:bg-line/70',
  outline: 'border border-line bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-2',
  soft: 'bg-accent/12 text-accent hover:bg-accent/20',
  danger: 'bg-red-600 text-white shadow-sm shadow-red-600/30 hover:bg-red-700',
  warning: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30 hover:bg-amber-600',
  white: 'bg-white text-brand-900 shadow-sm hover:bg-white/90',
};

const SIZES = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-xl',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-6 text-base gap-2 rounded-2xl',
  icon: 'h-10 w-10 rounded-xl',
};

const Button = forwardRef(
  ({ variant = 'primary', size = 'md', loading = false, icon: Icon, iconRight: IconRight, to, className, children, disabled, type = 'button', ...props }, ref) => {
    const classes = cn(
      'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none transition-all duration-200',
      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30',
      'disabled:opacity-50 disabled:pointer-events-none',
      VARIANTS[variant],
      SIZES[size],
      className
    );

    const content = (
      <>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4 shrink-0" />}
        {children}
        {IconRight && !loading && <IconRight className="h-4 w-4 shrink-0" />}
      </>
    );

    if (to) {
      return (
        <Link ref={ref} to={to} className={classes} {...props}>
          {content}
        </Link>
      );
    }

    return (
      <button ref={ref} type={type} className={classes} disabled={disabled || loading} {...props}>
        {content}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
