import { NextResponse } from 'next/server';
import { requireSession, apiError } from '@/lib/api';
import { fetchAll } from '@/lib/pagination.mjs';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { supabase } = await requireSession();
    const [events, current] = await Promise.all([
      fetchAll(() => supabase.from('ticket_movements').select('*').order('created_at', { ascending: false }).order('id')),
      fetchAll(() => supabase.from('tickets').select('id,movement_id').eq('is_picked_up', true).order('id')),
    ]);
    const active = new Map(current.map(ticket => [ticket.id, ticket.movement_id]));
    return NextResponse.json(events.map(event => ({ ...event,
      activeTicketIds: event.kind === 'pickup' ? event.ticket_ids.filter(id => active.get(id) === event.id) : [],
    })));
  } catch (error) { return apiError(error); }
}
