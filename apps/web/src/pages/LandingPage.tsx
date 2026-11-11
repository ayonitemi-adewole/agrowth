import {
  ArrowRight,
  BadgeCheck,
  Ban,
  Banknote,
  BookLock,
  Building2,
  Camera,
  Check,
  ChevronDown,
  CloudRain,
  Ghost,
  HandCoins,
  Handshake,
  IdCard,
  Landmark,
  MapPinned,
  Megaphone,
  Menu,
  QrCode,
  Recycle,
  Scale,
  ShieldCheck,
  Sprout,
  Store,
  Tractor,
  TrendingUp,
  Truck,
  Umbrella,
  Users,
  Wheat,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useOptionalAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Layout';

/*
 * The public welcome page: what Agrowth is, the problem it answers and how.
 * Every claim here matches docs/platform-guide.md and docs/design-rationale.md;
 * keep them in step when the product changes.
 */

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

const NAV = [
  { href: '#problem', label: 'The problem' },
  { href: '#principles', label: 'Our approach' },
  { href: '#how', label: 'How it works' },
  { href: '#editions', label: 'Editions' },
  { href: '#faq', label: 'FAQ' },
];

export function LandingPage() {
  const signedIn = !!useOptionalAuth()?.session;
  const primary = signedIn
    ? { to: '/', label: 'Open your workspace' }
    : { to: '/sign-in', label: 'Get started' };

  useEffect(() => {
    document.title = 'Agrowth: farm finance you can verify';
  }, []);
  const root = useReveal();

  return (
    <div ref={root} className="min-h-screen overflow-x-clip bg-white text-zinc-900 scroll-smooth">
      <Header primary={primary} signedIn={signedIn} />
      <main>
        <Hero primary={primary} />
        <TrustStrip />
        <Problem />
        <Causes />
        <Principles />
        <HowItWorks />
        <MoneyFlow />
        <Returns />
        <Editions />
        <People />
        <FieldReady />
        <Comparison />
        <Faq />
        <FinalCta primary={primary} />
      </main>
      <Footer />
    </div>
  );
}

/**
 * Fades [data-reveal] blocks in as they scroll into view. The hiding CSS only applies once
 * `.reveal-on` is set here, so without this script (or IntersectionObserver) nothing hides.
 */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    el.querySelectorAll('[data-reveal]').forEach((n) => io.observe(n));
    el.classList.add('reveal-on');
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cx('scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28', className)}>
      <div className="mx-auto max-w-6xl" data-reveal>
        {children}
      </div>
    </section>
  );
}

function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className={cx(
        'mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase',
        dark ? 'bg-white/10 text-brand-200' : 'bg-brand-50 text-brand-700',
      )}
    >
      <Sprout className="size-3.5" aria-hidden />
      {children}
    </p>
  );
}

function Heading({
  eyebrow,
  title,
  lead,
  dark,
  center,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  dark?: boolean;
  center?: boolean;
}) {
  return (
    <div className={cx('mb-12 max-w-3xl', center && 'mx-auto text-center')}>
      <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
      <h2
        className={cx(
          'text-3xl font-semibold tracking-tight text-balance sm:text-4xl',
          dark ? 'text-white' : 'text-zinc-950',
        )}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={cx(
            'mt-4 text-lg leading-relaxed text-pretty',
            dark ? 'text-brand-100/80' : 'text-zinc-600',
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}

/** A rounded photo with an optional caption chip pinned to its bottom-left corner. */
function PhotoCard({
  src,
  alt,
  className,
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <figure
      className={cx(
        'group relative overflow-hidden rounded-3xl bg-zinc-100 shadow-pop ring-1 ring-zinc-950/5',
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="size-full object-cover object-top transition duration-700 group-hover:scale-105"
      />
      <div
        className="absolute inset-0 bg-linear-to-t from-zinc-950/45 via-transparent to-transparent"
        aria-hidden
      />
      {children && <figcaption className="absolute bottom-4 left-4 right-4">{children}</figcaption>}
    </figure>
  );
}

function CtaLink({
  to,
  children,
  variant = 'primary',
}: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'light' | 'glass';
}) {
  const isHash = to.startsWith('#');
  const className = cx(
    'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
    variant === 'primary' &&
      'bg-brand-600 text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700',
    variant === 'ghost' && 'bg-white text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50',
    variant === 'light' && 'bg-white text-brand-900 hover:bg-brand-50',
    variant === 'glass' &&
      'bg-white/10 text-white ring-1 ring-white/30 backdrop-blur hover:bg-white/20',
  );
  const inner = (
    <>
      {children}
      {variant !== 'ghost' && variant !== 'glass' && <ArrowRight className="size-4" aria-hidden />}
    </>
  );
  return isHash ? (
    <a href={to} className={className}>
      {inner}
    </a>
  ) : (
    <Link to={to} className={className}>
      {inner}
    </Link>
  );
}

function Header({
  primary,
  signedIn,
}: {
  primary: { to: string; label: string };
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Over the hero photo the header is see-through with light text; once the page
  // scrolls (or the mobile menu opens) it turns solid white with dark text.
  const overHero = !scrolled && !open;

  return (
    <header
      className={cx(
        'sticky top-0 z-40 transition',
        overHero ? 'bg-transparent' : 'border-b border-zinc-200/70 bg-white/85 backdrop-blur-lg',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" aria-label="Agrowth, back to top">
          <Logo inverted={overHero} />
        </a>
        <nav
          className={cx(
            'hidden items-center gap-7 text-sm font-medium md:flex',
            overHero ? 'text-white/85' : 'text-zinc-600',
          )}
        >
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={cx(
                'underline-offset-[6px] hover:underline',
                overHero ? 'hover:text-white' : 'hover:text-brand-700',
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          {!signedIn && (
            <Link
              to="/sign-in"
              className={cx(
                'rounded-lg px-3 py-2 text-sm font-semibold transition',
                overHero
                  ? 'text-white ring-1 ring-white/30 hover:bg-white/10'
                  : 'text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-brand-700',
              )}
            >
              Sign in
            </Link>
          )}
          <Link
            to={primary.to}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
          >
            {primary.label}
          </Link>
        </div>
        <button
          type="button"
          className={cx(
            'grid size-10 place-items-center rounded-lg md:hidden',
            overHero ? 'text-white hover:bg-white/10' : 'text-zinc-700 hover:bg-zinc-100',
          )}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav className="border-t border-zinc-100 px-4 pt-2 pb-5 md:hidden">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {n.label}
            </a>
          ))}
          <div className="mt-3 grid gap-2">
            <Link
              to={primary.to}
              className="rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              {primary.label}
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero({ primary }: { primary: { to: string; label: string } }) {
  return (
    <section
      id="top"
      className="relative isolate -mt-16 overflow-hidden bg-brand-950 px-4 pt-28 pb-20 sm:px-6 lg:pt-36 lg:pb-28"
    >
      {/* Background photo: harvest in northern Nigeria, under a deep green wash so the text stays readable. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <picture>
          <source media="(max-width: 767px)" srcSet="/images/landing/hero-sm.webp" />
          <img
            src="/images/landing/hero.webp"
            alt=""
            fetchPriority="high"
            className="size-full object-cover object-[60%_center] motion-safe:animate-ken-burns"
          />
        </picture>
        <div className="absolute inset-0 bg-linear-to-r from-brand-950/95 via-brand-950/80 to-brand-950/45" />
        <div className="absolute inset-0 bg-brand-950/35 md:hidden" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-brand-950/80 to-transparent" />
        <div className="absolute -top-32 -left-32 size-112 rounded-full bg-brand-500/25 blur-3xl" />
        <FieldRows className="absolute right-0 bottom-0 left-0 h-32 text-white/10" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
        <div className="motion-safe:animate-hero-in">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-brand-50 ring-1 ring-white/20 backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-300 opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-brand-300" />
            </span>
            Agrowth · Farm investments that you can trust
          </p>
          <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">
            Farm finance you can{' '}
            <span className="relative whitespace-nowrap text-brand-300">
              verify
              <svg
                viewBox="0 0 200 12"
                className="absolute -bottom-2 left-0 h-3 w-full text-amber-400"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path
                  d="M2 9c40-6 120-8 196-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            , from wallet to field to buyer.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-pretty text-brand-50/85">
            Agrowth connects the people who fund farming with the smallholders who do it, without
            asking anyone to take it on trust. Money sits with a licensed trustee, the harvest is
            sold before a naira is raised, every farm is mapped and visited, and inputs go straight
            to approved agro-dealers. When the buyer pays, everyone is paid by rules agreed on day
            one.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <CtaLink to={primary.to}>{primary.label}</CtaLink>
            <CtaLink to="#how" variant="glass">
              See how it works
            </CtaLink>
          </div>
          <ul className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 text-sm text-brand-50/90">
            {[
              'No guaranteed-return promises',
              'The platform never holds your money',
              'No funding without a signed buyer',
              'Every farm GPS-verified',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

function FieldRows({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 160" preserveAspectRatio="none" className={className} aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <path
          key={i}
          d={`M0 ${40 + i * 18} C 300 ${20 + i * 18}, 900 ${70 + i * 18}, 1200 ${40 + i * 18}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="2 10"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** A stylised cycle tracker: what a funder actually sees. Illustrative data. */
function HeroVisual() {
  const milestones = [
    { name: 'Land preparation', state: 'done', note: 'Released to vendors' },
    { name: 'Planting', state: 'done', note: 'Vouchers redeemed' },
    { name: 'Mid-season', state: 'now', note: '18 of 20 farms checked in' },
    { name: 'Harvest', state: 'next', note: 'Buyer contracted' },
  ] as const;
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="absolute -inset-4 -z-10 rounded-4xl bg-linear-to-br from-brand-400/30 via-transparent to-amber-300/25 blur-2xl" />
      <div className="rounded-3xl bg-white p-5 shadow-2xl shadow-brand-950/40 ring-1 ring-white/20 motion-safe:animate-hero-in sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-zinc-500">Farm cycle · Maize, wet season</p>
            <p className="mt-0.5 text-lg font-semibold text-zinc-950">North cluster, 42 ha</p>
          </div>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
            In progress
          </span>
        </div>

        {/* Farm map */}
        <div className="relative mt-5 overflow-hidden rounded-2xl bg-[oklch(0.93_0.04_120)]">
          <svg viewBox="0 0 320 150" className="block h-36 w-full" aria-hidden>
            <defs>
              <pattern id="rows" width="8" height="8" patternUnits="userSpaceOnUse">
                <path d="M0 8 L8 0" stroke="oklch(0.62 0.16 150 / 0.25)" strokeWidth="1.5" />
              </pattern>
            </defs>
            <path
              d="M0 110 C80 90 140 130 320 95"
              stroke="oklch(0.8 0.05 80)"
              strokeWidth="10"
              fill="none"
            />
            {[
              'M20 20 L95 14 L104 70 L28 78 Z',
              'M110 12 L190 18 L184 66 L112 70 Z',
              'M198 20 L290 10 L300 60 L194 68 Z',
              'M40 92 L120 86 L128 140 L36 142 Z',
              'M140 92 L230 84 L236 138 L146 142 Z',
            ].map((d, i) => (
              <g key={i}>
                <path d={d} fill="url(#rows)" />
                <path
                  d={d}
                  fill="oklch(0.62 0.16 150 / 0.18)"
                  stroke="oklch(0.45 0.12 152)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </g>
            ))}
            {[
              [62, 46],
              [150, 40],
              [246, 38],
              [82, 116],
            ].map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="9" fill="white" opacity="0.9" />
                <path
                  d={`M${x - 4} ${y} l3 3 l5 -6`}
                  stroke="oklch(0.53 0.14 150)"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
            ))}
            <circle cx="190" cy="114" r="9" fill="white" opacity="0.9" />
            <circle cx="190" cy="114" r="4" fill="oklch(0.75 0.15 70)" />
          </svg>
          <span className="absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-medium text-zinc-700 shadow-sm">
            <MapPinned className="size-3.5 text-brand-600" aria-hidden />
            GPS check-ins inside each boundary
          </span>
        </div>

        {/* Milestones */}
        <ol className="mt-5 space-y-3">
          {milestones.map((m) => (
            <li key={m.name} className="flex items-center gap-3">
              <span
                className={cx(
                  'grid size-7 shrink-0 place-items-center rounded-full text-white',
                  m.state === 'done' && 'bg-brand-500',
                  m.state === 'now' && 'bg-amber-400 ring-4 ring-amber-100',
                  m.state === 'next' && 'bg-zinc-200',
                )}
              >
                {m.state === 'done' ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <span className="size-2 rounded-full bg-white" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                <span
                  className={cx(
                    'text-sm font-medium',
                    m.state === 'next' ? 'text-zinc-400' : 'text-zinc-800',
                  )}
                >
                  {m.name}
                </span>
                <span className="truncate text-xs text-zinc-500">{m.note}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-4 text-center">
          {[
            { icon: Handshake, label: 'Offtake signed' },
            { icon: Umbrella, label: 'Insured' },
            { icon: Landmark, label: 'Trustee-held' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-xl bg-zinc-50 px-2 py-2.5">
              <Icon className="mx-auto size-4 text-brand-600" aria-hidden />
              <p className="mt-1 text-[11px] font-medium text-zinc-600">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Floating notes */}
      <div className="absolute top-40 -left-8 hidden rounded-2xl bg-white px-3.5 py-2.5 shadow-pop ring-1 ring-zinc-200/70 motion-safe:animate-float sm:block">
        <p className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
          <QrCode className="size-4 text-brand-600" aria-hidden /> Voucher redeemed
        </p>
        <p className="mt-0.5 text-[11px] text-zinc-500">Fertiliser · approved agro-dealer</p>
      </div>
      <div className="absolute -right-3 -bottom-5 hidden rounded-2xl bg-brand-950 px-3.5 py-2.5 text-white shadow-pop ring-1 ring-white/15 motion-safe:animate-float-delayed sm:block">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <BookLock className="size-4 text-brand-300" aria-hidden /> Ledger entry
        </p>
        <p className="mt-0.5 text-[11px] text-brand-100/70">
          Confirmed with the trustee's bank ref
        </p>
      </div>
    </div>
  );
}

function TrustStrip() {
  const items = [
    { icon: Landmark, label: 'Licensed trustee custody' },
    { icon: Handshake, label: 'Buyer signed before funding' },
    { icon: Umbrella, label: 'Season-long insurance' },
    { icon: MapPinned, label: 'Mapped & visited farms' },
    { icon: BookLock, label: 'Append-only ledger' },
  ];
  return (
    <div className="border-y border-zinc-100 bg-zinc-50/70 px-4 py-6 sm:px-6">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-zinc-600">
        {items.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2">
            <Icon className="size-4 text-brand-600" aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The problem                                                         */
/* ------------------------------------------------------------------ */

function Problem() {
  const stats = [
    {
      value: '₦1.08tn',
      label: 'released under the CBN Anchor Borrowers’ Programme',
      note: 'Only 52.39% of what was due had been repaid by February 2023.',
    },
    {
      value: '20–50%',
      label: 'yearly returns promised by agri-crowdfunding platforms',
      note: 'Some advertised 10% a month. No farm cycle can sustain that.',
    },
    {
      value: '6+',
      label: 'platforms that vanished with investors’ money',
      note: 'Farm Power, Payfarmer, Goldvest, Emerald Farms, HO Corn, FarmKonnect and more.',
    },
  ];
  return (
    <Section id="problem">
      <Heading
        eyebrow="The problem"
        title="Nigerian farm finance has failed twice, in two different ways."
        lead={
          <>
            Smallholder farmers grow most of the country’s food, yet they are among the hardest
            people to finance. Two big attempts to fix that, retail agri-crowdfunding and government
            input credit, both lost money at scale. The result: investors were burned, public funds
            went unrecovered, and farmers were left with less trust and less credit than before.
          </>
        }
      />

      <div className="grid gap-5 md:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.value}
            className="rounded-3xl bg-linear-to-b from-zinc-50 to-white p-7 ring-1 ring-zinc-200/70"
          >
            <p className="text-4xl font-semibold tracking-tight text-brand-700">{s.value}</p>
            <p className="mt-2 font-medium text-zinc-900">{s.label}</p>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">{s.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <StoryCard
          icon={Megaphone}
          title="Agri-crowdfunding promised what farms can’t deliver"
          points={[
            'Platforms collected investors’ money centrally and promised fixed, high returns set by marketing, not farm economics.',
            'When harvests fell short, some paid maturing investors with new deposits.',
            'Insurance covered the farming, not the investor’s capital.',
            'The leaders pivoted away from the model; many smaller platforms simply disappeared.',
          ]}
        />
        <StoryCard
          icon={Landmark}
          title="Government input credit couldn’t see where it went"
          points={[
            'Large programmes released funds and inputs through paper lists that couldn’t be checked.',
            'Recipients were poorly targeted, and some farms existed only on paper.',
            'Repayment depended on goodwill and was weakened by political pressure.',
            'Nobody could see, in one place, who got what and whether it came back.',
          ]}
        />
      </div>
      <p className="mt-6 text-xs text-zinc-400">
        Sources: Nairametrics (2022, 2023), WeeTracker (2026), TechCabal, The Condia, Ripples
        Nigeria / IMF.
      </p>
    </Section>
  );
}

function StoryCard({
  icon: Icon,
  title,
  points,
}: {
  icon: LucideIcon;
  title: string;
  points: string[];
}) {
  return (
    <div className="rounded-3xl bg-white p-7 shadow-card ring-1 ring-zinc-200/70">
      <span className="grid size-11 place-items-center rounded-2xl bg-amber-50 text-amber-600">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-5 text-xl font-semibold tracking-tight text-zinc-950">{title}</h3>
      <ul className="mt-4 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex gap-3 text-sm leading-relaxed text-zinc-600">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-400" />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Causes() {
  const causes = [
    { icon: Megaphone, text: 'Returns set by marketing, not farm economics' },
    { icon: Banknote, text: 'Operators holding the money' },
    { icon: HandCoins, text: 'Cash handed straight to farmers' },
    { icon: Ghost, text: 'No independent proof that farms existed' },
    { icon: Ban, text: 'No buyer locked in for the harvest' },
    { icon: Scale, text: 'Political and social pressure on repayment' },
  ];
  return (
    <section className="px-4 sm:px-6">
      <div
        data-reveal
        className="mx-auto max-w-6xl rounded-4xl bg-zinc-950 px-6 py-14 text-white sm:px-12"
      >
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold tracking-wide text-amber-300 uppercase">
              Same six root causes, every time
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
              Different programmes. The same failures underneath.
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              Look past the headlines and the same causes repeat. Agrowth is designed backwards from
              this list: every rule in the platform exists to remove one of them.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {causes.map(({ icon: Icon, text }, i) => (
              <li
                key={text}
                className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3.5 ring-1 ring-white/10"
              >
                <span className="text-xs font-semibold text-zinc-500 tabular-nums">0{i + 1}</span>
                <Icon className="size-5 shrink-0 text-amber-300" aria-hidden />
                <span className="text-sm text-zinc-200">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The approach                                                        */
/* ------------------------------------------------------------------ */

const PRINCIPLES: {
  icon: LucideIcon;
  title: string;
  fixes: string;
  text: string;
}[] = [
  {
    icon: Landmark,
    title: 'Trustee custody',
    fixes: 'Operators diverting or recycling funds',
    text: 'Every naira sits with a licensed trustee, never with Agrowth. The platform only issues instructions; a payment exists only once the trustee confirms it with its own bank reference, and it can’t pay out more than it holds for a cycle.',
  },
  {
    icon: Handshake,
    title: 'Offtake first',
    fixes: 'No market for the harvest',
    text: 'A farm cycle can’t even be submitted for approval until a buyer has signed an offtake agreement covering at least the low-yield harvest. The crop is sold before money is raised.',
  },
  {
    icon: Umbrella,
    title: 'Insured downside',
    fixes: 'Losses landing entirely on funders',
    text: 'Every cycle carries an insurance policy covering the season’s budget, with the trustee named as loss payee. Claims are backed by field visits and weather records, and flow through the same waterfall as harvest money.',
  },
  {
    icon: MapPinned,
    title: 'Verified farms',
    fixes: 'Ghost farms and fake progress',
    text: 'Farms are mapped as boundaries, and a farm overlapping another is refused. Before each release a field agent must check in by GPS inside every farm, complete a checklist and take a photo. One failed farm holds the whole release.',
  },
  {
    icon: Store,
    title: 'In-kind, staged release',
    fixes: 'Cash leaking at farm level',
    text: 'Money moves milestone by milestone, mostly as inputs paid to approved agro-dealers or as vouchers farmers redeem at the counter. Cash to farmers is capped at 20% of a milestone.',
  },
  {
    icon: TrendingUp,
    title: 'Honest, variable returns',
    fixes: 'Impossible promised returns',
    text: 'Yields and prices are shown as low, expected and high ranges. Funders earn a share of what the harvest actually sells for; if it falls short, the loss is shared too. Nothing promises a fixed return.',
  },
];

function Principles() {
  return (
    <Section id="principles" className="bg-linear-to-b from-white to-brand-50/40">
      <Heading
        eyebrow="Our approach"
        title="Six principles, enforced by the software, not by goodwill."
        lead="A rule that can be skipped under pressure is exactly what failed before. In Agrowth, each principle is written into the database itself, so it holds whoever is operating the platform, and whatever the pressure."
      />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map(({ icon: Icon, title, fixes, text }) => (
          <article
            key={title}
            className="group flex flex-col rounded-3xl bg-white p-7 shadow-card ring-1 ring-zinc-200/70 transition hover:-translate-y-1 hover:shadow-pop"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-brand-600/20">
              <Icon className="size-6" aria-hidden />
            </span>
            <h3 className="mt-5 text-lg font-semibold text-zinc-950">{title}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-600">{text}</p>
            <p className="mt-5 flex items-center gap-2 border-t border-zinc-100 pt-4 text-xs text-zinc-500">
              <X className="size-3.5 text-red-400" aria-hidden />
              Removes: <span className="font-medium text-zinc-700">{fixes}</span>
            </p>
          </article>
        ))}
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <RuleCard
          icon={Recycle}
          title="No recycling"
          text="Every ledger account belongs to one cycle, and no entry can touch two cycles. One cycle’s money can never pay another cycle’s funders."
        />
        <RuleCard
          icon={Truck}
          title="Repayment from the sale"
          text="The buyer pays the trustee directly, and the trustee splits the proceeds by a waterfall fixed before funding. Repayment doesn’t depend on goodwill or politics."
        />
      </div>
    </Section>
  );
}

function RuleCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex gap-5 rounded-3xl bg-brand-900 p-7 text-white">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-brand-200">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-brand-100/80">{text}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const PHASES = [
  {
    name: 'Prepare',
    photo: '/images/landing/prepare.webp',
    alt: 'A farmer with field organisers in a wheat field',
    icon: Users,
    color: 'bg-sky-50 text-sky-700 ring-sky-100',
    steps: [
      {
        title: 'Farmers join through their cooperative',
        text: 'Field agents enrol each farmer with identity checks (BVN / NIN) and deduplication, then map their farm on satellite imagery or by walking the boundary with GPS.',
      },
      {
        title: 'The cycle is built from real numbers',
        text: 'A cycle manager sets the crop, hectares, budget and milestones, with yield and price as low–expected–high ranges.',
      },
      {
        title: 'A buyer signs, an insurer binds',
        text: 'The offtake agreement and the insurance policy are uploaded. Without both, the cycle can’t go forward.',
      },
    ],
  },
  {
    name: 'Fund',
    photo: '/images/landing/fund.webp',
    alt: 'A smiling farmer with members of her cooperative',
    icon: Landmark,
    color: 'bg-violet-50 text-violet-700 ring-violet-100',
    steps: [
      {
        title: 'Compliance approves',
        text: 'Offtake, insurance, verification and KYC are checked before the cycle is listed for investors or allocated a programme budget.',
      },
      {
        title: 'Money goes to the trustee',
        text: 'Funders pay into the trustee’s account, by transfer or online. If the cycle doesn’t fill by its deadline, everyone is refunded in full.',
      },
    ],
  },
  {
    name: 'Grow',
    photo: '/images/landing/grow.webp',
    alt: 'A farmer transplanting rice seedlings in a flooded paddy',
    icon: Sprout,
    color: 'bg-brand-50 text-brand-700 ring-brand-100',
    steps: [
      {
        title: 'Verify, then release',
        text: 'At each milestone, agents check in by GPS inside every farm. Only when all pass does the trustee release that tranche to input vendors.',
      },
      {
        title: 'Farmers redeem input vouchers',
        text: 'Each farmer gets a voucher slip with a QR code, redeemed for seed, fertiliser or services at an approved agro-dealer. The dealer is paid on redemption.',
      },
    ],
  },
  {
    name: 'Harvest & settle',
    photo: '/images/landing/harvest.webp',
    alt: 'Farm workers threshing a maize harvest in Kaduna State',
    icon: Wheat,
    color: 'bg-amber-50 text-amber-700 ring-amber-100',
    steps: [
      {
        title: 'Weighed, graded, delivered',
        text: 'The harvest is weighed and graded per farmer, delivered to the buyer, and the buyer confirms each load.',
      },
      {
        title: 'The buyer pays, the waterfall runs',
        text: 'The buyer pays the trustee. The fee, funders’ capital and the profit split are paid out in order, statements go out, and the cycle’s ledger closes at zero.',
      },
    ],
  },
];

/** Where each phase's step numbers start. */
const PHASE_START = PHASES.map((_, i) =>
  PHASES.slice(0, i).reduce((sum, p) => sum + p.steps.length, 1),
);

function HowItWorks() {
  return (
    <Section id="how">
      <Heading
        eyebrow="How it works"
        title="The life of a farm cycle, from cooperative to payout."
        lead="Everything on Agrowth revolves around the farm cycle: one season, one crop, one group of farms, with its own budget, buyer, insurance and ledger. Here is how a cycle moves from idea to settlement."
      />
      <div className="grid gap-6 lg:grid-cols-4">
        {PHASES.map(({ name, icon: Icon, color, photo, alt, steps }, phase) => (
          <div key={name} className="flex flex-col">
            <div className="group relative mb-4 aspect-[4/3] overflow-hidden rounded-2xl bg-zinc-100 shadow-card">
              <img
                src={photo}
                alt={alt}
                loading="lazy"
                decoding="async"
                className="size-full object-cover transition duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-linear-to-t from-zinc-950/50 via-transparent to-transparent" />
              <div
                className={cx(
                  'absolute bottom-3 left-3 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold shadow-sm ring-1',
                  color,
                )}
              >
                <Icon className="size-4" aria-hidden />
                {name}
              </div>
            </div>
            <ol className="flex flex-col gap-4">
              {steps.map((s, i) => {
                const n = PHASE_START[phase] + i;
                return (
                  <li
                    key={s.title}
                    className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-200/70"
                  >
                    <span className="text-xs font-semibold text-zinc-400 tabular-nums">
                      Step {n}
                    </span>
                    <h3 className="mt-1 font-semibold text-zinc-900">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-600">{s.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </Section>
  );
}

function MoneyFlow() {
  const nodes = [
    {
      icon: Users,
      title: 'Funders',
      text: 'Investors or a government programme',
    },
    { icon: Landmark, title: 'Trustee', text: 'Holds every naira, per cycle' },
    {
      icon: Store,
      title: 'Agro-dealers',
      text: 'Paid for inputs, by milestone',
    },
    { icon: Tractor, title: 'Farmers', text: 'Grow and deliver the harvest' },
    { icon: Truck, title: 'Buyer', text: 'Pays the trustee for the crop' },
  ];
  return (
    <section className="px-4 sm:px-6">
      <div
        data-reveal
        className="relative mx-auto max-w-6xl overflow-hidden rounded-4xl bg-brand-950 px-6 py-16 sm:px-12"
      >
        <div
          className="pointer-events-none absolute -top-32 -right-24 size-[30rem] rounded-full bg-brand-500/20 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <Heading
            dark
            eyebrow="Follow the money"
            title="Every naira has a path, and you can see all of it."
            lead="The platform sends instructions; it never touches funds. Money sits with the trustee, risk sits with the insurer, and the harvest goes to the buyer, so nobody has to trust a software company with their money."
          />
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {nodes.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="relative">
                <div className="h-full rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-400/15 text-brand-300">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <p className="mt-4 font-semibold text-white">{title}</p>
                  <p className="mt-1 text-sm text-brand-100/70">{text}</p>
                </div>
                {i < nodes.length - 1 && (
                  <ArrowRight
                    className="absolute top-1/2 -right-3 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-brand-950 text-brand-300 lg:block"
                    aria-hidden
                  />
                )}
              </li>
            ))}
          </ol>
          <div className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
            {[
              'Double-entry, append-only ledger: entries are never edited, only reversed.',
              'Every confirmation carries the trustee’s own bank reference, which can’t be reused.',
              'Bank statements are matched to the ledger, so nothing moves unrecorded.',
            ].map((t) => (
              <p key={t} className="flex gap-2.5 text-brand-100/80">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden />
                {t}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Honest returns                                                      */
/* ------------------------------------------------------------------ */

type Scenario = 'low' | 'expected' | 'high';
const CAPITAL = 10_000_000;
const FEE = 200_000; // 2% of capital
const FUNDER_SHARE = 0.6;
const PROCEEDS: Record<Scenario, number> = {
  low: 9_400_000,
  expected: 11_800_000,
  high: 12_800_000,
};

const naira = (n: number) =>
  n === 0
    ? '₦0'
    : '₦' +
      (Math.abs(n) >= 1_000_000
        ? `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m`
        : `${Math.round(n / 1000)}k`);

function Returns() {
  const [s, setS] = useState<Scenario>('expected');
  const proceeds = PROCEEDS[s];
  const afterFee = proceeds - FEE;
  const capitalBack = Math.min(CAPITAL, afterFee);
  const profit = Math.max(0, afterFee - CAPITAL);
  const funders = profit * FUNDER_SHARE;
  const farmers = profit - funders;
  const funderTotal = capitalBack + funders;
  const result = (funderTotal - CAPITAL) / CAPITAL;

  const rows = [
    { label: 'Management fee', value: FEE, tone: 'bg-zinc-400' },
    {
      label: 'Funders’ capital back',
      value: capitalBack,
      tone: 'bg-brand-600',
    },
    {
      label: 'Funders’ share of profit (60%)',
      value: funders,
      tone: 'bg-brand-400',
    },
    {
      label: 'Farmers’ share of profit (40%)',
      value: farmers,
      tone: 'bg-amber-400',
    },
  ];

  return (
    <Section id="returns">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <Heading
            eyebrow="Honest returns"
            title="A range you can understand, not a promise nobody can keep."
            lead="Farming has good seasons and bad ones. Instead of a fixed figure, Agrowth shows every cycle as a low, expected and high outcome based on yields and prices, and pays from what the harvest actually earns."
          />
          <ul className="-mt-4 space-y-3 text-sm text-zinc-600">
            {[
              'The waterfall is agreed before anyone invests: fee, then capital, then profit.',
              'Farmers share in the profit, by the kilograms each one delivered.',
              'If a harvest falls short, funders share the loss in proportion, and insurance claims flow back through the same waterfall.',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-pop ring-1 ring-zinc-200/70 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold text-zinc-900">Try a harvest outcome</p>
            <div
              role="radiogroup"
              aria-label="Harvest outcome"
              className="inline-flex rounded-xl bg-zinc-100 p-1"
            >
              {(['low', 'expected', 'high'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={s === k}
                  onClick={() => setS(k)}
                  className={cx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition',
                    s === k
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-800',
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">Funders invested</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{naira(CAPITAL)}</p>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4">
              <p className="text-xs text-zinc-500">Buyer paid for the harvest</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{naira(proceeds)}</p>
            </div>
          </div>

          <div className="mt-6 flex h-4 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
            {rows.map((r) =>
              r.value > 0 ? (
                <div
                  key={r.label}
                  className={cx('h-full transition-all duration-500', r.tone)}
                  style={{ width: `${(r.value / proceeds) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-5 space-y-2.5 text-sm">
            {rows.map((r, i) => (
              <li key={r.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5 text-zinc-600">
                  <span className={cx('size-2.5 rounded-full', r.tone)} />
                  <span className="text-xs text-zinc-400 tabular-nums">{i + 1}.</span>
                  {r.label}
                </span>
                <span className="font-medium text-zinc-900 tabular-nums">{naira(r.value)}</span>
              </li>
            ))}
          </ul>

          <div
            className={cx(
              'mt-6 flex items-center justify-between rounded-2xl px-4 py-3.5',
              result >= 0 ? 'bg-brand-50 text-brand-800' : 'bg-red-50 text-red-700',
            )}
            aria-live="polite"
          >
            <span className="text-sm font-medium">Funders’ result for the season</span>
            <span className="text-lg font-semibold tabular-nums">
              {result >= 0 ? '+' : '−'}
              {Math.abs(result * 100).toFixed(1)}%
            </span>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-zinc-400">
            Illustration only, with made-up figures: not a forecast or an offer. Each real cycle
            publishes its own budget, fee, profit split and low–expected–high range, and capital is
            at risk.
          </p>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Editions                                                            */
/* ------------------------------------------------------------------ */

function Editions() {
  return (
    <Section id="editions" className="bg-zinc-50">
      <Heading
        eyebrow="Two editions, one core"
        title="Built once, for two kinds of funding."
        lead="A shared core does the hard work: registry, farm mapping, cycles, offtake, disbursement, vouchers, monitoring, settlement, ledger and compliance. Each edition adds the screens, roles and reports its funders need. The two can even co-finance one cycle."
        center
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <EditionCard
          icon={TrendingUp}
          name="Investor Edition"
          tagline="For retail, high-net-worth and institutional investors"
          intro="A licensed operator (a registered crowdfunding portal, fund manager, bank or fintech) offers verified farm cycles to investors, with every naira traceable from wallet to field to buyer."
          features={[
            'Tiered KYC with BVN / NIN checks, investor classification and automatic retail caps',
            'A marketplace where each listing shows the farm map, buyer, insurer, budget, milestones and a plain-language risk score',
            'Risk disclosure acknowledged before every pledge, plus a cooling-off period',
            'Pay online or by transfer to the trustee; get a certificate and a live cycle tracker',
            'Statements and payouts to your bank account at settlement',
          ]}
          accent="from-brand-500 to-brand-700"
        />
        <EditionCard
          icon={Building2}
          name="Government Edition"
          tagline="For ministries, agencies and donor programmes"
          intro="State and federal agriculture bodies, development-finance institutions and donor-funded programmes run input-credit schemes they can actually measure, from enrolment to recovery."
          features={[
            'Programme designer: eligibility, commodities, input packages, terms and target LGAs',
            'A deduplicated farmer registry, so no one enrols twice or under a fake name',
            'Inputs delivered as vouchers through registered agro-dealers instead of bulk handouts',
            'Dashboards by state, LGA, commodity and cooperative: hectares, inputs, yields and repayment',
            'Audit-ready exports for auditors, donors and legislative oversight',
          ]}
          accent="from-sky-500 to-indigo-600"
        />
      </div>
    </Section>
  );
}

function EditionCard({
  icon: Icon,
  name,
  tagline,
  intro,
  features,
  accent,
}: {
  icon: LucideIcon;
  name: string;
  tagline: string;
  intro: string;
  features: string[];
  accent: string;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-zinc-200/70">
      <div className={cx('bg-linear-to-br p-7 text-white', accent)}>
        <Icon className="size-8 opacity-90" aria-hidden />
        <h3 className="mt-4 text-2xl font-semibold tracking-tight">{name}</h3>
        <p className="mt-1 text-sm text-white/80">{tagline}</p>
      </div>
      <div className="flex flex-1 flex-col p-7">
        <p className="leading-relaxed text-zinc-600">{intro}</p>
        <ul className="mt-6 space-y-3">
          {features.map((f) => (
            <li key={f} className="flex gap-3 text-sm text-zinc-700">
              <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const PEOPLE: { icon: LucideIcon; who: string; gets: string }[] = [
  {
    icon: Tractor,
    who: 'Farmers & cooperatives',
    gets: 'Inputs on time from local agro-dealers, a buyer for the harvest before planting, and a share of the profit by what they deliver.',
  },
  {
    icon: TrendingUp,
    who: 'Investors',
    gets: 'Real farm cycles with a signed buyer and insurance, a live view of every milestone and photo, and payouts from actual sales.',
  },
  {
    icon: Building2,
    who: 'Government programmes',
    gets: 'A clean registry, inputs that reach real farms, and dashboards that show delivery and recovery as it happens.',
  },
  {
    icon: MapPinned,
    who: 'Field agents',
    gets: 'A phone app that works offline for enrolment, mapping, visits and harvest weighing, and syncs when the signal returns.',
  },
  {
    icon: Store,
    who: 'Agro-dealers',
    gets: 'New customers sent their way, vouchers scanned at the counter, and payment on redemption.',
  },
  {
    icon: Truck,
    who: 'Buyers (offtakers)',
    gets: 'Contracted volume from verified farms, a portal to confirm each load and grade, and a clear record of payments.',
  },
  {
    icon: Landmark,
    who: 'Trustees',
    gets: 'Every movement of money confirmed by them, matched to bank statements, and never more paid out than is held.',
  },
  {
    icon: ShieldCheck,
    who: 'Auditors & regulators',
    gets: 'Read access to an append-only ledger and a full history of who did what, and when.',
  },
];

function People() {
  return (
    <Section id="people">
      <div className="mb-12 grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="[&>div]:mb-0">
          <Heading
            eyebrow="Who it’s for"
            title="Everyone in the chain, each with exactly the access their job needs."
            lead="Agrowth gives every participant their own view. Each role sees and does only what it should, and the database itself enforces it, not just the screens."
          />
        </div>
        <PhotoCard
          src="/images/landing/people.webp"
          alt="A farmer carrying freshly harvested crops across a green field"
          className="aspect-[3/2]"
        >
          <span className="inline-flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm backdrop-blur">
            <Tractor className="size-4 text-brand-600" aria-hidden />
            Farmers share in the profit, by what they deliver
          </span>
        </PhotoCard>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PEOPLE.map(({ icon: Icon, who, gets }) => (
          <div
            key={who}
            className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70 transition hover:ring-brand-300"
          >
            <Icon className="size-6 text-brand-600" aria-hidden />
            <h3 className="mt-4 font-semibold text-zinc-900">{who}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{gets}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Built for the field                                                 */
/* ------------------------------------------------------------------ */

function FieldReady() {
  const features: { icon: LucideIcon; title: string; text: string }[] = [
    {
      icon: WifiOff,
      title: 'Works with no signal',
      text: 'Agents install the app on their phone and record visits offline. Everything sends itself once they’re back in coverage.',
    },
    {
      icon: MapPinned,
      title: 'Maps that refuse overlaps',
      text: 'Trace a farm on satellite imagery or walk its boundary. The area is computed, and a farm overlapping another is rejected.',
    },
    {
      icon: Camera,
      title: 'Evidence on every visit',
      text: 'GPS check-in inside the boundary, a checklist and a photo, with any issues flagged straight to the cycle manager.',
    },
    {
      icon: QrCode,
      title: 'QR input vouchers',
      text: 'Printed slips the shop scans with a phone camera, with optional phone-digit checks if slips go astray.',
    },
    {
      icon: CloudRain,
      title: 'Weather on watch',
      text: 'Daily rain and temperature for every farm against its 10-year normal, with dry-spell, heavy-rain and heat flags.',
    },
    {
      icon: IdCard,
      title: 'Identity you can trust',
      text: 'BVN and NIN checks for farmers and investors, with duplicates caught before anyone is enrolled twice.',
    },
  ];
  return (
    <Section className="bg-linear-to-b from-brand-50/50 to-white">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Heading
            eyebrow="Built for the field"
            title="Designed for rural Nigeria, not a city office."
            lead="Verification only works if it works where farms are: patchy signal, shared phones, busy shop counters. Every feature is built for those conditions."
          />
          <PhotoCard
            src="/images/landing/field.webp"
            alt="A smiling farmer carrying a 20 kg bag of produce on a motorbike"
            className="-mt-4 aspect-[4/3]"
          >
            <span className="inline-flex items-center gap-2 rounded-xl bg-brand-950/85 px-3 py-2 text-xs font-semibold text-white shadow-sm backdrop-blur">
              <WifiOff className="size-4 text-brand-300" aria-hidden />
              Visits saved offline, sent when the signal returns
            </span>
          </PhotoCard>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200/70"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold text-zinc-900">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* What changed                                                        */
/* ------------------------------------------------------------------ */

function Comparison() {
  const rows = [
    [
      'Returns',
      'Fixed returns promised up front',
      'A low–expected–high range; paid from actual sales',
    ],
    ['Custody', 'Platform collected and held the money', 'A licensed trustee holds every naira'],
    [
      'The harvest',
      'Sold after the fact, if a buyer turned up',
      'A buyer signs before funding opens',
    ],
    ['Farms', 'Taken on trust', 'Mapped, GPS-visited and photographed before each release'],
    ['Disbursement', 'Cash in one go', 'Staged by milestone, mostly as inputs and vouchers'],
    ['Losses', 'Landed on funders alone', 'Insured, with claims flowing through the waterfall'],
    ['Records', 'Spreadsheets and paper lists', 'An append-only, double-entry ledger per cycle'],
  ];
  return (
    <Section>
      <Heading
        eyebrow="What’s different"
        title="The old model, and what Agrowth does instead."
        center
      />
      <div className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-zinc-200/70">
        <div className="hidden grid-cols-[0.8fr_1fr_1fr] bg-zinc-50 px-6 py-4 text-xs font-semibold tracking-wide text-zinc-500 uppercase sm:grid">
          <span />
          <span>The old way</span>
          <span className="text-brand-700">With Agrowth</span>
        </div>
        <ul className="divide-y divide-zinc-100">
          {rows.map(([topic, before, after]) => (
            <li
              key={topic}
              className="grid gap-2 px-6 py-5 sm:grid-cols-[0.8fr_1fr_1fr] sm:items-center sm:gap-6"
            >
              <span className="font-semibold text-zinc-900">{topic}</span>
              <span className="flex items-start gap-2 text-sm text-zinc-500">
                <X className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />
                {before}
              </span>
              <span className="flex items-start gap-2 text-sm font-medium text-zinc-800">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                {after}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQS = [
  {
    q: 'Does Agrowth hold my money?',
    a: 'No. Agrowth has no custody of funds at all. Money for each cycle sits in an account with a licensed trustee, and only the trustee can confirm a deposit, release or payout, each with its own bank reference. The platform’s job is to issue instructions and keep the record.',
  },
  {
    q: 'Are returns guaranteed?',
    a: 'No, and any farm investment that guarantees a fixed return should worry you. Each cycle shows a low, expected and high outcome. Funders receive their capital back and a share of the profit from what the buyer actually pays; if the harvest falls short, the loss is shared and any insurance payout flows back through the same waterfall. Your capital is at risk.',
  },
  {
    q: 'What happens if a cycle doesn’t raise enough money?',
    a: 'If a cycle isn’t fully funded by its deadline, or is cancelled, the trustee refunds every funder in full and the ledger records each reversal.',
  },
  {
    q: 'How do I know the farms are real?',
    a: 'Every farm is mapped as a boundary, and a boundary that overlaps another registered farm is refused. Before each release of money, a field agent must check in by GPS from inside every farm’s boundary, complete a checklist and take a photo. If even one farm fails, the release waits.',
  },
  {
    q: 'Why don’t farmers just receive cash?',
    a: 'Because cash at farm level is where past programmes leaked. Most funds go to approved agro-dealers for seed, fertiliser and services, or as vouchers farmers redeem at the counter. Cash to farmers is capped at 20% of a milestone.',
  },
  {
    q: 'Who can invest, and is it regulated?',
    a: 'Offering investments to the public in Nigeria is regulated by the SEC, so the Investor Edition runs under a registered operator such as a crowdfunding portal or fund manager. Retail investors are capped at a share of their annual income, investors complete KYC, and every pledge needs the risk disclosure acknowledged, followed by a cooling-off period.',
  },
  {
    q: 'Can a government programme use Agrowth?',
    a: 'Yes. The Government Edition runs input-credit and subsidy programmes with a deduplicated registry, voucher-based input delivery, field monitoring, repayment linked to offtake and dashboards by state, LGA and commodity. A state can also co-fund a cycle alongside licensed investors.',
  },
  {
    q: 'Do farmers need a smartphone?',
    a: 'No. Field agents handle enrolment, mapping and visits on their own phones, and farmers redeem printed voucher slips at the shop. An SMS / USSD channel for farmers without smartphones is on the roadmap.',
  },
];

function Faq() {
  return (
    <Section id="faq" className="bg-zinc-50">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <Heading
          eyebrow="Questions"
          title="Straight answers to fair questions."
          lead="Trust is earned with clarity. If something here isn’t answered, ask us. We’d rather explain than have you guess."
        />
        <div className="space-y-3">
          {FAQS.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70 open:shadow-card"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown
                  className="size-5 shrink-0 text-zinc-400 transition group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing                                                             */
/* ------------------------------------------------------------------ */

function FinalCta({ primary }: { primary: { to: string; label: string } }) {
  return (
    <section className="px-4 py-20 sm:px-6">
      <div
        data-reveal
        className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-4xl bg-brand-900 px-6 py-20 text-center text-white sm:px-12"
      >
        <img
          src="/images/landing/cta.webp"
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 -z-10 size-full object-cover"
        />
        <div
          className="absolute inset-0 -z-10 bg-linear-to-br from-brand-700/90 via-brand-900/85 to-brand-950/95"
          aria-hidden
        />
        <FieldRows className="pointer-events-none absolute inset-x-0 bottom-0 h-32 text-white/10" />
        <div className="relative mx-auto max-w-2xl">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/15">
            <Sprout className="size-7" aria-hidden />
          </span>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Let’s grow farm finance that people can trust again.
          </h2>
          <p className="mt-4 text-lg text-brand-100/85">
            Whether you fund farms, run a programme, sell inputs, buy harvests or work in the field,
            there’s a place for you on Agrowth.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <CtaLink to={primary.to} variant="light">
              {primary.label}
            </CtaLink>
            <a
              href="#top"
              className="inline-flex items-center rounded-xl px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10"
            >
              Back to top
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/*
 * Photos are from Wikimedia Commons, resized and compressed for the web. CC BY-SA images
 * must keep this attribution: title, author, source and licence. Keep the list in step with
 * public/images/landing/.
 */
const PHOTO_CREDITS: {
  title: string;
  author: string;
  source: string;
  license: string;
  licenseUrl?: string;
}[] = [
  {
    title: 'Harvest in progress',
    author: 'Photobyamin',
    source: 'https://commons.wikimedia.org/wiki/File:Harvest_in_progress.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    title: 'Maize cultivation, Kaduna city, Nigeria 06',
    author: 'Onisp',
    source:
      'https://commons.wikimedia.org/wiki/File:Maize_cultivation,_Kaduna_city,_Nigeria_06.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    title: 'Female farmer with organizers',
    author: 'Ishaku Ajeje',
    source: 'https://commons.wikimedia.org/wiki/File:Female_farmer_with_organizers.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    title: 'Nigeria farmer (14329939606)',
    author: 'USAID in Africa',
    source: 'https://commons.wikimedia.org/wiki/File:Nigeria_farmer_(14329939606).jpg',
    license: 'Public domain (US Government work)',
    licenseUrl: undefined,
  },
  {
    title: 'Transplanting rice',
    author: 'Aminucrus',
    source: 'https://commons.wikimedia.org/wiki/File:Transplanting_rice.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    title: 'Farm workers threshing maize at Makarfi Local Government of Kaduna State Nigeria 01',
    author: 'MKALM7',
    source:
      'https://commons.wikimedia.org/wiki/File:Farm_workers_threshing_maize_at_Makarfi_Local_Government_of_Kaduna_State_Nigeria_01.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    title: 'Nigeria farmer (14349734271)',
    author: 'USAID in Africa',
    source: 'https://commons.wikimedia.org/wiki/File:Nigeria_farmer_(14349734271).jpg',
    license: 'Public domain (US Government work)',
    licenseUrl: undefined,
  },
  {
    title: 'Farmer at harvest',
    author: 'Photobyamin',
    source: 'https://commons.wikimedia.org/wiki/File:Farmer_at_harvest.jpg',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
];

function Footer() {
  return (
    <footer className="border-t border-zinc-100 px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm text-zinc-500">
            Verifiable agricultural finance: trustee-held, offtake-backed, insured and verified in
            the field.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-brand-700">
              {n.label}
            </a>
          ))}
          <Link to="/sign-in" className="hover:text-brand-700">
            Sign in
          </Link>
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl text-xs leading-relaxed text-zinc-400">
        Farm investments carry risk, including the loss of capital. Returns are not guaranteed and
        past results do not predict future ones. Investment offers are made only through a licensed
        operator. © {new Date().getFullYear()} Agrowth.
      </p>
      <details className="group mx-auto mt-4 max-w-6xl text-xs text-zinc-400">
        <summary className="inline-flex list-none items-center gap-1 font-medium text-zinc-500 hover:text-brand-700 [&::-webkit-details-marker]:hidden">
          Photo credits
          <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="mt-2 space-y-1 leading-relaxed">
          {PHOTO_CREDITS.map((c) => (
            <li key={c.source}>
              <a
                href={c.source}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-zinc-300 underline-offset-2 hover:text-brand-700"
              >
                {c.title}
              </a>{' '}
              by {c.author},{' '}
              {c.licenseUrl ? (
                <a
                  href={c.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-zinc-300 underline-offset-2 hover:text-brand-700"
                >
                  {c.license}
                </a>
              ) : (
                c.license
              )}
              , via Wikimedia Commons. Resized and cropped.
            </li>
          ))}
        </ul>
      </details>
    </footer>
  );
}
