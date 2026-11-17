import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { validateUuid, ValidationError } from '@/lib/validation.mjs';
import { fetchAll } from '@/lib/pagination.mjs';
import { TICKET_PRICE } from '@/lib/domain.mjs';
export const dynamic = 'force-dynamic';

// Retorna los tickets recogidos sin pagar (o prepagados) de un estudiante,
// con assignment_updated_at para poder enviarlos al RPC de pago.
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const studentId = validateUuid(new URL(request.url).searchParams.get('studentId'));
    const tickets = await fetchAll(() =>
      supabase.from('tickets').select('id,ticket_number,student_id,is_picked_up,is_paid,is_extra,payment_method,unit_price,paid_amount,assignment_updated_at')
        .eq('student_id', studentId).is('deleted_at', null).eq('is_available', false)
        .eq('is_picked_up', true)
        .order('ticket_number').order('id'));
    // Solo tickets recogidos que no estén pagados, o pagados como prepagado
    const pending = tickets.filter(ticket => {
      if (!ticket.is_paid) return true;
      const method = (ticket.payment_method || '').split('|')[0];
      return method === 'prepaid';
    });
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
    if (!body || typeof body !== 'object') throw new ValidationError('Datos de pago inválidos');
    const studentId = validateUuid(body.studentId);
    const paymentMethod = body.paymentMethod;
    if (!['cash', 'yape'].includes(paymentMethod)) throw new ValidationError('Indica efectivo o Yape');
    if (!Array.isArray(body.tickets) || body.tickets.length < 1 || body.tickets.length > 2000) {
      throw new ValidationError('Selección de tickets inválida');
    }
    const tickets = body.tickets.map(t => {
      const id = validateUuid(t?.id);
      if (typeof t?.updated_at !== 'string' || !Number.isFinite(Date.parse(t?.updated_at))) {
        throw new ValidationError('Versiones de tickets inválidas');
      }
      return { id, updated_at: t.updated_at };
    });

    let changed = 0;
    let totalCents = 0;

    for (const item of tickets) {
      const { data: ticket, error: fetchErr } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', item.id)
        .eq('student_id', studentId)
        .is('deleted_at', null)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!ticket) throw new HttpError('Ticket no encontrado', 404);
      if (ticket.assignment_updated_at !== item.updated_at) {
        throw new HttpError(`El ticket #${ticket.ticket_number} cambió. Actualiza la lista antes de continuar.`, 409);
      }

      const method = (ticket.payment_method || '').split('|')[0];
      const isPrepaid = ticket.is_paid && method === 'prepaid';
      let expectedUpdatedAt = item.updated_at;

      // Si fue entregado como Prepagado, primero se anula el prepagado (S/ 0)
      if (isPrepaid) {
        const { data: voidResult, error: voidErr } = await supabase.rpc('set_faculty_ticket_payment', {
          p_ticket_id: ticket.id,
          p_student_id: studentId,
          p_action: 'void',
          p_method: null,
          p_expected_updated_at: expectedUpdatedAt,
        });
        if (voidErr) throw voidErr;
        expectedUpdatedAt = voidResult?.ticket?.assignment_updated_at;
      }

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
