import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCSV, MAX_CSV_BYTES } from '../lib/csv.mjs';
import { importRows } from '../lib/validation.mjs';
import { requiredEnv } from './env.mjs';

async function main() {
  const text = await readFile(resolve(process.argv[2] || 'semilla.csv'), 'utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new Error('El archivo supera 2 MB');
  const rows = importRows(parseCSV(text));
  const client = createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: authError } = await client.auth.signInWithPassword({
    email: requiredEnv('AUTH_USER_EMAIL'), password: requiredEnv('AUTH_USER_PASSWORD'),
  });
  if (authError) throw authError;
  const { data, error } = await client.rpc('import_students', { p_rows: rows });
  if (error) throw error;
  console.log(`Importación completada: ${data.studentsCreated} estudiantes, ${data.ticketsCreated} tickets. Los datos existentes se conservaron.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
