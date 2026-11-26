import { dayBounds, localDate } from './domain.mjs';
import { ValidationError } from './validation.mjs';

export const HISTORY_METHODS = ['cash', 'yape'];
export const HISTORY_SCOPES = ['all', 'pending'];
const MAX_DAYS = 366;

// Filtros del historial de pagos: rango de fechas (hora de Lima) y origen del cobro.
export function paymentHistoryFilters(params) {
  const today = localDate();
  const to = params.get('to') || today;
  const from = params.get('from') || localDate(Date.now() - 29 * 86400000);
  const scope = params.get('scope') || 'all';
  let start, end;
  try { start = dayBounds(from).start; end = dayBounds(to).end; } catch { throw new ValidationError('Fecha inválida'); }
  if (Date.parse(start) >= Date.parse(end)) throw new ValidationError('La fecha inicial debe ser anterior a la final');
  if (Date.parse(end) - Date.parse(start) > MAX_DAYS * 86400000) throw new ValidationError('Elige un rango de hasta un año');
  if (!HISTORY_SCOPES.includes(scope)) throw new ValidationError('Origen inválido');
  return { from, to, start, end, scope };
}

const cents = value => Math.round(Number(value || 0) * 100);

// Agrupa los movimientos de faculty_payments en operaciones: un cobro de Deudores (mismo batch_id) es una sola
// fila con todos sus tickets; los pagos y anulaciones hechos desde otras pantallas se muestran uno por uno.
export function buildPaymentHistory(events, scope = 'all') {
  const groups = new Map();
  for (const event of events || []) {
    if (!HISTORY_METHODS.includes(event.method) || !['payment', 'void'].includes(event.kind)) continue;
    const snapshot = event.ticket_snapshot || {};
    const origin = snapshot.origin === 'pending' ? 'pending' : 'other';
    if (scope === 'pending' && origin !== 'pending') continue;
    const key = (event.kind === 'payment' && snapshot.batch_id) || event.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: key, kind: event.kind, origin, method: event.method, createdAt: event.created_at, actor: event.actor_email || null,
        studentId: snapshot.student_id || null, studentName: snapshot.student_name || (snapshot.is_extra ? 'Ticket extra' : 'Sin participante'),
        studentCode: snapshot.student_code || null, tickets: [], cents: 0,
      };
      groups.set(key, group);
    }
    if (snapshot.ticket_number != null) group.tickets.push(Number(snapshot.ticket_number));
    group.cents += cents(event.amount);
    if (event.created_at > group.createdAt) group.createdAt = event.created_at;
  }
  const rows = [...groups.values()]
    .map(({ cents: value, tickets, ...group }) => ({ ...group, tickets: tickets.sort((a, b) => a - b), amount: (group.kind === 'void' ? -value : value) / 100 }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const sum = filter => rows.filter(filter).reduce((total, row) => total + cents(row.amount), 0) / 100;
  return {
    rows,
    summary: {
      operations: rows.filter(row => row.kind === 'payment').length,
      tickets: rows.filter(row => row.kind === 'payment').reduce((total, row) => total + row.tickets.length, 0),
      voids: rows.filter(row => row.kind === 'void').length,
      cash: sum(row => row.method === 'cash'),
      yape: sum(row => row.method === 'yape'),
      net: sum(() => true),
    },
  };
}
