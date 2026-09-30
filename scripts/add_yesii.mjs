import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nkewcohbygwjfnqsrrin.supabase.co';
// ⚠️ IMPORTANTE: Reemplaza esto con tu Service Role Key (empieza con 'ey...')
// Puedes encontrarla en Supabase -> Project Settings -> API -> service_role secret
const SUPABASE_SERVICE_ROLE_KEY = 'PON_TU_SERVICE_ROLE_KEY_AQUI';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function signUpUser() {
  console.log('Creando usuario yesii...');
  const { data, error } = await supabase.auth.admin.createUser({
    email: 'yesii@kikiriweb.com',
    password: 'yessi123',
    email_confirm: true
  });

  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('¡Usuario yesii creado con éxito!');
    console.log('Email:', 'yesii@kikiriweb.com');
    console.log('Contraseña:', 'yessi123');
  }
}

signUpUser();
