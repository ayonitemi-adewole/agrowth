import { cn } from '../../lib/format';

const Card = ({ as: Tag = 'div', className, children, interactive = false, ...props }) => (
  <Tag
    className={cn(
      'rounded-3xl border border-line bg-surface',
      interactive && 'transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-black/5',
      className
    )}
    {...props}
  >
    {children}
  </Tag>
);

export const SectionTitle = ({ title, subtitle, action, className }) => (
  <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
    <div>
      <h2 className="text-base font-bold tracking-tight sm:text-lg">{title}</h2>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </div>
    {action}
  </div>
);

export default Card;
