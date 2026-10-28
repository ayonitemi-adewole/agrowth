import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/format';

export const Logo = ({ className, textClassName, to = '/', showText = true }) => (
  <Link to={to} className={cn('inline-flex items-center gap-2', className)} aria-label="Agrowth home">
    <img src="/assets/Submark-removebg-preview.png" alt="" className="h-9 w-9 object-contain" />
    {showText && <span className={cn('text-lg font-extrabold tracking-tight', textClassName)}>Agrowth</span>}
  </Link>
);

const isPlaceholderPhoto = (url) => !url || url.startsWith('blob:') || url.includes('blank-profile-picture');

export const Avatar = ({ src, name = '', size = 40, className }) => {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '🙂';

  if (!isPlaceholderPhoto(src)) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover ring-2 ring-surface', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-bold text-accent ring-2 ring-surface', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-label={name}
    >
      {initials}
    </div>
  );
};

export const PageHeader = ({ title, subtitle, back, actions, className }) => {
  const navigate = useNavigate();
  const goBack = () => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/dashboard'));

  return (
    <header className={cn('mb-6 flex items-center gap-3', className)}>
      {back && (
        <button
          onClick={goBack}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-fg transition hover:bg-surface-2"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
};
