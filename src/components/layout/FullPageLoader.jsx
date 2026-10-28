import { motion } from 'framer-motion';
import { Spinner } from '../ui';

const FullPageLoader = () => (
  <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-canvas">
    <motion.img
      src="/assets/Submark-removebg-preview.png"
      alt="Agrowth"
      className="h-16 w-16"
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
    />
    <Spinner className="h-5 w-5 border-2" />
  </div>
);

export const PageLoader = () => (
  <div className="flex min-h-[50dvh] items-center justify-center">
    <Spinner />
  </div>
);

export default FullPageLoader;
