import { motion } from 'framer-motion';
import { ArrowLeft, Home } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Button, Logo } from '../components/ui';

const NotFound = () => {
  const { user } = useApp();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <Logo className="mb-10" />
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }} className="relative">
        <p className="text-[8rem] font-extrabold leading-none tracking-tighter text-accent/15 sm:text-[11rem]">404</p>
        <motion.span className="absolute inset-0 flex items-center justify-center text-6xl sm:text-7xl" animate={{ y: [0, -12, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
          🌱
        </motion.span>
      </motion.div>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Nothing growing here</h1>
      <p className="mt-2 max-w-sm text-muted">The page you’re looking for doesn’t exist or has moved.</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" icon={ArrowLeft} onClick={() => window.history.back()}>
          Go back
        </Button>
        <Button to={user ? '/dashboard' : '/'} icon={Home}>
          {user ? 'Dashboard' : 'Home'}
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
