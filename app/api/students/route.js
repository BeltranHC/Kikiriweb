import { createClient } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// GET: Search students with their tickets
export async function GET(request) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';

  const selectFields = `
    id, name, code, dni, created_at,
    tickets (
      id, ticket_number, is_picked_up, picked_up_at, picked_up_by, is_extra, created_at, is_paid, payment_method
    )
  `;

  try {
    if (!query) {
      const { data, error } = await supabase
        .from('students')
        .select(selectFields)
        .order('name')
        .limit(30);
      
      if (error) throw error;
      return NextResponse.json(data || []);
    }

    // 1. Search by text fields (name, code, dni)
    const { data: textData, error: textError } = await supabase
      .from('students')
      .select(selectFields)
      .or(`name.ilike.%${query}%,code.ilike.%${query}%,dni.ilike.%${query}%`)
      .order('name')
      .limit(50);

    if (textError) throw textError;

    let combinedData = [...(textData || [])];

    // 2. If query is a number, search for the exact ticket number
    if (/^\d+$/.test(query)) {
      const ticketNum = parseInt(query, 10);
      const { data: ticketInfo } = await supabase
        .from('tickets')
        .select('student_id')
        .eq('ticket_number', ticketNum)
        .eq('is_extra', false)
        .single();
      
      if (ticketInfo?.student_id) {
        // If we haven't already found this student via text search
        if (!combinedData.some(s => s.id === ticketInfo.student_id)) {
          const { data: studentMatch } = await supabase
            .from('students')
            .select(selectFields)
            .eq('id', ticketInfo.student_id)
            .single();
            
          if (studentMatch) {
            combinedData.unshift(studentMatch); // Put ticket match at the top
          }
        }
      }
    }

    return NextResponse.json(combinedData);
  } catch (err) {
    console.error('Supabase error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// POST: Create a new student with tickets
export async function POST(request) {
  const supabase = createClient();

  try {
    const body = await request.json();
    const { name, code, dni, ticketStart, ticketEnd } = body;

    if (!name) {
      return NextResponse.json({ error: 'El nombre es requerido' }, { status: 400 });
    }

    // Create student
    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert({ name, code: code || null, dni: dni || null })
      .select()
      .single();

    if (studentError) {
      return NextResponse.json({ error: studentError.message }, { status: 500 });
    }

    // Create tickets if range provided
    if (ticketStart && ticketEnd && ticketStart <= ticketEnd) {
      const tickets = [];
      for (let i = ticketStart; i <= ticketEnd; i++) {
        tickets.push({
          ticket_number: i,
          student_id: student.id,
          is_picked_up: false,
          is_extra: false,
        });
      }

      const { error: ticketError } = await supabase
        .from('tickets')
        .insert(tickets);

      if (ticketError) {
        console.error('Ticket insert error:', ticketError);
      }
    }

    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// DELETE: Delete a student and their tickets
export async function DELETE(request) {
  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  try {
    // Delete tickets first
    await supabase.from('tickets').delete().eq('student_id', id);

    // Delete student
    const { error } = await supabase.from('students').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
