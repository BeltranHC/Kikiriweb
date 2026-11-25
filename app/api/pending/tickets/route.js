import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { validateUuid, ValidationError } from '@/lib/validation.mjs';
import { fetchAll } from '@/lib/pagination.mjs';
import { ticketStatus } from '@/lib/pending.mjs';
export const dynamic = 'force-dynamic';

// Valida participante y versiones de los tickets enviados por el modal de Deudores.
function parseSelection(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('Datos inválidos');
  const studentId = validateUuid(body.studentId);
  if (!Array.isArray(body.tickets) || body.tickets.length < 1 || body.tickets.length > 2000) throw new ValidationError('Selección de tickets inválida');
  const tickets = body.tickets.map(t => {
    const id = validateUuid(t?.id);
    if (typeof t?.updated_at !== 'string' || !Number.isFinite(Date.parse(t?.updated_at))) throw new ValidationError('Versiones de tickets inválidas');
    return { id, updated_at: t.updated_at };
  });
  if (new Set(tickets.map(t => t.id)).size !== tickets.length) throw new ValidationError('Selección de tickets inválida');
  return { studentId, tickets };
}

// Cobro y "No recogió" se guardan con una sola llamada: la base los aplica a todos los tickets o a ninguno.
const ACTIVATION = 'Cobro en Deudores pendiente de activación. Ejecuta supabase/migrations/20261125_atomic_pending_payments.sql.';
function rpcError(error) {
  if (error?.code === 'PGRST202') return new HttpError(ACTIVATION, 503);
  return error;
}

// Retorna los tickets de un participante que siguen pendientes: recogidos sin pagar o como Prepagado,
// asignados sin recoger ni pagar y marcados como "No recogió", con su versión para las acciones del modal.
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const studentId = validateUuid(new URL(request.url).searchParams.get('studentId'));
    const tickets = await fetchAll(() =>
      supabase.from('tickets').select('*')
        .eq('student_id', studentId).is('deleted_at', null).eq('is_available', false)
        .order('ticket_number').order('id'));
    const pending = tickets.map(ticket => ({ ...ticket, status: ticketStatus(ticket) })).filter(ticket => ticket.status)
      .map(({ id, ticket_number, student_id, is_picked_up, is_paid, is_extra, payment_method, unit_price, paid_amount, assignment_updated_at, no_show_at, no_show_by_email, status }) =>
        ({ id, ticket_number, student_id, is_picked_up, is_paid, is_extra, payment_method, unit_price, paid_amount, assignment_updated_at, no_show_at: no_show_at || null, no_show_by_email: no_show_by_email || null, status }));
    return NextResponse.json({ studentId, tickets: pending }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

// Cobra en efectivo o Yape los tickets elegidos, incluidos los entregados como Prepagado (se anula el Prepagado
// y se cobra en la misma transacción). La base rechaza todo si cambió un ticket o el total confirmado.
export async function PATCH(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const body = await request.json();
    const { studentId, tickets } = parseSelection(body);
    const paymentMethod = body.paymentMethod;
    if (!['cash', 'yape'].includes(paymentMethod)) throw new ValidationError('Indica efectivo o Yape');
    const expectedTotal = body.expectedTotal;
    if (typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal) || expectedTotal < 0) throw new ValidationError('Confirma nuevamente el total a cobrar');
    const { data, error } = await supabase.rpc('pay_pending_tickets', { p_student_id: studentId, p_tickets: tickets, p_method: paymentMethod, p_expected_total: expectedTotal });
    if (error) throw rpcError(error);
    return NextResponse.json({ studentId, changed: data.changed, total: Number(data.total) });
  } catch (error) { return apiError(error); }
}

// Marca (noShow: true) o desmarca (noShow: false) tickets como "No recogió": la persona no se presentó,
// así que no se cobran. Al marcar se anula el Prepagado (S/ 0) y la entrega; un pago real lo impide.
export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const body = await request.json();
    const { studentId, tickets } = parseSelection(body);
    if (typeof body.noShow !== 'boolean') throw new ValidationError('Indica si el participante recogió o no');
    const { data, error } = await supabase.rpc('set_pending_no_show', { p_student_id: studentId, p_tickets: tickets, p_no_show: body.noShow });
    if (error) throw rpcError(error);
    return NextResponse.json({ studentId, changed: data.changed, noShow: body.noShow });
  } catch (error) { return apiError(error); }
}
