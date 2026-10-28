import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { toast } from 'react-toastify';
import { useApp } from '../context/AppContext';
import { cn } from '../lib/format';

const ThemeToggle = ({ className }) => {
  const { theme, updateAppearance } = useApp();
  const next = theme === 'dark' ? 'light' : 'dark';

  const toggle = () =>
    updateAppearance({ theme: next }).catch((err) => {
      console.error('Error saving theme:', err);
      toast.error('Theme changed on this device only.');
    });

  return (
    <button
      onClick={toggle}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface text-fg transition hover:bg-surface-2',
        className
      )}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ y: -20, opacity: 0, rotate: -90 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: 20, opacity: 0, rotate: 90 }}
          transition={{ duration: 0.2 }}
        >
          {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
};

export default ThemeToggle;
