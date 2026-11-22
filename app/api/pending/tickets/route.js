import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { validateUuid, ValidationError } from '@/lib/validation.mjs';
import { fetchAll } from '@/lib/pagination.mjs';
import { TICKET_PRICE } from '@/lib/domain.mjs';
import { ticketStatus } from '@/lib/pending.mjs';
export const dynamic = 'force-dynamic';

const isPrepaidTicket = ticket => !!ticket.is_paid && (ticket.payment_method || '').split('|')[0] === 'prepaid';

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

async function loadTicket(supabase, item, studentId) {
  const { data: ticket, error } = await supabase.from('tickets').select('*').eq('id', item.id).eq('student_id', studentId).is('deleted_at', null).maybeSingle();
  if (error) throw error;
  if (!ticket) throw new HttpError('Ticket no encontrado', 404);
  if (ticket.assignment_updated_at !== item.updated_at) throw new HttpError(`El ticket #${ticket.ticket_number} cambió. Actualiza la lista antes de continuar.`, 409);
  return ticket;
}

// Anula el Prepagado (reverso de S/ 0) y devuelve la nueva versión del ticket.
async function voidPrepaid(supabase, ticket, studentId, expectedUpdatedAt) {
  const { data, error } = await supabase.rpc('set_faculty_ticket_payment', { p_ticket_id: ticket.id, p_student_id: studentId, p_action: 'void', p_method: null, p_expected_updated_at: expectedUpdatedAt });
  if (error) throw error;
  return data?.ticket?.assignment_updated_at;
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

// Registra el pago en efectivo o Yape para los tickets seleccionados de un participante
// Maneja tanto tickets sin pago registrado como tickets entregados como Prepagado
export async function PATCH(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const body = await request.json();
    const { studentId, tickets } = parseSelection(body);
    const paymentMethod = body.paymentMethod;
    if (!['cash', 'yape'].includes(paymentMethod)) throw new ValidationError('Indica efectivo o Yape');

    let changed = 0;
    let totalCents = 0;

    for (const item of tickets) {
      const ticket = await loadTicket(supabase, item, studentId);
      if (ticket.no_show_at) throw new HttpError(`El ticket #${ticket.ticket_number} figura como No recogió. Deshaz esa marca antes de cobrarlo.`, 409);
      let expectedUpdatedAt = item.updated_at;
      // Si fue entregado como Prepagado, primero se anula el prepagado (S/ 0)
      if (isPrepaidTicket(ticket)) expectedUpdatedAt = await voidPrepaid(supabase, ticket, studentId, expectedUpdatedAt);

      // Se registra el pago efectivo o Yape
      const { error: payErr } = await supabase.rpc('set_faculty_ticket_payment', {
        p_ticket_id: ticket.id,
        p_student_id: studentId,
        p_action: 'pay',
        p_method: paymentMethod,
        p_expected_updated_at: expectedUpdatedAt,
      });
      if (payErr) throw payErr;

      changed++;
      totalCents += Math.round(Number(ticket.unit_price ?? TICKET_PRICE) * 100);
    }

    return NextResponse.json({ studentId, changed, total: totalCents / 100 });
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

    let changed = 0;
    for (const item of tickets) {
      const ticket = await loadTicket(supabase, item, studentId);
      if (!('no_show_at' in ticket)) throw new HttpError('Opción pendiente de activación. Ejecuta supabase/migrations/20261121_ticket_no_show.sql.', 503);
      let expectedUpdatedAt = item.updated_at;
      if (body.noShow) {
        if (ticket.no_show_at) continue;
        if (ticket.is_paid && !isPrepaidTicket(ticket)) throw new HttpError(`El ticket #${ticket.ticket_number} tiene un pago registrado; no se puede marcar como No recogió.`, 409);
        if (isPrepaidTicket(ticket)) expectedUpdatedAt = await voidPrepaid(supabase, ticket, studentId, expectedUpdatedAt);
      } else if (!ticket.no_show_at) continue;
      const { error } = await supabase.rpc('set_ticket_no_show', { p_ticket_id: ticket.id, p_student_id: studentId, p_expected_updated_at: expectedUpdatedAt, p_no_show: body.noShow });
      if (error?.code === 'PGRST202') throw new HttpError('Opción pendiente de activación. Ejecuta supabase/migrations/20261121_ticket_no_show.sql.', 503);
      if (error) throw error;
      changed++;
    }
    return NextResponse.json({ studentId, changed, noShow: body.noShow });
  } catch (error) { return apiError(error); }
}
