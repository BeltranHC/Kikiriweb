import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { localDate } from '@/lib/domain.mjs';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { supabase } = await requireSession();
    const { data, error } = await supabase.rpc('ticket_stats', { p_date: localDate() });
    if (error) throw error;

    let pendingStudents = 0;
    try {
      const { data: pendingTickets } = await supabase
        .from('tickets')
        .select('student_id')
        .eq('is_picked_up', false)
        .not('student_id', 'is', null);

      if (pendingTickets) {
        pendingStudents = new Set(pendingTickets.map(t => t.student_id).filter(Boolean)).size;
      }
    } catch {
      // Si la consulta adicional no está disponible, no interrumpe el reporte principal
    }

    const totalStudents = Number(data?.totalStudents || 0);
    const completedStudents = Math.max(0, totalStudents - pendingStudents);

    return NextResponse.json({
      ...data,
      pendingStudents,
      completedStudents,
    });
  } catch (error) { return apiError(error); }
}
