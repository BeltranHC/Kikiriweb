export { parseCSV } from './csv.mjs';
export { debounce } from './debounce.mjs';

export function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
export function percentage(part, total) { return total ? Math.round((part / total) * 100) : 0; }
export function generateTicketRange(start, end) { return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i); }
export function cn(...classes) { return classes.filter(Boolean).join(' '); }
export function formatTicketNumber(number) { return String(number).padStart(4, '0'); }
