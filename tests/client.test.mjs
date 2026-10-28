import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SESSION_EXPIRED_EVENT } from '../lib/session-events.mjs';

const source = (await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
function client(fetch, refresh) {
  const events = [];
  const window = { dispatchEvent: event => events.push(event.type), location: { assign: () => assert.fail('Background requests must never navigate') } };
  const createClient = () => ({ auth: { refreshSession: refresh } });
  const api = new Function('fetch', 'createClient', 'window', 'CustomEvent', 'SESSION_EXPIRED_EVENT', source + '\nreturn {requestJson};')(
    fetch, createClient, window, class { constructor(type) { this.type = type; } }, SESSION_EXPIRED_EVENT);
  return { ...api, events };
}
test('A genuinely expired session requests inline sign-in without replacing the page', async () => {
  const api = client(async () => Response.json({ error: 'Expired' }, { status: 401 }), async () => ({ data: { session: null }, error: new Error('Expired') }));
  await assert.rejects(api.requestJson('/api/students?q=María'), error => error.status === 401);
  assert.deepEqual(api.events, [SESSION_EXPIRED_EVENT]);
});
test('A stale session recovers and retries the data query without a dialog or navigation', async () => {
  let calls = 0;
  const api = client(async () => ++calls === 1 ? Response.json({}, { status: 401 }) : Response.json({ students: ['kept'] }), async () => ({ data: { session: {} }, error: null }));
  assert.deepEqual(await api.requestJson('/api/students?q=Draft'), { students: ['kept'] });
  assert.equal(calls, 2); assert.deepEqual(api.events, []);
});
test('Concurrent background requests share one session renewal', async () => {
  let renewals = 0; let release; const seen = new Set();
  const ready = new Promise(resolve => { release = resolve; });
  const api = client(async url => {
    if (!seen.has(url)) { seen.add(url); return Response.json({}, { status: 401 }); }
    return Response.json({ ok: true });
  }, async () => { renewals++; await ready; return { data: { session: {} }, error: null }; });
  const pending = [api.requestJson('/api/students'), api.requestJson('/api/stats')];
  await new Promise(resolve => setImmediate(resolve)); release();
  assert.deepEqual(await Promise.all(pending), [{ ok: true }, { ok: true }]); assert.equal(renewals, 1); assert.deepEqual(api.events, []);
});
test('An obsolete cancelled search does not open a session dialog', async () => {
  const controller = new AbortController(); controller.abort();
  const api = client(async () => Response.json({}, { status: 401 }), () => assert.fail('Cancelled queries must not renew sessions'));
  await assert.rejects(api.requestJson('/api/students', { signal: controller.signal }), error => error.status === 401);
  assert.deepEqual(api.events, []);
});
test('A server error does not navigate or renew the session', async () => {
  const api = client(async () => Response.json({ error: 'Unavailable' }, { status: 503 }), () => assert.fail('Not an authentication error'));
  await assert.rejects(api.requestJson('/api/stats'), error => error.status === 503); assert.deepEqual(api.events, []);
});
