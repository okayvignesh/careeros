'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface PageRevealProps {
  children: ReactNode;
  className?: string;
}

const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
};

/** Wraps route content with a spring-based fade+lift on navigation. */
export function PageReveal({ children, className }: PageRevealProps) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={pathname} {...enter} className={className}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
