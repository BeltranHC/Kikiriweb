import { NextResponse } from 'next/server';
import { requireSession, apiError, HttpError } from '@/lib/api';
import { parseCSV, MAX_CSV_BYTES } from '@/lib/csv.mjs';
import { importRows, ValidationError } from '@/lib/validation.mjs';

export async function POST(request) {
  try {
    const { supabase } = await requireSession();
    if (Number(request.headers.get('content-length')) > MAX_CSV_BYTES + 65536) throw new HttpError('El archivo supera 2 MB', 413);
    const file = (await request.formData()).get('file');
    if (!file || typeof file.text !== 'function' || !/\.csv$/i.test(file.name || '')) throw new ValidationError('Selecciona un archivo CSV');
    if (file.size > MAX_CSV_BYTES) throw new HttpError('El archivo supera 2 MB', 413);
    let rows;
    try { rows = importRows(parseCSV(await file.text())); }
    catch (error) { throw new ValidationError(error.message); }
    const { data, error } = await supabase.rpc('import_students', { p_rows: rows });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}
