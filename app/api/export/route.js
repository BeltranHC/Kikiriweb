import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { requireSession, apiError } from '@/lib/api';
import { dayBounds } from '@/lib/domain.mjs';
import { ValidationError } from '@/lib/validation.mjs';
import { deliveryCashCSV } from '@/lib/delivery.mjs';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    let bounds;
    try { bounds = dayBounds(new URL(request.url).searchParams.get('date') || undefined); }
    catch { throw new ValidationError('Fecha inválida'); }
    const {data,error}=await supabase.rpc('delivery_cash_report',{p_date:bounds.day});
    if(error)throw error;
    return new Response(deliveryCashCSV(data, bounds.day), { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cierre_caja_${bounds.day}.csv"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) { return apiError(error); }
}
