import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const names = ['database.sql', '20261031_faculty_distribution.sql', '20261031_promotion_category.sql', '20261031_distribution_only_history.sql', '20261103_recipient_ticket_changes.sql', '20261104_directory_performance.sql', '20261104_semester_progress.sql', '20261105_distribution_payments_deletion.sql', '20261106_batch_ticket_payments.sql', '20261110_enable_deliveries.sql', '20261110_prepaid_delivery.sql', '20261112_statistics_dashboard.sql', '20261121_ticket_no_show.sql', '20261125_atomic_pending_payments.sql'];
const files = await Promise.all(names.map(name => readFile(new URL('../' + (name === 'database.sql' ? '' : 'supabase/migrations/') + name, import.meta.url), 'utf8')));
const actor = '11111111-1111-4111-8111-111111111111';

test('Deudores cobra y marca No recogió todo o nada, sin duplicar ni perder pagos', async t => {
  const db = new PGlite();
  const q = async (sql, values = []) => (await db.query(sql, values)).rows;
  const one = async (sql, values) => (await q(sql, values))[0].v;
  const reject = async (fn, code = 'P0001', pattern) => { await db.exec('SAVEPOINT expected'); try { await assert.rejects(fn(), error => error.code === code && (!pattern || pattern.test(error.message))); } finally { await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected'); } };
  const ticket = number => one('SELECT to_jsonb(t) v FROM public.tickets t WHERE ticket_number=$1', [number]);
  const selection = tickets => JSON.stringify(tickets.map(item => ({ id: item.id, updated_at: item.assignment_updated_at })));
  const tickets = async numbers => Promise.all(numbers.map(ticket));
  const pay = (person, list, method, total) => one('SELECT public.pay_pending_tickets($1,$2,$3,$4) v', [person.id, selection(list), method, total]);
  const noShow = (person, list, flag) => one('SELECT public.set_pending_no_show($1,$2,$3) v', [person.id, selection(list), flag]);
  const cash = async () => Number((await q('SELECT coalesce(sum(amount),0) s FROM public.ticket_cash_events()'))[0].s);
  const state = async numbers => (await q("SELECT ticket_number n,is_paid,is_picked_up,split_part(coalesce(payment_method,''),'|',1) m,no_show_at IS NOT NULL ns FROM public.tickets WHERE ticket_number=ANY($1) ORDER BY 1", [numbers]));
  const run = (name, fn) => t.test(name, async () => { await db.exec('BEGIN'); try { await fn(); } finally { await db.exec('ROLLBACK'); } });
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`);
    for (const file of files) await db.exec(file);
    const before = await q('SELECT to_jsonb(t) v FROM public.tickets t');
    await db.exec(files.at(-1)); // Puede ejecutarse dos veces sin cambiar datos.
    assert.deepEqual(await q('SELECT to_jsonb(t) v FROM public.tickets t'), before);
    await q("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await q("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ email: 'caja@example.test' })]);
    const setup = async (code, numbers, delivered) => {
      const person = await one("SELECT public.save_faculty_recipient($1,$2,2,'FINESI') v", ['Persona ' + code, code]);
      await q('SELECT public.assign_faculty_tickets($1,$2,NULL)', [person.id, numbers]);
      const list = await tickets(delivered);
      if (list.length) await q('SELECT public.deliver_tickets($1,$2,$3)', [list.map(item => item.id), 'prepaid', selection(list)]);
      return person;
    };

    await run('Cobra Prepagado y sin recoger en una sola operación', async () => {
      const person = await setup('P1', [10, 11, 12, 13], [10, 11, 12]);
      const start = await cash();
      const result = await pay(person, await tickets([10, 11, 12, 13]), 'cash', 60);
      assert.equal(result.changed, 4); assert.equal(result.prepaidVoided, 3); assert.equal(Number(result.total), 60);
      assert.equal(await cash(), start + 60);
      assert.ok((await state([10, 11, 12, 13])).every(row => row.is_paid && row.m === 'en_momento_efectivo'));
      const ledger = await q("SELECT kind,method,amount::float a,actor_email FROM public.faculty_payments WHERE ticket_id IN(SELECT id FROM public.tickets WHERE ticket_number BETWEEN 10 AND 13) AND created_at>now()-interval '1 day' ORDER BY kind,method");
      assert.equal(ledger.filter(row => row.kind === 'void' && row.method === 'prepaid' && row.a === 0).length, 3);
      assert.equal(ledger.filter(row => row.kind === 'payment' && row.method === 'cash' && row.a === 15).length, 4);
      assert.ok(ledger.every(row => row.actor_email === 'caja@example.test'));
      const batch = await q("SELECT DISTINCT ticket_snapshot->>'origin' o,ticket_snapshot->>'batch_id' b FROM public.faculty_payments WHERE kind='payment' AND method='cash' AND ticket_id IN(SELECT id FROM public.tickets WHERE ticket_number BETWEEN 10 AND 13)");
      assert.deepEqual(batch, [{ o: 'pending', b: result.batchId }]);
    });

    await run('Si un ticket no se puede cobrar, no se cobra ninguno', async () => {
      const person = await setup('P2', [20, 21, 22], [20, 21]);
      const t22 = await ticket(22);
      await q("SELECT public.set_faculty_ticket_payment($1,$2,'pay','yape',$3)", [t22.id, person.id, t22.assignment_updated_at]);
      const start = await cash(); const prior = await state([20, 21, 22]);
      await reject(async () => pay(person, await tickets([20, 21, 22]), 'cash', 45), 'P0001', /#22 ya tiene un pago registrado/);
      assert.equal(await cash(), start); assert.deepEqual(await state([20, 21, 22]), prior);
    });

    await run('Rechaza todo si cambió un ticket o el total confirmado', async () => {
      const person = await setup('P3', [30, 31], [30, 31]);
      const seen = await tickets([30, 31]); const start = await cash(); const prior = await state([30, 31]);
      await reject(() => pay(person, seen, 'yape', 15), 'P0001', /El total cambio: ahora es S\/ 30/);
      const voided = await one("SELECT public.set_faculty_ticket_payment($1,$2,'void',NULL,$3) v", [seen[1].id, person.id, seen[1].assignment_updated_at]);
      assert.equal(voided.action, 'void');
      const afterOther = await state([30, 31]);
      await reject(() => pay(person, seen, 'yape', 30), 'P0001', /cambiaron desde que abriste/);
      assert.equal(await cash(), start); assert.deepEqual(await state([30, 31]), afterOther); assert.notDeepEqual(afterOther, prior);
    });

    await run('Doble envío del mismo cobro no duplica el pago', async () => {
      const person = await setup('P4', [40, 41], [40, 41]);
      const seen = await tickets([40, 41]); const start = await cash();
      await pay(person, seen, 'cash', 30);
      await reject(() => pay(person, seen, 'cash', 30));
      assert.equal(await cash(), start + 30);
    });

    await run('No recogió anula Prepagado y marca todo, o nada si hay un pago real', async () => {
      const person = await setup('P5', [50, 51, 52], [50, 51]);
      const t52 = await ticket(52);
      await q("SELECT public.set_faculty_ticket_payment($1,$2,'pay','cash',$3)", [t52.id, person.id, t52.assignment_updated_at]);
      const prior = await state([50, 51, 52]);
      await reject(async () => noShow(person, await tickets([50, 51, 52]), true), 'P0001', /#52 tiene un pago registrado/);
      assert.deepEqual(await state([50, 51, 52]), prior);
      const marked = await noShow(person, await tickets([50, 51]), true);
      assert.equal(marked.changed, 2);
      assert.ok((await state([50, 51])).every(row => row.ns && !row.is_paid && !row.is_picked_up));
      assert.equal((await noShow(person, await tickets([50, 51]), true)).changed, 0);
      await reject(async () => pay(person, await tickets([50]), 'cash', 15), 'P0001', /No recogio/);
      assert.equal((await noShow(person, await tickets([50, 51]), false)).changed, 2);
      assert.ok((await state([50, 51])).every(row => !row.ns && !row.is_paid));
    });

    await run('Solo operadores con sesión pueden usarlo y la función interna no es pública', async () => {
      const person = await setup('P6', [60], [60]);
      const seen = await tickets([60]);
      await q("SELECT set_config('request.jwt.claim.sub','',false)");
      await reject(() => pay(person, seen, 'cash', 15), '42501');
      await q("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor]);
      const grants = await q("SELECT p.proname,has_function_privilege('authenticated',p.oid,'EXECUTE') ok FROM pg_proc p WHERE p.proname IN('pay_pending_tickets','set_pending_no_show','lock_pending_selection') ORDER BY 1");
      assert.deepEqual(grants.map(row => [row.proname, row.ok]), [['lock_pending_selection', false], ['pay_pending_tickets', true], ['set_pending_no_show', true]]);
      await reject(() => pay(person, seen, 'previo', 15), '22023');
      await reject(() => pay(person, [...seen, ...seen], 'cash', 30), '22023');
    });
  } finally { await db.close(); }
});
