'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

type ModalPortalProps = {
  children: ReactNode;
  className?: string;
};

export function ModalPortal({ children, className }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className={className}>{children}</div>,
    document.body,
  );
}
