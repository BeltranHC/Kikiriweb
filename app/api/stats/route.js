import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { localDate } from '@/lib/domain.mjs';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const { data,error } = await supabase.rpc('delivery_stats',{p_date:localDate()});
    if(error)throw error;return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) { return apiError(error); }
}
