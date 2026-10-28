import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { localDate } from '@/lib/domain.mjs';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { supabase } = await requireSession();
    const { data, error } = await supabase.rpc('ticket_stats', { p_date: localDate() });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
