import { validateUuid, ValidationError } from './validation.mjs';
import { TICKET_PRICE } from './domain.mjs';

export function batchPaymentInput(input) {
  if (!input || typeof input !== 'object' || !['pending','cash','yape'].includes(input.condition)
    || !Array.isArray(input.tickets) || input.tickets.length < 1 || input.tickets.length > 2000
    || typeof input.expectedTotal !== 'number' || !Number.isFinite(input.expectedTotal) || input.expectedTotal < 0
    || !Number.isSafeInteger(Math.round(input.expectedTotal * 100)) || Math.abs(input.expectedTotal * 100 - Math.round(input.expectedTotal * 100)) > .0001) throw new ValidationError('Pago conjunto inv\u00e1lido');
  const seen = new Set();
  const tickets = input.tickets.map(ticket => {
    const id = validateUuid(ticket?.id);
    if (seen.has(id.toLowerCase()) || typeof ticket.updated_at !== 'string' || !Number.isFinite(Date.parse(ticket.updated_at))) throw new ValidationError('Tickets repetidos o versiones inv\u00e1lidas');
    seen.add(id.toLowerCase());return { id, updated_at: ticket.updated_at };
  });
  return { studentId: validateUuid(input.studentId), tickets, condition: input.condition, expectedTotal: Math.round(input.expectedTotal * 100) / 100 };
}

export function paymentSelection(tickets, ids, condition) {
  const selected = tickets.filter(ticket => ids.includes(ticket.id));
  const changing = selected.filter(ticket => condition === 'pending' ? ticket.is_paid : !ticket.is_paid);
  const cents = changing.reduce((total,ticket) => total + Math.round(Number(condition === 'pending'
    ? ticket.paid_amount ?? ticket.unit_price ?? TICKET_PRICE : ticket.unit_price ?? TICKET_PRICE) * 100),0);
  return { selected, changing, total: cents / 100, unchanged: selected.length - changing.length };
}
