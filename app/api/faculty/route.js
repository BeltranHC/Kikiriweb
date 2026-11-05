import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { ValidationError } from '@/lib/validation.mjs';
import { facultyStudentInput, facultyEditInput, PROMOTION_SEMESTER, recipientType } from '@/lib/faculty.mjs';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { supabase } = await requireSession();
    const params = new URL(request.url).searchParams;
    const query = (params.get('q') || '').trim();
    const page = Number(params.get('page') || 1);
    const pageSize = Number(params.get('pageSize') || 30);
    const semester = params.has('semester') && params.get('semester') !== 'all' ? Number(params.get('semester')) : null;
    if (query.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || (semester !== null && (!Number.isInteger(semester) || semester < 0 || semester > PROMOTION_SEMESTER))) throw new ValidationError('Filtros del padrón inválidos');
    const type = params.get('type') || 'all'; if (type !== 'all') recipientType(type);
    const ticketStatus = params.get('ticketStatus') || 'all';
    if (!['all', 'without', 'with'].includes(ticketStatus)) throw new ValidationError('Filtro de tickets inv\u00e1lido');
    const abortable = query => request.signal ? query.abortSignal(request.signal) : query;
    const started = performance.now();
    let { data, error } = await abortable(supabase.rpc('faculty_directory_v2', {
      p_query: query, p_semester: semester, p_recipient_type: type === 'all' ? null : type,
      p_ticket_status: ticketStatus, p_page: page, p_page_size: pageSize,
    }));
    // Older deployments remain usable until the additive read-only migration is applied.
    if (error?.code === 'PGRST202') {
      if (ticketStatus !== 'all') throw new HttpError('El filtro de tickets est\u00e1 pendiente de activaci\u00f3n. Contacta al administrador.', 503);
      const [directory, ticketCount] = await Promise.all([
        abortable(supabase.rpc('faculty_recipient_directory', { p_query: query, p_semester: semester, p_recipient_type: type === 'all' ? null : type, p_page: page, p_page_size: pageSize })),
        abortable(supabase.from('tickets').select('id', { head: true, count: 'exact' }).not('student_id', 'is', null)),
      ]);
      ({ data, error } = directory);
      if (error?.code === 'PGRST202' && ['all','student'].includes(type)) {
        ({ data, error } = await abortable(supabase.rpc('faculty_directory', { p_query: query, p_semester: semester, p_page: page, p_page_size: pageSize })));
      }
      if (error) throw error;
      if (ticketCount.error) throw ticketCount.error;
      if (!Number.isSafeInteger(ticketCount.count) || ticketCount.count < 0) throw new HttpError('No se pudo calcular el total de tickets repartidos', 503);
      data = { ...data, summary: { ...data.summary, totalAssignedTickets: ticketCount.count } };
    }
    if (error) throw error;
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': `directory;dur=${(performance.now() - started).toFixed(1)}` } });
  } catch (error) { return apiError(error); }
}
async function save(request, edit) {
  try {
    const { supabase } = await requireSession();
    const student = (edit ? facultyEditInput : facultyStudentInput)(await request.json());
    const { data, error } = await supabase.rpc('save_faculty_recipient', {
      p_recipient_type: student.recipientType, p_name: student.name, p_code: student.code, p_semester: student.semester, p_school: student.school,
      p_student_id: edit ? student.id : null, p_expected_updated_at: edit ? student.expectedUpdatedAt : null,
    });
    if (error) throw error;
    return NextResponse.json(data, { status: edit ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
export const POST = request => save(request, false);
export const PATCH = request => save(request, true);
