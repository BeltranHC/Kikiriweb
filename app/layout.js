import './globals.css';

import { ToastProvider } from '@/components/Toast';
import SessionRecovery from '@/components/SessionRecovery';

export const metadata = {
  title: 'KikiriWeb - Sistema de Gestión de Tickets',
  description: 'Sistema web para gestionar la entrega de tickets de pollada estudiantil. Busca estudiantes, gestiona tickets y registra entregas.',
  keywords: 'pollada, tickets, gestión, estudiantes, kikiriweb',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('kikiriweb-theme') === 'dark') {
                  localStorage.removeItem('kikiriweb-theme');
                }
                const saved = localStorage.getItem('kikiriweb-theme-v2');
                if (saved === 'dark') {
                  document.documentElement.setAttribute('data-theme', 'dark');
                } else {
                  document.documentElement.setAttribute('data-theme', 'light');
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body>
        <ToastProvider>
          {children}
          <SessionRecovery />
        </ToastProvider>
      </body>
    </html>
  );
}
