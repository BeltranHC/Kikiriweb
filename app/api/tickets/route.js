import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { fetchAll } from '@/lib/pagination.mjs';
import { pickupInput, ticketNumber, validateUuid, ValidationError } from '@/lib/validation.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const extra = new URL(request.url).searchParams.get('type') === 'extra';
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
