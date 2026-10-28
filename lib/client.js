import { createClient } from './supabase-browser';
import { SESSION_EXPIRED_EVENT } from './session-events.mjs';

let sessionRefresh = null;
async function refreshSession() {
  if (!sessionRefresh) {
    sessionRefresh = createClient().auth.refreshSession()
      .then(({ data, error }) => !error && !!data.session)
      .catch(() => false)
      .finally(() => { sessionRefresh = null; });
  }
  return sessionRefresh;
}

export async function request(url, options = {}) {
  const init = { cache: 'no-store', ...options };
  let response = await fetch(url, init);
  if (response.status === 401 && typeof window !== 'undefined' && !options.signal?.aborted) {
    // A stale cookie can recover without replacing the current page.
    if (await refreshSession() && !options.signal?.aborted) response = await fetch(url, init);
    if (response.status === 401 && !options.signal?.aborted) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || 'No se pudo completar la operación');
    error.status = response.status;
    throw error;
  }
  return response;
}
export async function requestJson(url, options = {}) {
  return (await request(url, options)).json();
}
export function jsonBody(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
