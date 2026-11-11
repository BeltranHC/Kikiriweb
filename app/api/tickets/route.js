import { requireDeliveryEnabled, requireLegacyAdminEnabled } from '@/lib/module-mode.mjs';
import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { fetchAll } from '@/lib/pagination.mjs';
import { deliveryInput } from '@/lib/delivery.mjs';
import { ticketNumber, validateUuid, ValidationError } from '@/lib/validation.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const url = new URL(request.url);
    const extra = url.searchParams.get('type') === 'extra';
    const numberParam = url.searchParams.get('number');

    if (numberParam) {
      const num = ticketNumber(numberParam);
      const { data: ticket, error } = await supabase
        .from('tickets')
        .select('*').is('deleted_at',null).eq('is_available',false)
        .eq('ticket_number', num)
        .maybeSingle();

      if (error) throw error;
      if (!ticket || (!ticket.student_id && !ticket.is_extra)) return NextResponse.json({ error: `Ticket #${num} no encontrado` }, { status: 404 });

      let student = null;
      if (ticket.student_id) {
        const studentFields = 'id,name,code,deleted_at,tickets(*)';
        const { data: s, error: studentError } = await supabase
          .from('students')
          .select(studentFields)
          .eq('id', ticket.student_id).is('deleted_at',null).is('tickets.deleted_at',null).eq('tickets.is_available',false)
          .maybeSingle();
        if(studentError)throw studentError;
        if(!s) return NextResponse.json({error:'Participante no disponible'},{status:404});
        student = s;
      }

      return NextResponse.json({ ...ticket, student });
    }

    const tickets = await fetchAll(() => {
      const query = supabase.from('tickets').select('*').is('deleted_at',null).eq('is_available',false).order('ticket_number').order('id');
      return extra ? query.eq('is_extra', true) : query;
    });
    return NextResponse.json(tickets);
  } catch (error) { return apiError(error); }
}

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    requireLegacyAdminEnabled();
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
    requireDeliveryEnabled();
    const input=deliveryInput(await request.json());
    const {data,error}=input.isPickedUp
      ? await supabase.rpc('deliver_tickets',{p_ticket_ids:input.ticketIds,p_payment_method:input.paymentMethod,p_expected_tickets:input.expectedTickets})
      : await supabase.rpc('undo_delivery',{p_ticket_ids:input.ticketIds,p_movement_id:input.expectedMovementId});
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
