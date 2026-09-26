import { createClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET: Get overall stats
export async function GET() {
  const supabase = createClient();

  try {
    // Get all tickets
    const { data: tickets, error: ticketError } = await supabase
      .from('tickets')
      .select('id, is_picked_up, is_extra, payment_method');

    if (ticketError) {
      return NextResponse.json({ error: ticketError.message }, { status: 500 });
    }

    // Get student count
    const { count: totalStudents, error: studentError } = await supabase
      .from('students')
      .select('id', { count: 'exact', head: true });

    if (studentError) {
      return NextResponse.json({ error: studentError.message }, { status: 500 });
    }

    const allTickets = tickets || [];
    const totalTickets = allTickets.length;
    const pickedUp = allTickets.filter((t) => t.is_picked_up).length;
    const pending = totalTickets - pickedUp;
    const extraTickets = allTickets.filter((t) => t.is_extra).length;
    
    // Sumador total de polladas cobradas en el momento
    const collectedNow = allTickets.filter((t) => {
      if (!t.is_picked_up) return false;
      const [method] = (t.payment_method || '').split('|');
      return method === 'en_momento';
    }).length * 15;

    return NextResponse.json({
      totalTickets,
      pickedUp,
      pending,
      totalStudents: totalStudents || 0,
      extraTickets,
      collectedNow,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
