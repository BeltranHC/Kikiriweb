import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { assignmentHistoryFilters } from '@/lib/assignment-history.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const input=assignmentHistoryFilters(new URL(request.url).searchParams);
    const { data,error }=await supabase.rpc('faculty_change_history', {
      p_query: input.query, p_from: input.from, p_until: input.until, p_page: input.page, p_page_size: input.pageSize,
    });
    if(error) throw error;
    return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return apiError(error);}
}
