import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { fetchAll } from '@/lib/pagination.mjs';
import { pickupInput, ticketNumber, validateUuid, ValidationError } from '@/lib/validation.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const url = new URL(request.url);
    const extra = url.searchParams.get('type') === 'extra';
    const numberParam = url.searchParams.get('number');

    if (numberParam) {
      const num = ticketNumber(numberParam);
      const { data: ticket, error } = await supabase
        .from('tickets')
        .select('id, ticket_number, student_id, is_picked_up, picked_up_at, picked_up_by, is_extra, is_paid, unit_price, movement_id, payment_method')
        .eq('ticket_number', num)
        .maybeSingle();

      if (error) throw error;
      if (!ticket) return NextResponse.json({ error: `Ticket #${num} no encontrado` }, { status: 404 });

      let student = null;
      if (ticket.student_id) {
        const studentFields = 'id,name,code,dni,created_at,tickets(id,ticket_number,is_picked_up,picked_up_at,picked_up_by,movement_id,is_extra,is_paid,payment_method,unit_price)';
        const { data: s } = await supabase
          .from('students')
          .select(studentFields)
          .eq('id', ticket.student_id)
          .maybeSingle();
        student = s;
      }

      return NextResponse.json({ ...ticket, student });
    }

    const tickets = await fetchAll(() => {
      const query = supabase.from('tickets').select('*').order('ticket_number').order('id');
      return extra ? query.eq('is_extra', true) : query;
    });
    return NextResponse.json(tickets);
  } catch (error) { return apiError(error); }
}

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Datos de ticket inválidos');
    const number = ticketNumber(body.ticketNumber);
    if (typeof body.isExtra !== 'boolean') throw new ValidationError('Tipo de ticket inválido');
    if (body.isExtra && body.studentId) throw new ValidationError('Un ticket extra no se asigna a un estudiante');
    const studentId = body.studentId ? validateUuid(body.studentId) : null;
    if (!body.isExtra && !studentId) throw new ValidationError('Selecciona un estudiante');
    const { data, error } = await supabase.rpc('create_ticket', { p_ticket_number: number, p_student_id: studentId, p_is_extra: body.isExtra });
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request) {
  try {
    const { supabase } = await requireSession();
    const input = pickupInput(await request.json());
    const { data, error } = await supabase.rpc('update_ticket_pickup', {
      p_ticket_ids: input.ticketIds, p_is_picked_up: input.isPickedUp,
      p_payment_method: input.paymentMethod, p_expected_movement_id: input.expectedMovementId,
    });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
