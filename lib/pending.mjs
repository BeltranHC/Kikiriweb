import { TICKET_PRICE, parsePayment } from './domain.mjs';
import { ValidationError } from './validation.mjs';
import { stringifyCSV } from './csv.mjs';
import { ANALYTICS_GROUPS, groupOf, labelOf } from './analytics.mjs';

// Participantes que ya recogieron su pollada y todavía deben el pago: tickets recogidos sin pago
// registrado o entregados como Prepagado (S/ 0 en caja; el dinero aún no figura como cobrado).
export function pendingFilters(params) {
  const group = params.get('group') || 'all';
  if (group !== 'all' && !ANALYTICS_GROUPS.some(item => item.id === group)) throw new ValidationError('Grupo inválido');
  return { group };
}

const cents = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('Importe no válido en los pagos pendientes');
  return Math.round(amount * 100);
};

export function buildPending(source, filters = { group: 'all' }, now = new Date()) {
  if (!source || !['students', 'tickets', 'movements'].every(key => Array.isArray(source[key]))) throw new Error('La fuente de pagos pendientes está incompleta');
  const students = new Map(source.students.map(person => [person.id, person]));
  // Última entrega registrada de cada ticket: indica cuándo se recogió y quién lo entregó.
  const pickups = new Map();
  for (const movement of source.movements) {
    if (movement.kind !== 'pickup' || !Number.isFinite(Date.parse(movement.created_at))) continue;
    for (const item of movement.items || []) {
      const known = pickups.get(item.id);
      if (!known || Date.parse(known.at) < Date.parse(movement.created_at)) pickups.set(item.id, { at: movement.created_at, by: movement.actor_email || '' });
    }
  }
  const owners = new Map();
  for (const ticket of source.tickets) {
    if (ticket.deleted_at || ticket.is_available) continue;
    const extra = !ticket.student_id && !!ticket.is_extra;
    const person = students.get(ticket.student_id);
    if (!extra && (!person || person.deleted_at)) continue;
    const group = groupOf(person, extra);
    if (filters.group !== 'all' && group !== filters.group) continue;
    const id = extra ? 'extras' : person.id;
    if (!owners.has(id)) owners.set(id, { id, name: extra ? 'Tickets extra' : person.name, code: person?.code || '', group, groupLabel: labelOf(group), assigned: 0, tickets: [] });
    const owner = owners.get(id);
    owner.assigned++;
    if (!ticket.is_picked_up) continue;
    const status = !ticket.is_paid ? 'unpaid' : parsePayment(ticket.payment_method).method === 'prepaid' ? 'prepaid' : null;
    if (!status) continue;
    const pickup = pickups.get(ticket.id);
    owner.tickets.push({ id: ticket.id, number: ticket.ticket_number, status, price: cents(ticket.unit_price ?? TICKET_PRICE) / 100, pickedAt: pickup?.at || null, deliveredBy: pickup?.by || '' });
  }
  const rows = [...owners.values()].filter(owner => owner.tickets.length).map(owner => {
    const tickets = owner.tickets.sort((a, b) => a.number - b.number);
    const last = tickets.filter(ticket => ticket.pickedAt).sort((a, b) => Date.parse(b.pickedAt) - Date.parse(a.pickedAt))[0];
    return { ...owner, tickets, count: tickets.length, prepaid: tickets.filter(ticket => ticket.status === 'prepaid').length, due: tickets.reduce((sum, ticket) => sum + cents(ticket.price), 0) / 100,
      pickedAt: last?.pickedAt || null, deliveredBy: [...new Set(tickets.map(ticket => ticket.deliveredBy).filter(Boolean))] };
  }).sort((a, b) => b.due - a.due || a.name.localeCompare(b.name, 'es'));
  const tickets = rows.reduce((sum, row) => sum + row.count, 0);
  return { generatedAt: now.toISOString(), filters,
    summary: { people: rows.length, tickets, prepaid: rows.reduce((sum, row) => sum + row.prepaid, 0), due: rows.reduce((sum, row) => sum + cents(row.due), 0) / 100 },
    rows, options: { groups: ANALYTICS_GROUPS } };
}

export function pendingCSV(report, format = value => value || '') {
  return stringifyCSV([
    ['KikiriWeb - Recogieron sin pagar', report.generatedAt], ['Grupo', report.filters.group],
    ['Participantes', report.summary.people], ['Tickets', report.summary.tickets], ['Entregados como Prepagado', report.summary.prepaid], ['Sin pago registrado', report.summary.tickets - report.summary.prepaid], ['Por cobrar', report.summary.due], [],
    ['Nombre', 'Código', 'Grupo', 'Tickets recogidos sin pagar', 'Cantidad', 'Prepagado', 'Sin pago registrado', 'Por cobrar', 'Última entrega', 'Entregado por'],
    ...report.rows.map(row => [row.name, row.code, row.groupLabel, row.tickets.map(ticket => ticket.number).join('; '), row.count, row.prepaid, row.count - row.prepaid, row.due, format(row.pickedAt), row.deliveredBy.join('; ')]),
  ]);
}
