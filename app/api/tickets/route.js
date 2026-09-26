import { createClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET: Get tickets (optionally filtered by type=extra)
export async function GET(request) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    let query = supabase
      .from('tickets')
      .select('*')
      .order('ticket_number');

    if (type === 'extra') {
      query = query.eq('is_extra', true);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST: Create a new ticket
export async function POST(request) {
  const supabase = createClient();

  try {
    const body = await request.json();
    const { ticketNumber, studentId, isExtra } = body;

    if (!ticketNumber) {
      return NextResponse.json({ error: 'Número de ticket requerido' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('tickets')
      .insert({
        ticket_number: ticketNumber,
        student_id: studentId || null,
        is_extra: isExtra || false,
        is_picked_up: false,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// PATCH: Update ticket(s) pickup status
export async function PATCH(request) {
  const supabase = createClient();

  try {
    const body = await request.json();
    const { ticketIds, isPickedUp, paymentMethod } = body;

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json({ error: 'ticketIds requeridos' }, { status: 400 });
    }

    const updateData = {
      is_picked_up: isPickedUp,
    };

    if (isPickedUp) {
      const { data: { user } } = await supabase.auth.getUser();
      updateData.picked_up_at = new Date().toISOString();
      updateData.is_paid = true;
      const actualMethod = paymentMethod || 'en_momento';
      const userEmail = user?.email || 'Desconocido';
      updateData.payment_method = `${actualMethod}|${userEmail}`;
      updateData.picked_up_by = user?.id || null;
    } else {
      updateData.picked_up_at = null;
      updateData.picked_up_by = null;
      updateData.is_paid = false;
      updateData.payment_method = null;
    }

    const { data, error } = await supabase
      .from('tickets')
      .update(updateData)
      .in('id', ticketIds)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
