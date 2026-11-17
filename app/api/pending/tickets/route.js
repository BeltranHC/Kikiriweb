import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { requireDeliveryEnabled } from '@/lib/module-mode.mjs';
import { validateUuid } from '@/lib/validation.mjs';
import { fetchAll } from '@/lib/pagination.mjs';
export const dynamic = 'force-dynamic';

// Retorna los tickets recogidos sin pagar (o prepagados) de un estudiante,
// con assignment_updated_at para poder enviarlos al RPC de pago conjunto.
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const studentId = validateUuid(new URL(request.url).searchParams.get('studentId'));
    const tickets = await fetchAll(() =>
      supabase.from('tickets').select('id,ticket_number,student_id,is_picked_up,is_paid,is_extra,payment_method,unit_price,paid_amount,assignment_updated_at')
        .eq('student_id', studentId).is('deleted_at', null).eq('is_available', false)
        .eq('is_picked_up', true)
        .order('ticket_number').order('id'));
    // Solo tickets recogidos que no estén pagados, o pagados como prepagado
    const pending = tickets.filter(ticket => {
      if (!ticket.is_paid) return true;
      const method = (ticket.payment_method || '').split('|')[0];
      return method === 'prepaid';
    });
    return NextResponse.json({ studentId, tickets: pending }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

