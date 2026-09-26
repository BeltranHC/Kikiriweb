'use client';

import { Toaster } from 'react-hot-toast';

export default function ToasterWrapper() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--glass-border)',
        },
      }}
    />
  );
}
