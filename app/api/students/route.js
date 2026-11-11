import { requireDeliveryEnabled, requireLegacyAdminEnabled } from '@/lib/module-mode.mjs';
import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { studentInput, validateUuid, ValidationError } from '@/lib/validation.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    requireDeliveryEnabled();
    const params = new URL(request.url).searchParams;
    const query = (params.get('q') || '').trim();
    const status = (params.get('status') || 'all').toLowerCase();
    const page = Number(params.get('page') || 1);
    const pageSize = Number(params.get('pageSize') || 30);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || query.length > 200 || !['all', 'pending', 'completed'].includes(status)) {
      throw new ValidationError('Parámetros de búsqueda inválidos');
    }

    const { data,error } = await supabase.rpc('delivery_directory',{p_query:query,p_status:status,p_page:page,p_page_size:pageSize});
    if(error)throw error;return NextResponse.json(data,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) { return apiError(error); }
}

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    requireLegacyAdminEnabled();
    const student = studentInput(await request.json());
    const { data, error } = await supabase.rpc('create_student_with_tickets', { p_name: student.name, p_code: student.code, p_dni: student.dni, p_ticket_numbers: student.tickets });
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request) {
  try {
    const { supabase } = await requireSession();
    requireLegacyAdminEnabled();
    const id = validateUuid(new URL(request.url).searchParams.get('id'));
    const { data, error } = await supabase.rpc('delete_student', { p_student_id: id });
    if (error) throw error;
    if (!data) throw new HttpError('Estudiante no encontrado', 404);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}
