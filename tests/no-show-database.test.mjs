import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { buildPending } from '../lib/pending.mjs';
import { buildAnalytics } from '../lib/analytics.mjs';

const names = ['database.sql', '20261031_faculty_distribution.sql', '20261031_promotion_category.sql', '20261031_distribution_only_history.sql', '20261103_recipient_ticket_changes.sql', '20261104_directory_performance.sql', '20261104_semester_progress.sql', '20261105_distribution_payments_deletion.sql', '20261106_batch_ticket_payments.sql', '20261110_enable_deliveries.sql', '20261110_prepaid_delivery.sql', '20261112_statistics_dashboard.sql', '20261121_ticket_no_show.sql'];
const files = await Promise.all(names.map(name => readFile(new URL('../' + (name === 'database.sql' ? '' : 'supabase/migrations/') + name, import.meta.url), 'utf8')));
const actor = '11111111-1111-4111-8111-111111111111';

test('No recogió undoes Prepagado deliveries, stops the debt, can be undone and clears itself on a later delivery', async () => {
  const db = new PGlite();
  const q = async (sql, values = []) => (await db.query(sql, values)).rows;
  const one = async (sql, values) => (await q(sql, values))[0].v;
  const reject = async (fn, code = 'P0001') => { await db.exec('SAVEPOINT expected'); try { await assert.rejects(fn(), error => error.code === code); } finally { await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected'); } };
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`);
    for (const file of files) await db.exec(file);
    await db.exec(files.at(-1)); // La migración puede ejecutarse dos veces.
    await db.exec('BEGIN');
    await q("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await q("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ email: 'delivery@example.test' })]);
    const person = await one("SELECT public.save_faculty_recipient('Persona Ausente','AUS1',2,'FINESI') v");
    await q('SELECT public.assign_faculty_tickets($1,$2,NULL)', [person.id, [10, 11, 12]]);
    const ticket = async number => one('SELECT to_jsonb(t) v FROM public.tickets t WHERE ticket_number=$1', [number]);
    const versions = tickets => JSON.stringify(tickets.map(item => ({ id: item.id, updated_at: item.assignment_updated_at })));
    const t10 = await ticket(10), t11 = await ticket(11);
    await q('SELECT public.deliver_tickets($1,$2,$3)', [[t10.id, t11.id], 'prepaid', versions([t10, t11])]);
    const delivered = await ticket(10);
    assert.equal(delivered.is_picked_up, true); assert.match(delivered.payment_method, /^prepaid/);
    const source = async () => one('SELECT public.ticket_analytics_source() v');
    assert.equal(buildPending(await source()).summary.due, 30);

    // Un ticket con Prepagado vigente debe anularse antes (la API lo hace con set_faculty_ticket_payment).
    await reject(() => q('SELECT public.set_ticket_no_show($1,$2,$3,true)', [delivered.id, person.id, delivered.assignment_updated_at]));
    const voided = await one("SELECT public.set_faculty_ticket_payment($1,$2,'void',NULL,$3) v", [delivered.id, person.id, delivered.assignment_updated_at]);
    await reject(() => q('SELECT public.set_ticket_no_show($1,$2,$3,true)', [delivered.id, person.id, delivered.assignment_updated_at])); // versión vieja
    const marked = (await one('SELECT public.set_ticket_no_show($1,$2,$3,true) v', [delivered.id, person.id, voided.ticket.assignment_updated_at])).ticket;
    assert.equal(marked.is_picked_up, false); assert.equal(marked.is_paid, false); assert.equal(marked.no_show_by_email, 'delivery@example.test'); assert.ok(marked.no_show_at);
    assert.equal(marked.student_id, person.id);
    assert.deepEqual((await q("SELECT kind FROM public.ticket_movements WHERE $1=ANY(ticket_ids) ORDER BY kind", [delivered.id])).map(row => row.kind), ['pickup', 'undo']);
    await reject(() => q('SELECT public.set_ticket_no_show($1,$2,$3,true)', [marked.id, person.id, marked.assignment_updated_at]));

    // Ticket asignado sin recoger: se marca directamente.
    const t12 = await ticket(12);
    await q('SELECT public.set_ticket_no_show($1,$2,$3,true)', [t12.id, person.id, t12.assignment_updated_at]);
    const data = await source();
    const pending = buildPending(data);
    assert.equal(pending.summary.due, 15); assert.equal(pending.summary.noShow, 2); assert.equal(pending.summary.unpicked, 0);
    const stats = buildAnalytics(data, { from: '2026-01-01', to: '2026-12-31', group: 'all', actor: 'all' }).summary;
    assert.equal(stats.due, 15); assert.equal(stats.noShow, 2); assert.equal(stats.tickets, 3);

    // Un pago real impide marcarlo; deshacer devuelve el ticket a "sin recoger".
    const restored = (await one('SELECT public.set_ticket_no_show($1,$2,$3,false) v', [t12.id, person.id, (await ticket(12)).assignment_updated_at])).ticket;
    assert.equal(restored.no_show_at, null);
    await q("SELECT public.set_faculty_ticket_payment($1,$2,'pay','cash',$3)", [t12.id, person.id, restored.assignment_updated_at]);
    const paid = await ticket(12);
    await reject(() => q('SELECT public.set_ticket_no_show($1,$2,$3,true)', [paid.id, person.id, paid.assignment_updated_at]));

    // Si después sí recoge, la marca se limpia sola.
    const again = await ticket(10);
    await q('SELECT public.deliver_tickets($1,$2,$3)', [[again.id], 'cash', versions([again])]);
    const finalTicket = await ticket(10);
    assert.equal(finalTicket.is_picked_up, true); assert.equal(finalTicket.no_show_at, null);
  } finally { await db.close(); }
});
