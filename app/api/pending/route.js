import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { pendingFilters, buildPending } from '@/lib/pending.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { supabase } = await requireSession(); requireDeliveryEnabled();
    const filters = pendingFilters(new URL(request.url).searchParams);
    // Reutiliza la instantánea de solo lectura del dashboard de Estadísticas.
    let query = supabase.rpc('ticket_analytics_source'); if (request.signal) query = query.abortSignal(request.signal);
    const { data, error } = await query;
    if (error?.code === 'PGRST202') throw new HttpError('Módulo pendiente de activación. Ejecuta activar_dashboard_estadisticas.sql.', 503);
    if (error) throw error;
    return NextResponse.json(buildPending(data, filters), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
