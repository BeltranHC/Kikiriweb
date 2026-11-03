import { requireSession, apiError } from '@/lib/api';
import { loadParticipantExport } from '@/lib/faculty-export.mjs';
import { localDate } from '@/lib/domain.mjs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { supabase } = await requireSession();
    const csv = await loadParticipantExport(supabase);
    return new Response(csv,{headers:{
      'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="participantes_tickets_${localDate()}.csv"`,
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
    }});
  } catch(error) { return apiError(error); }
}
