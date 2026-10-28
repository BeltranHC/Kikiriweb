import { createClient } from '@supabase/supabase-js';
import { requiredEnv } from './env.mjs';

async function main() {
  const email = requiredEnv('AUTH_USER_EMAIL');
  const password = requiredEnv('AUTH_USER_PASSWORD');
  if (password.length < 12) throw new Error('Usa una contraseña de al menos 12 caracteres');
  const client = createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  console.log('Cuenta creada correctamente. La contraseña no se muestra en consola.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
