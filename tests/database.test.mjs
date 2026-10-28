import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const migration = await readFile(new URL('../database.sql', import.meta.url), 'utf8');

const authSetup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;`;

test('PostgreSQL security, atomicity, audit and migration regressions', async t => {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const login = async (id = actor, anonymous = false) => {
    await query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
    await query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ email: `${id.slice(0, 3)}@example.test`, is_anonymous: anonymous })]);
  };
  const student = async (name = 'Demo', numbers = [1, 2]) => (await query('SELECT public.create_student_with_tickets($1,NULL,NULL,$2) AS value', [name, numbers]))[0].value;
  const ids = async () => (await query('SELECT id FROM public.tickets ORDER BY ticket_number')).map(ticket => ticket.id);
  const pickup = (tickets, method = 'en_momento_efectivo') => query('SELECT * FROM public.update_ticket_pickup($1,true,$2,NULL)', [tickets, method]);
  const undo = (tickets, movement) => query('SELECT * FROM public.update_ticket_pickup($1,false,NULL,$2)', [tickets, movement]);
  const count = async table => Number((await query(`SELECT count(*) AS n FROM public.${table}`))[0].n);
  const run = async (name, callback) => t.test(name, async () => {
    await db.exec('BEGIN');
    try { await login(); await callback(); }
    finally { await db.exec('ROLLBACK; RESET ROLE'); }
  });
  try {
    await db.exec(authSetup);
    await db.exec(migration);
    // Each expected failure uses a savepoint so the surrounding test can inspect rollback effects.
    const rejected = async (callback, code) => {
      await db.exec('SAVEPOINT expected_failure');
      try { await assert.rejects(callback(), error => error.code === code); }
      finally { await db.exec('ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure'); }
    };
    await run('failed student creation leaves no orphan records', async () => {
      await student('First', [1]);
      await rejected(() => student('Rollback', [2, 1]), '23505');
      assert.equal(await count('students'), 1); assert.equal(await count('tickets'), 1);
    });
    await run('a failure in a later CSV row rolls back the entire import', async () => {
      await student('Existing', [9]);
      await rejected(() => query('SELECT public.import_students($1::jsonb)', [JSON.stringify([
        { name: 'New A', tickets: [1, 2] }, { name: 'New B', tickets: [9] },
      ])]), '23505');
      assert.equal(await count('students'), 1); assert.equal(await count('tickets'), 1);
    });
    await run('double pickup cannot replace the first cashier or add another audit event', async () => {
      await student(); const tickets = await ids();
      await pickup(tickets, 'en_momento_yape'); await login(other);
      await rejected(() => pickup(tickets), 'P0001');
      const rows = await query('SELECT picked_up_by,payment_method FROM public.tickets');
      assert(rows.every(ticket => ticket.picked_up_by === actor && ticket.payment_method.startsWith('en_momento_yape|')));
      assert.equal(await count('ticket_movements'), 1);
    });
    await run('a mixed-state batch fails as a whole', async () => {
      await student(); const tickets = await ids();
      await pickup([tickets[0]]);
      await rejected(() => pickup(tickets), 'P0001');
      assert.equal((await query('SELECT count(*) AS n FROM public.tickets WHERE is_picked_up'))[0].n, 1);
      assert.equal(await count('ticket_movements'), 1);
    });
    await run('undo preserves the original delivery and rejects stale movement IDs', async () => {
      await student(); const tickets = await ids();
      const first = await pickup(tickets);
      await rejected(() => undo(tickets, other), 'P0001');
      await undo(tickets, first[0].movement_id);
      assert.equal(await count('ticket_movements'), 2);
      const second = await pickup(tickets);
      await rejected(() => undo(tickets, first[0].movement_id), 'P0001');
      assert.notEqual(second[0].movement_id, first[0].movement_id);
      assert.equal(await count('ticket_movements'), 3);
    });
    await run('deleting a student with historical deliveries is blocked even after undo', async () => {
      const person = await student(); const tickets = await ids();
      const rows = await pickup(tickets); await undo(tickets, rows[0].movement_id);
      await rejected(() => query('SELECT public.delete_student($1)', [person.id]), 'P0001');
      assert.equal(await count('students'), 1); assert.equal(await count('tickets'), 2);
    });
    await run('authenticated users can read and use RPCs, but cannot mutate tables or audit directly', async () => {
      await student(); await db.exec('SET ROLE authenticated');
      assert.equal((await query('SELECT * FROM public.students')).length, 1);
      await rejected(() => query("UPDATE public.tickets SET is_picked_up=true"), '42501');
      await rejected(() => query('DELETE FROM public.ticket_movements'), '42501');
      await student('RPC allowed', [3]);
    });
    await run('anon has neither table access nor function execution', async () => {
      await db.exec('SET ROLE anon');
      await rejected(() => query('SELECT * FROM public.students'), '42501');
      await rejected(() => student(), '42501');
    });
    await run('missing users and anonymous auth sessions are rejected inside SQL', async () => {
      await login(''); await rejected(() => student(), '42501');
      await login(actor, true); await rejected(() => student(), '42501');
      await db.exec('SET ROLE authenticated');
      assert.equal((await query('SELECT * FROM public.tickets')).length, 0);
    });
    await run('daily totals use Lima boundaries, both payment methods, and count beyond 1000 rows', async () => {
      await query(`INSERT INTO public.tickets(ticket_number,is_picked_up,picked_up_at,payment_method,unit_price)
        SELECT n,true,'2026-10-27T05:00:00Z','en_momento_efectivo|demo',15 FROM generate_series(1,1201) n`);
      await query(`INSERT INTO public.tickets(ticket_number,is_picked_up,picked_up_at,payment_method,unit_price) VALUES
        (1202,true,'2026-10-28T04:59:59Z','en_momento_yape|demo',20),
        (1203,true,'2026-10-27T04:59:59Z','en_momento|demo',99),
        (1204,true,'2026-10-28T05:00:00Z','en_momento|demo',99),
        (1205,true,'2026-10-27T15:00:00Z','previo|demo',15)`);
      const stats = (await query("SELECT public.ticket_stats('2026-10-27') AS data"))[0].data;
      assert.equal(stats.totalTickets, 1205); assert.equal(stats.collectedCash, 18015); assert.equal(stats.collectedYape, 20); assert.equal(stats.collectedNow, 18035);
    });
    await t.test('migration backfills legacy deliveries and can be rerun without duplicating history', async () => {
      await login();
      await query("INSERT INTO public.tickets(ticket_number,is_picked_up,picked_up_at,payment_method) VALUES (9000,true,'2026-09-30T15:00:00Z','en_momento|legacy@example.test')");
      await db.exec(migration);
      assert.equal(await count('ticket_movements'), 1);
      const event = (await query('SELECT * FROM public.ticket_movements'))[0];
      assert.equal(event.actor_email, 'legacy@example.test'); assert.equal(event.payment_method, 'en_momento_efectivo');
      await db.exec(migration);
      assert.equal(await count('ticket_movements'), 1);
      assert.equal((await query('SELECT movement_id FROM public.tickets'))[0].movement_id, event.id);
    });
  } finally { await db.close(); }
});


test('Migration preserves every original field, missing pickup dates and object identities on rerun', async () => {
  const db = new PGlite();
  try {
    await db.exec(authSetup);
    await db.exec(`
      CREATE TABLE public.students (
        id uuid PRIMARY KEY, name text NOT NULL, code text, dni text,
        created_at timestamptz NOT NULL, notes text
      );
      CREATE TABLE public.tickets (
        id uuid PRIMARY KEY, ticket_number integer NOT NULL UNIQUE,
        student_id uuid REFERENCES public.students(id), is_picked_up boolean NOT NULL,
        picked_up_at timestamptz, picked_up_by uuid, is_extra boolean NOT NULL,
        is_paid boolean NOT NULL, payment_method text, created_at timestamptz NOT NULL
      );
      INSERT INTO public.students VALUES
        ('11111111-1111-4111-8111-111111111111', 'Ana Pérez', 'ABC', '12345678', '2026-09-01T10:00:00Z', 'Conservar información original');
      INSERT INTO public.tickets VALUES
        ('00000000-0000-4000-8000-000000000001', 1, '11111111-1111-4111-8111-111111111111', true, NULL, NULL, false, false, NULL, '2026-09-20T15:00:00Z'),
        ('00000000-0000-4000-8000-000000000002', 2, '11111111-1111-4111-8111-111111111111', true, '2026-09-30T15:00:00Z', '22222222-2222-4222-8222-222222222222', false, true, 'en_momento_yape|original@example.test', '2026-09-20T15:00:00Z'),
        ('00000000-0000-4000-8000-000000000003', 3, NULL, false, NULL, NULL, true, true, 'previo|original@example.test', '2026-09-20T15:00:00Z');
    `);
    const rows = async table => (await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows;
    const studentsBefore = await rows('students');
    const ticketsBefore = await rows('tickets');
    await db.exec(migration);
    assert.deepEqual(await rows('students'), studentsBefore);
    const ticketsAfter = await rows('tickets');
    for (let i = 0; i < ticketsBefore.length; i++) {
      for (const [key, value] of Object.entries(ticketsBefore[i])) assert.deepEqual(ticketsAfter[i][key], value, key);
      assert.equal(Number(ticketsAfter[i].unit_price), 15);
    }
    assert.equal(ticketsAfter[0].picked_up_at, null);
    assert.equal((await rows('ticket_movements')).length, 2);
    // Catalog identities are checked directly: compatible objects must not be recreated.
    const policyIds = (await db.query('SELECT oid,polname FROM pg_policy ORDER BY polname')).rows;
    const triggerIds = (await db.query("SELECT oid FROM pg_trigger WHERE tgname='preserve_ticket_history'")).rows;
    const eventsBefore = await rows('ticket_movements');
    await db.query('UPDATE public.tickets SET unit_price=18.50 WHERE ticket_number=2');
    const existingPrices = await rows('tickets');
    await db.exec(migration);
    assert.deepEqual(await rows('tickets'), existingPrices);
    assert.deepEqual(await rows('ticket_movements'), eventsBefore);
    assert.deepEqual((await db.query('SELECT oid,polname FROM pg_policy ORDER BY polname')).rows, policyIds);
    assert.deepEqual((await db.query("SELECT oid FROM pg_trigger WHERE tgname='preserve_ticket_history'")).rows, triggerIds);
    assert.equal((await db.query("SELECT count(*) AS n FROM pg_class WHERE relname LIKE 'kikiri_migration_%_before'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('Unexpected data changes detected during migration roll back schema, records and history together', async () => {
  const db = new PGlite();
  try {
    await db.exec(authSetup);
    await db.exec(`
      CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, code text, dni text, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_number integer NOT NULL UNIQUE,
        student_id uuid REFERENCES public.students(id), is_picked_up boolean NOT NULL DEFAULT false,
        picked_up_at timestamptz, picked_up_by uuid, is_extra boolean NOT NULL DEFAULT false,
        is_paid boolean NOT NULL DEFAULT false, payment_method text, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO public.students(name) VALUES ('Must be preserved');
      INSERT INTO public.tickets(ticket_number,is_picked_up) VALUES (1,true);
      CREATE FUNCTION public.unexpected_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        UPDATE public.students SET name = 'Unexpected change';
        RETURN NEW;
      END $$;
      CREATE TRIGGER unrelated_existing_trigger AFTER UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.unexpected_side_effect();
    `);
    await assert.rejects(db.exec(migration), error => error.code === 'P0001' && error.message.includes('Verificación fallida'));
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT name FROM public.students')).rows[0].name, 'Must be preserved');
    assert.equal((await db.query('SELECT count(*) AS n FROM public.tickets')).rows[0].n, 1);
    assert.equal((await db.query("SELECT to_regclass('public.ticket_movements') AS name")).rows[0].name, null);
    assert.equal((await db.query("SELECT count(*) AS n FROM information_schema.columns WHERE table_name='tickets' AND column_name='movement_id'")).rows[0].n, 0);
  } finally { await db.close(); }
});


for (const [object, setup, catalog] of [
  ['policy', `
    DROP POLICY authenticated_read_students ON public.students;
    CREATE POLICY authenticated_read_students ON public.students FOR ALL TO authenticated USING (true);
  `, "SELECT oid,polcmd FROM pg_policy WHERE polname='authenticated_read_students'"],
  ['trigger', `
    DROP TRIGGER preserve_ticket_history ON public.tickets;
    CREATE TRIGGER preserve_ticket_history AFTER DELETE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.preserve_ticket_history();
  `, "SELECT oid,tgtype FROM pg_trigger WHERE tgname='preserve_ticket_history'"],
]) {
  test(`Migration stops without replacing an incompatible existing ${object}`, async () => {
    const db = new PGlite();
    try {
      await db.exec(authSetup);
      await db.exec(migration);
      await db.exec(setup);
      const before = (await db.query(catalog)).rows;
      await assert.rejects(db.exec(migration), error => error.code === 'P0001' && error.message.includes('incompatible'));
      await db.exec('ROLLBACK');
      assert.deepEqual((await db.query(catalog)).rows, before);
    } finally { await db.close(); }
  });
}


test('Migration enables RLS on permanent and temporary tables and keeps verification copies private', async () => {
  const db = new PGlite();
  try {
    await db.exec(authSetup);
    await db.exec(migration);
    await db.query("INSERT INTO public.students(name) VALUES ('Private verification data')");
    // Keep the migration transaction open to inspect copies before COMMIT removes them.
    await db.exec(migration.replace(/COMMIT;\s*$/, ''));
    const permanent = (await db.query(`
      SELECT relname,relrowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('students','tickets','ticket_movements')
    `)).rows;
    assert.equal(permanent.length, 3);
    assert(permanent.every(table => table.relrowsecurity));
    const temporary = (await db.query(`
      SELECT c.relname,c.relpersistence,c.relrowsecurity,n.nspname,
        has_table_privilege('anon',c.oid,'SELECT') AS anonymous_read,
        has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_read,
        has_table_privilege('service_role',c.oid,'SELECT') AS service_read
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relnamespace = pg_my_temp_schema() AND c.relname LIKE 'kikiri_migration_%_before'
    `)).rows;
    assert.equal(temporary.length, 3);
    for (const table of temporary) {
      assert.equal(table.relpersistence, 't');
      assert.equal(table.relrowsecurity, true);
      assert(table.nspname.startsWith('pg_temp_'));
      assert.equal(table.anonymous_read, false);
      assert.equal(table.authenticated_read, false);
      assert.equal(table.service_read, false);
    }
    assert.equal((await db.query('SELECT original->>\'name\' AS name FROM pg_temp.kikiri_migration_students_before')).rows[0].name, 'Private verification data');
    await db.exec('SET ROLE authenticated; SAVEPOINT denied_copy_access');
    await assert.rejects(db.query('SELECT * FROM pg_temp.kikiri_migration_students_before'), error => error.code === '42501');
    await db.exec('ROLLBACK TO SAVEPOINT denied_copy_access; RESET ROLE; COMMIT');
    assert.equal((await db.query("SELECT count(*) AS n FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname LIKE 'kikiri_migration_%_before'")).rows[0].n, 0);
  } finally { await db.close(); }
});
