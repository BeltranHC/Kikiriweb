import { APP_TIME_ZONE, parsePayment, summarizePayments } from './domain.mjs';
import { stringifyCSV } from './csv.mjs';

export function cashReport(tickets, day) {
  const rows = [['Nro_Ticket', 'Estudiante', 'Codigo', 'Metodo_Pago', 'Fecha_Hora', 'Cajero']];
  for (const ticket of tickets) {
    const payment = parsePayment(ticket.payment_method);
    rows.push([
      ticket.ticket_number, ticket.students?.name || (ticket.is_extra ? 'Ticket extra' : 'Desconocido'),
      ticket.students?.code || '', payment.label,
      new Date(ticket.picked_up_at).toLocaleString('es-PE', { timeZone: APP_TIME_ZONE }), payment.email || 'Desconocido',
    ]);
  }
  const totals = summarizePayments(tickets);
  rows.push([], ['RESUMEN DE CAJA', day], ['Total Tickets Entregados', tickets.length],
    ['Efectivo Recaudado (S/)', totals.cash], ['Yape Recaudado (S/)', totals.yape], ['Total Recaudado (S/)', totals.total]);
  return stringifyCSV(rows);
}
