import { motion } from 'framer-motion';
import { ShieldCheck, Sprout, TrendingUp } from 'lucide-react';
import { Logo } from '../ui';
import ThemeToggle from '../ThemeToggle';

const HIGHLIGHTS = [
  { icon: Sprout, title: 'Real farm cycles', text: 'Back vetted crop cycles from planting to harvest.' },
  { icon: TrendingUp, title: 'Clear returns', text: 'Know your expected ROI and payout before you commit.' },
  { icon: ShieldCheck, title: 'Track every naira', text: 'Live progress on every investment you hold.' },
];

const AuthLayout = ({ title, subtitle, children }) => (
  <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
    <aside className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col">
      <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/40 blur-3xl" />
      <div className="absolute -bottom-32 right-0 h-[28rem] w-[28rem] rounded-full bg-gold-400/20 blur-3xl" />
      <svg className="absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden="true">
        <defs>
          <pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="white" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#auth-grid)" />
      </svg>

      <Logo className="relative" textClassName="text-white" />

      <div className="relative mt-auto max-w-md">
        <h2 className="text-4xl font-extrabold leading-tight tracking-tight">
          Grow your wealth with <span className="text-gold-300">the soil.</span>
        </h2>
        <p className="mt-4 text-white/75">Invest in Nigerian agriculture, follow every crop cycle, and get paid at harvest.</p>
        <div className="mt-10 space-y-5">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className="flex gap-4"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
                <Icon className="h-5 w-5 text-gold-300" />
              </div>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-white/65">{text}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </aside>

    <section className="flex flex-col px-5 py-6 sm:px-10">
      <div className="flex items-center justify-between">
        <Logo className="lg:invisible" />
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10"
      >
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </motion.div>
    </section>
  </div>
);

export default AuthLayout;
