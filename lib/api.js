import { NextResponse } from 'next/server';
import { createClient } from './supabase';
import { ValidationError } from './validation.mjs';

export class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function requireSession() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError('Debes iniciar sesión', 401);
  if (user.is_anonymous) throw new HttpError('Usa una cuenta autorizada', 403);
  return { supabase, user };
}

export function apiError(error) {
  let status = error.status || 500;
  let message = error.status ? error.message : 'No se pudo completar la operación';
  if (error instanceof ValidationError || error instanceof SyntaxError) { status = 400; message = error.message; }
  else if (error.code === '23505') { status = 409; message = 'Uno o más tickets ya están registrados'; }
  else if (error.code === 'P0001' || error.code === '23503') { status = 409; message = error.code === 'P0001' ? error.message : 'El registro tiene datos relacionados'; }
  else if (error.code === 'P0002') { status = 404; message = error.message; }
  else if (error.code === '22023' || error.code === '22P02') { status = 400; message = 'Datos inválidos'; }
  else if (error.code === '42501') { status = 403; message = 'No tienes permiso para esta operación'; }
  else if (['PGRST202', 'PGRST205', '42703'].includes(error.code)) { status = 503; message = 'La configuración del sistema está pendiente. Contacta al administrador.'; }
  if (status >= 500) console.error('API error:', error.code || error.name, error.message);
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
