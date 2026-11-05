import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { facultyPaymentInput } from '@/lib/faculty.mjs';
export async function PATCH(request) {
  try {
    const { supabase } = await requireSession();
    const input = facultyPaymentInput(await request.json());
    const { data, error } = await supabase.rpc('set_faculty_ticket_payment', { p_ticket_id: input.ticketId, p_student_id: input.studentId, p_action: input.action, p_method: input.method, p_expected_updated_at: input.expectedUpdatedAt });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
