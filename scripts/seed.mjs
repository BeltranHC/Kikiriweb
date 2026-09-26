/**
 * Script de seed para KikiriWeb
 * 
 * Este script:
 * 1. Crea un usuario de autenticación en Supabase
 * 2. Carga los datos del CSV (estudiantes + tickets)
 * 
 * Uso: node scripts/seed.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// CONFIGURACIÓN - Cambia estos valores según tu Supabase
// ============================================================
const SUPABASE_URL = 'https://nkewcohbygwjfnqsrrin.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'TU_SERVICE_ROLE_KEY_AQUI'; // ← ¡NECESITAS CAMBIAR ESTO!

// Credenciales del usuario que se creará para login
const USER_EMAIL = 'junior@kikirikiwebgmail.com';
const USER_PASSWORD = 'pollada2026';

// ============================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createAuthUser() {
  console.log('🔐 Creando usuario de autenticación...');
  
  const { data, error } = await supabase.auth.admin.createUser({
    email: USER_EMAIL,
    password: USER_PASSWORD,
    email_confirm: true // Confirmar email automáticamente
  });

  if (error) {
    if (error.message.includes('already been registered') || error.message.includes('already exists')) {
      console.log('  ℹ️  El usuario ya existe, continuando...');
      return;
    }
    console.error('  ❌ Error creando usuario:', error.message);
    return;
  }

  console.log(`  ✅ Usuario creado: ${USER_EMAIL}`);
  console.log(`  🔑 Contraseña: ${USER_PASSWORD}`);
}

async function clearExistingData() {
  console.log('\n🧹 Limpiando datos existentes...');
  
  const { error: ticketError } = await supabase.from('tickets').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (ticketError) console.error('  ⚠️  Error limpiando tickets:', ticketError.message);
  else console.log('  ✅ Tickets eliminados');

  const { error: studentError } = await supabase.from('students').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (studentError) console.error('  ⚠️  Error limpiando estudiantes:', studentError.message);
  else console.log('  ✅ Estudiantes eliminados');
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

async function seedFromCSV() {
  console.log('\n📁 Leyendo archivo semilla.csv...');
  
  const csvPath = resolve(__dirname, '..', 'semilla.csv');
  let csvText;
  try {
    csvText = readFileSync(csvPath, 'utf-8');
  } catch (e) {
    console.error('  ❌ No se encontró semilla.csv en:', csvPath);
    return;
  }

  const rows = parseCSV(csvText);
  console.log(`  📋 ${rows.length} estudiantes encontrados en CSV\n`);

  let totalStudents = 0;
  let totalTickets = 0;

  for (const row of rows) {
    const name = row.nombre || row.name || '';
    const code = row.codigo || row.code || '';
    const dni = row.dni || '';
    const ticketStart = parseInt(row.ticket_inicio || row.ticket_start || '');
    const ticketEnd = parseInt(row.ticket_fin || row.ticket_end || '');

    if (!name) continue;

    // Crear estudiante
    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert({ name, code: code || null, dni: dni || null })
      .select()
      .single();

    if (studentError) {
      console.error(`  ❌ Error con ${name}:`, studentError.message);
      continue;
    }

    totalStudents++;

    // Crear tickets
    if (!isNaN(ticketStart) && !isNaN(ticketEnd) && ticketStart <= ticketEnd) {
      const tickets = [];
      for (let t = ticketStart; t <= ticketEnd; t++) {
        tickets.push({
          ticket_number: t,
          student_id: student.id,
          is_picked_up: false,
          is_extra: false,
        });
      }

      const { error: ticketError } = await supabase.from('tickets').insert(tickets);

      if (ticketError) {
        console.error(`  ❌ Error en tickets de ${name}:`, ticketError.message);
      } else {
        totalTickets += tickets.length;
        const padStart = String(ticketStart).padStart(4, '0');
        const padEnd = String(ticketEnd).padStart(4, '0');
        console.log(`  👤 ${name} (${code}) → Tickets ${padStart}-${padEnd} (${tickets.length} tickets)`);
      }
    }
  }

  console.log(`\n  ✅ ${totalStudents} estudiantes creados`);
  console.log(`  🎫 ${totalTickets} tickets creados`);
}

async function createExtraTickets() {
  console.log('\n🎟️  Creando tickets extra (sin estudiante asignado)...');
  
  // Crear 20 tickets extra (ej: del 0501 al 0520)
  const extras = [];
  for (let t = 501; t <= 520; t++) {
    extras.push({
      ticket_number: t,
      student_id: null,
      is_picked_up: false,
      is_extra: true,
    });
  }

  const { error } = await supabase.from('tickets').insert(extras);
  
  if (error) {
    console.error('  ❌ Error creando extras:', error.message);
  } else {
    console.log(`  ✅ ${extras.length} tickets extra creados (0501-0520)`);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     🐔 KikiriWeb - Script de Seed       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (SUPABASE_SERVICE_ROLE_KEY === 'TU_SERVICE_ROLE_KEY_AQUI') {
    console.error('❌ ERROR: Debes configurar SUPABASE_SERVICE_ROLE_KEY');
    console.log('\n📝 Para obtenerla:');
    console.log('   1. Ve a https://supabase.com → Tu proyecto');
    console.log('   2. Settings → API');
    console.log('   3. Copia "service_role" key (NOT the anon key)');
    console.log('   4. Pégala en scripts/seed.mjs línea 23');
    process.exit(1);
  }

  await createAuthUser();
  await clearExistingData();
  await seedFromCSV();
  await createExtraTickets();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║         ✅ Seed completado!              ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  📧 Email: ${USER_EMAIL.padEnd(28)}║`);
  console.log(`║  🔑 Pass:  ${USER_PASSWORD.padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(console.error);
