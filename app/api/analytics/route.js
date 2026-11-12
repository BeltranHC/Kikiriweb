import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { analyticsFilters, buildAnalytics } from '@/lib/analytics.mjs';
export const dynamic='force-dynamic';
export async function GET(request){
 try{
  const {supabase}=await requireSession();requireDeliveryEnabled();
  const filters=analyticsFilters(new URL(request.url).searchParams);const started=performance.now();
  let query=supabase.rpc('ticket_analytics_source');if(request.signal)query=query.abortSignal(request.signal);
  const {data,error}=await query;
  if(error?.code==='PGRST202')throw new HttpError('Estadísticas pendiente de activación. Ejecuta activar_dashboard_estadisticas.sql.',503);
  if(error)throw error;
  return NextResponse.json(buildAnalytics(data,filters),{headers:{'Cache-Control':'private, no-store','Server-Timing':`analytics;dur=${(performance.now()-started).toFixed(1)}`}});
 }catch(error){return apiError(error);}
}
