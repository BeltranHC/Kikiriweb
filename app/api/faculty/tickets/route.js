import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { ticketEditInput, ticketIdentityInput } from '@/lib/faculty.mjs';
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
