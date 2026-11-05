import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { fetchAll } from '@/lib/pagination.mjs';
import { validateUuid } from '@/lib/validation.mjs';
import { ticketEditInput, ticketIdentityInput } from '@/lib/faculty.mjs';
export const dynamic = 'force-dynamic';

// Read current identities from the immutable batch ID, never from its old ticket numbers.
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const assignmentId = validateUuid(new URL(request.url).searchParams.get('assignmentId'));
    const abortable = query => request.signal ? query.abortSignal(request.signal) : query;
    const { data: assignment, error } = await abortable(supabase.from('ticket_assignments')
      .select('id,student_id').eq('id', assignmentId).maybeSingle());
    if (error) throw error;
    if (!assignment) throw new HttpError('Asignaci\u00f3n no encontrada', 404);
    if (!assignment.student_id) return NextResponse.json({ assignmentId, tickets: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    const current = await fetchAll(() => abortable(supabase.from('tickets')
      .select('*,student:students(id,name,code,semester,recipient_type,deleted_at)')
      .eq('assignment_id', assignmentId).eq('student_id', assignment.student_id).is('deleted_at', null)
      .order('ticket_number').order('id')));
    const tickets = current.filter(ticket => ticket.student && !ticket.student.deleted_at && !ticket.is_available);
    const editable = tickets.filter(ticket => !ticket.is_extra && !ticket.is_paid && !ticket.is_picked_up && !ticket.movement_id);
    const batches = [];
    for (let offset = 0; offset < editable.length; offset += 100) batches.push(editable.slice(offset, offset + 100).map(ticket => ticket.id));
    const movements = (await Promise.all(batches.map(ids => fetchAll(() => abortable(supabase.from('ticket_movements')
      .select('id,ticket_ids').overlaps('ticket_ids', ids).order('id')))))).flat();
    const protectedIds = new Set(movements.flatMap(movement => movement.ticket_ids));
    return NextResponse.json({ assignmentId, tickets: tickets.map(ticket => ({ ...ticket, can_manage: true,
      can_edit: !ticket.is_extra && !ticket.is_paid && !ticket.is_picked_up && !ticket.movement_id && !protectedIds.has(ticket.id),
    })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request) {
  try {
    const { supabase } = await requireSession();
    const input = ticketEditInput(await request.json());
    const { data,error } = await supabase.rpc('edit_faculty_ticket', {
      p_ticket_id: input.ticketId, p_student_id: input.studentId, p_action: input.action,
      p_ticket_number: input.ticketNumber, p_destination_id: input.destinationId, p_expected_updated_at: input.expectedUpdatedAt,
    });
    if(error) throw error;
    return NextResponse.json(data);
  } catch(error) {return apiError(error);}
}

export async function DELETE(request) {
  try {
    const { supabase } = await requireSession();
    const input = ticketIdentityInput(await request.json());
    const { data, error } = await supabase.rpc('delete_faculty_ticket', { p_ticket_id: input.ticketId, p_student_id: input.studentId, p_expected_updated_at: input.expectedUpdatedAt });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
