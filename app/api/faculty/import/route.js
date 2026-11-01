import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { MAX_CSV_BYTES } from '@/lib/csv.mjs';
import { ValidationError } from '@/lib/validation.mjs';
import { parseFacultyCSV, decodeFacultyCSV } from '@/lib/faculty.mjs';

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    if (Number(request.headers.get('content-length')) > MAX_CSV_BYTES + 65536) throw new HttpError('El archivo supera 2 MB', 413);
    const file = (await request.formData()).get('file');
    if (!file || typeof file.arrayBuffer !== 'function' || !/\.csv$/i.test(file.name || '')) throw new ValidationError('Selecciona un archivo CSV');
    if (file.size > MAX_CSV_BYTES) throw new HttpError('El archivo supera 2 MB', 413);
    const students = parseFacultyCSV(decodeFacultyCSV(await file.arrayBuffer()));
    const { data, error } = await supabase.rpc('import_faculty_roster', { p_rows: students });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
