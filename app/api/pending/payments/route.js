import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { fetchAll } from '@/lib/pagination.mjs';
import { paymentHistoryFilters, buildPaymentHistory, HISTORY_METHODS } from '@/lib/payment-history.mjs';
export const dynamic = 'force-dynamic';

// Historial de pagos en efectivo o Yape (y sus anulaciones) con el usuario que los registró.
// Los cobros hechos en Deudores se agrupan en una sola operación con todos sus tickets.
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const filters = paymentHistoryFilters(new URL(request.url).searchParams);
    const events = await fetchAll(() =>
      supabase.from('faculty_payments').select('id,kind,amount,method,created_at,actor_email,ticket_snapshot')
        .in('method', HISTORY_METHODS).gte('created_at', filters.start).lt('created_at', filters.end)
        .order('created_at', { ascending: false }).order('id'));
    const { from, to, scope } = filters;
    return NextResponse.json({ filters: { from, to, scope }, ...buildPaymentHistory(events, scope), generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
