import './globals.css';

import { ToastProvider } from '@/components/Toast';

export const metadata = {
  title: 'KikiriWeb - Sistema de Gestión de Tickets',
  description: 'Sistema web para gestionar la entrega de tickets de pollada estudiantil. Busca estudiantes, gestiona tickets y registra entregas.',
  keywords: 'pollada, tickets, gestión, estudiantes, kikiriweb',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
