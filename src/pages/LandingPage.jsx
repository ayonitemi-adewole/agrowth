import { motion } from 'framer-motion';
import { ArrowRight, BarChart3, CalendarClock, LineChart, ShieldCheck, Sprout, Wallet } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button, Logo, ProgressRing } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';

const FEATURES = [
  { icon: Sprout, title: 'Invest in real crops', text: 'Choose from crop cycles like peppers, maize and fast-growing vegetables.' },
  { icon: LineChart, title: 'Know your returns', text: 'Every opportunity shows its expected ROI, period and payout up front.' },
  { icon: CalendarClock, title: 'Follow every cycle', text: 'Live progress rings and countdowns show exactly where each investment is.' },
  { icon: ShieldCheck, title: 'Your account, protected', text: 'Email verification, password security and optional 2FA keep you in control.' },
];

const STEPS = [
  { icon: Wallet, title: 'Fund your wallet', text: 'Deposit by card, bank transfer or USSD.' },
  { icon: Sprout, title: 'Pick a farm', text: 'Buy units in an open crop cycle that suits your goals.' },
  { icon: BarChart3, title: 'Harvest returns', text: 'Your capital plus profit lands in your wallet at maturity.' },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.5, ease: 'easeOut' } }),
};

const HeroPreview = () => (
  <motion.div
    initial={{ opacity: 0, y: 40, rotate: 2 }}
    animate={{ opacity: 1, y: 0, rotate: 0 }}
    transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
    className="relative mx-auto w-full max-w-sm"
  >
    <div className="absolute -inset-6 rounded-[2.5rem] bg-accent/25 blur-3xl" />
    <div className="relative rounded-[2rem] border border-line bg-surface p-4 shadow-2xl shadow-black/15">
      <div className="accent-gradient rounded-3xl p-5 text-white">
        <p className="text-xs font-medium text-white/75">Total balance</p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight">₦ 248,500</p>
        <div className="mt-4 flex gap-6 text-xs">
          <div>
            <p className="text-white/70">Available</p>
            <p className="font-bold">₦ 48,500</p>
          </div>
          <div>
            <p className="text-white/70">Invested</p>
            <p className="font-bold">₦ 200,000</p>
          </div>
        </div>
      </div>
      <p className="mb-2 mt-4 px-1 text-xs font-bold uppercase tracking-wider text-muted">Your farms</p>
      {[
        { emoji: '🌶️', name: 'Peppers', meta: '22% · 3 months', progress: 64 },
        { emoji: '🥬', name: 'Fast Vegetables', meta: '1.5% daily', progress: 88 },
      ].map((item, i) => (
        <motion.div
          key={item.name}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.7 + i * 0.15 }}
          className="mb-2 flex items-center gap-3 rounded-2xl bg-surface-2 p-3"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-2xl">{item.emoji}</div>
          <div className="flex-1">
            <p className="text-sm font-bold">{item.name}</p>
            <p className="text-xs text-muted">{item.meta}</p>
          </div>
          <ProgressRing value={item.progress} size={44} stroke={5} />
        </motion.div>
      ))}
      <p className="mt-2 text-center text-[10px] text-muted">Illustration only</p>
    </div>
    <motion.div
      className="absolute -right-5 -top-6 hidden rounded-2xl border border-line bg-surface px-4 py-3 shadow-xl sm:block"
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Harvest in</p>
      <p className="text-sm font-extrabold text-accent">12 days</p>
    </motion.div>
  </motion.div>
);

const LandingPage = () => {
  const { user } = useApp();
  const signedIn = Boolean(user?.emailVerified);

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[42rem] bg-gradient-to-b from-accent/12 to-transparent" />
      <div className="pointer-events-none absolute -right-40 top-20 -z-10 h-96 w-96 rounded-full bg-gold-400/15 blur-3xl" />

      <header className="sticky top-0 z-30 border-b border-transparent bg-canvas/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {signedIn ? (
              <Button to="/dashboard" size="sm" iconRight={ArrowRight}>
                Dashboard
              </Button>
            ) : (
              <>
                <Button to="/sign-in" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Sign in
                </Button>
                <Button to="/sign-up" size="sm">
                  Get started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-10 lg:grid-cols-2 lg:pt-20">
          <motion.div initial="hidden" animate="show" className="text-center lg:text-left">
            <motion.span
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent"
            >
              <Sprout className="h-3.5 w-3.5" /> Agriculture investing, simplified
            </motion.span>
            <motion.h1 variants={fadeUp} custom={1} className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Grow your money <br className="hidden sm:block" />
              with <span className="bg-gradient-to-r from-accent to-gold-500 bg-clip-text text-transparent">real farms.</span>
            </motion.h1>
            <motion.p variants={fadeUp} custom={2} className="mx-auto mt-5 max-w-lg text-lg text-muted lg:mx-0">
              Agrowth connects you to crop cycles across Nigeria. Fund your wallet, back a harvest, and watch your investment grow in real time.
            </motion.p>
            <motion.div variants={fadeUp} custom={3} className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <Button to={signedIn ? '/dashboard' : '/sign-up'} size="lg" iconRight={ArrowRight}>
                {signedIn ? 'Go to dashboard' : 'Start investing'}
              </Button>
              {!signedIn && (
                <Button to="/sign-in" size="lg" variant="outline">
                  I have an account
                </Button>
              )}
            </motion.div>
            <motion.div variants={fadeUp} custom={4} className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted lg:justify-start">
              {['Deposits from ₦100', 'Card, transfer & USSD', 'Live progress tracking'].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {item}
                </span>
              ))}
            </motion.div>
          </motion.div>
          <HeroPreview />
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} className="mx-auto max-w-2xl text-center">
            <motion.p variants={fadeUp} className="text-sm font-bold uppercase tracking-wider text-accent">
              Why Agrowth
            </motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Everything you need to invest in agriculture
            </motion.h2>
          </motion.div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }, i) => (
              <motion.div
                key={title}
                variants={fadeUp}
                custom={i}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: '-60px' }}
                className="group rounded-3xl border border-line bg-surface p-6 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent transition group-hover:scale-110">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 font-bold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted">{text}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="relative overflow-hidden rounded-[2rem] bg-brand-900 px-6 py-14 text-white sm:px-12">
            <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-500/40 blur-3xl" />
            <div className="absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-gold-400/20 blur-3xl" />
            <div className="relative">
              <p className="text-sm font-bold uppercase tracking-wider text-gold-300">How it works</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Three steps to your first harvest</h2>
              <div className="mt-10 grid gap-6 md:grid-cols-3">
                {STEPS.map(({ icon: Icon, title, text }, i) => (
                  <motion.div
                    key={title}
                    variants={fadeUp}
                    custom={i}
                    initial="hidden"
                    whileInView="show"
                    viewport={{ once: true }}
                    className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                        <Icon className="h-6 w-6 text-gold-300" />
                      </div>
                      <span className="text-5xl font-extrabold text-white/10">0{i + 1}</span>
                    </div>
                    <h3 className="mt-5 text-lg font-bold">{title}</h3>
                    <p className="mt-1 text-sm text-white/70">{text}</p>
                  </motion.div>
                ))}
              </div>
              <Button to={signedIn ? '/dashboard' : '/sign-up'} variant="white" size="lg" iconRight={ArrowRight} className="mt-10">
                {signedIn ? 'Open dashboard' : 'Create a free account'}
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted sm:flex-row">
          <Logo textClassName="text-base" />
          <p>© {new Date().getFullYear()} Agrowth. Grow with every harvest.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
