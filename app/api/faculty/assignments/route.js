import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { allocationInput } from '@/lib/faculty.mjs';
import { assignmentHistoryFilters } from '@/lib/assignment-history.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    const input = allocationInput(await request.json());
    const { data, error } = await supabase.rpc('assign_student_tickets', { p_student_id: input.studentId, p_ticket_numbers: input.ticketNumbers });
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const input=assignmentHistoryFilters(new URL(request.url).searchParams);
    const { data,error }=await supabase.rpc('faculty_assignment_history',{
      p_query:input.query,p_semester:input.semester,p_from:input.from,p_until:input.until,p_page:input.page,p_page_size:input.pageSize,
    });
    if(error) throw error;
    return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
