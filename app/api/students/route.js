import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { studentInput, validateUuid, ValidationError } from '@/lib/validation.mjs';

export const dynamic = 'force-dynamic';
const fields = 'id,name,code,dni,created_at,tickets(id,ticket_number,is_picked_up,picked_up_at,picked_up_by,movement_id,is_extra,is_paid,payment_method,unit_price)';

export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const params = new URL(request.url).searchParams;
    const query = (params.get('q') || '').trim();
    const status = (params.get('status') || 'all').toLowerCase();
    const page = Number(params.get('page') || 1);
    const pageSize = Number(params.get('pageSize') || 30);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500 || query.length > 200 || !['all', 'pending', 'completed'].includes(status)) {
      throw new ValidationError('Parámetros de búsqueda inválidos');
    }

    let pendingStudentIds = null;
    if (status === 'pending' || status === 'completed') {
      const { data: pendingTickets, error: pendingError } = await supabase
        .from('tickets')
        .select('student_id')
        .eq('is_picked_up', false)
        .not('student_id', 'is', null);
      if (pendingError) throw pendingError;
      pendingStudentIds = [...new Set((pendingTickets || []).map(t => t.student_id).filter(Boolean))];
    }

    let ticketOwner = null;
    if (/^\d+$/.test(query) && Number(query) <= 2147483647) {
      const { data: ticket, error } = await supabase.from('tickets').select('student_id').eq('ticket_number', Number(query)).eq('is_extra', false).maybeSingle();
      if (error) throw error;
      if (ticket?.student_id) {
        const { data, error: ownerError } = await supabase.from('students').select(fields).eq('id', ticket.student_id).maybeSingle();
        if (ownerError) throw ownerError;
        ticketOwner = data;
      }
    }

    if (ticketOwner && status === 'pending' && pendingStudentIds && !pendingStudentIds.includes(ticketOwner.id)) {
      ticketOwner = null;
    }
    if (ticketOwner && status === 'completed' && pendingStudentIds && pendingStudentIds.includes(ticketOwner.id)) {
      ticketOwner = null;
    }

    if (status === 'pending' && pendingStudentIds && pendingStudentIds.length === 0) {
      return NextResponse.json({
        students: ticketOwner ? [ticketOwner] : [],
        total: ticketOwner ? 1 : 0,
        page,
        pageSize,
        hasMore: false,
      });
    }

    // Pin the exact ticket owner once, without duplicating them on later pages.
    const pinned = ticketOwner ? 1 : 0;
    const offset = Math.max(0, (page - 1) * pageSize - pinned);
    const size = pageSize - (page === 1 ? pinned : 0);
    let search = supabase.from('students').select(fields, { count: 'exact', head: size === 0 }).order('name').order('id');
    if (query) {
      const literal = query.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&').replace(/"/g, '\\"');
      search = search.or(['name', 'code', 'dni'].map(field => `${field}.ilike."%${literal}%"`).join(','));
    }
    if (status === 'pending' && pendingStudentIds) {
      search = search.in('id', pendingStudentIds);
    } else if (status === 'completed' && pendingStudentIds && pendingStudentIds.length > 0) {
      search = search.not('id', 'in', `(${pendingStudentIds.join(',')})`);
    }
    if (ticketOwner) search = search.neq('id', ticketOwner.id);
    if (size) search = search.range(offset, offset + size - 1);
    const { data, count, error } = await search;
    if (error) throw error;
    const students = page === 1 && ticketOwner ? [ticketOwner, ...(data || [])] : (data || []);
    const total = (count || 0) + pinned;
    return NextResponse.json({ students, total, page, pageSize, hasMore: page * pageSize < total });
  } catch (error) { return apiError(error); }
}

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    const student = studentInput(await request.json());
    const { data, error } = await supabase.rpc('create_student_with_tickets', { p_name: student.name, p_code: student.code, p_dni: student.dni, p_ticket_numbers: student.tickets });
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request) {
  try {
    const { supabase } = await requireSession();
    const id = validateUuid(new URL(request.url).searchParams.get('id'));
    const { data, error } = await supabase.rpc('delete_student', { p_student_id: id });
    if (error) throw error;
    if (!data) throw new HttpError('Estudiante no encontrado', 404);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
