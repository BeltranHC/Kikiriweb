import { requireSession, apiError } from '@/lib/api';
import { fetchAll } from '@/lib/pagination.mjs';
import { dayBounds } from '@/lib/domain.mjs';
import { ValidationError } from '@/lib/validation.mjs';
import { cashReport } from '@/lib/report.mjs';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    let bounds;
    try { bounds = dayBounds(new URL(request.url).searchParams.get('date') || undefined); }
    catch { throw new ValidationError('Fecha inválida'); }
    const tickets = await fetchAll(() => supabase.from('tickets')
      .select('id,ticket_number,is_extra,payment_method,picked_up_at,unit_price,students(name,code)')
      .eq('is_picked_up', true).gte('picked_up_at', bounds.start).lt('picked_up_at', bounds.end)
      .order('picked_up_at', { ascending: false }).order('id'));
    return new Response(cashReport(tickets, bounds.day), { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cierre_caja_${bounds.day}.csv"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) { return apiError(error); }
}
