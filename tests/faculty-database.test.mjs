import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const base = await readFile(new URL('../database.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261031_faculty_distribution.sql', import.meta.url), 'utf8');
const setup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;`;
const actor = '11111111-1111-4111-8111-111111111111';

test('Faculty migration, roster editing and transactional assignments preserve the existing system', async t => {
  const db = new PGlite();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const login = async () => {
    await q("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor]);
    await q("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ email: 'reparto@example.test' })]);
  };
  const save = async (name, code, semester = 2, id = null, version = null) => (await q('SELECT public.save_faculty_student($1,$2,$3,\'FINESI\',$4,$5) value',[name,code,semester,id,version]))[0].value;
  const assign = async (id,numbers) => (await q('SELECT public.assign_student_tickets($1,$2) value',[id,numbers]))[0].value;
  const directory = async (query = '', semester = null, page = 1, size = 30) => (await q('SELECT public.faculty_directory($1,$2,$3,$4) value',[query,semester,page,size]))[0].value;
  const reject = async (fn,code) => { await db.exec('SAVEPOINT denied'); try { await assert.rejects(fn(),error => error.code===code); } finally { await db.exec('ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied'); } };
  const run = (name,fn) => t.test(name,async () => { await db.exec('BEGIN'); try { await login(); await fn(); } finally { await db.exec('ROLLBACK; RESET ROLE'); } });
  try {
    await db.exec(setup); await db.exec(base);
    await q("INSERT INTO public.students(name,code) VALUES('Existing student','OLD01')");
    await q('INSERT INTO public.tickets(ticket_number,student_id) SELECT 999,id FROM public.students');
    const originalStudents = await q('SELECT to_jsonb(s) value FROM public.students s');
    const originalTickets = await q('SELECT to_jsonb(t) value FROM public.tickets t');
    await db.exec(migration); await db.exec(migration);
    const currentStudents = (await q('SELECT to_jsonb(s) value FROM public.students s'))[0].value;
    const currentTickets = (await q('SELECT to_jsonb(t) value FROM public.tickets t'))[0].value;
    for (const [key,value] of Object.entries(originalStudents[0].value)) assert.deepEqual(currentStudents[key],value);
    for (const [key,value] of Object.entries(originalTickets[0].value)) assert.deepEqual(currentTickets[key],value);
    await run('roster import is repeatable and never replaces manual edits or creates tickets',async () => {
      const payload = JSON.stringify([{ name:'Pérez José',code:'00123',semester:2,school:'FINESI' }]);
      const first = (await q('SELECT public.import_faculty_roster($1) value',[payload]))[0].value;
      assert.equal(first.studentsCreated,1);
      const student = (await directory('00123')).students[0];
      await save('Pérez José editado','00123',4,student.id,student.roster_updated_at);
      const second = (await q('SELECT public.import_faculty_roster($1) value',[payload]))[0].value;
      assert.equal(second.studentsExisting,1); assert.equal(second.studentsCreated,0);
      assert.equal((await directory('00123')).students[0].semester,4);
      assert.equal((await q('SELECT count(*) n FROM public.tickets'))[0].n,1);
    });
    await run('code uniqueness ignores casing and surrounding spaces and edits reject stale versions',async () => {
      const student = await save('A','ABC01');
      await reject(() => save('B',' abc01 '),'23505');
      await save('Updated','ABC01',3,student.id,student.roster_updated_at);
      await reject(() => save('Stale','ABC01',4,student.id,student.roster_updated_at),'P0001');
      assert.equal((await directory('ABC01')).students[0].name,'Updated');
    });
    await run('directory searches words without accents and groups by numeric semesters with stable pagination',async () => {
      await save('Pérez José','00123',10); await save('Álvarez Ana','00999',2);
      assert.equal((await directory('jose perez')).students[0].code,'00123');
      assert.equal((await directory('0012')).total,1);
      assert.equal((await directory('',2)).students[0].code,'00999');
      assert.deepEqual((await directory('',null,1,2)).students.map(s => s.semester),[2,10]);
      assert.equal((await directory('',null,2,2)).students[0].code,'OLD01');
      assert.equal((await directory('',0)).total,1);
    });
    await run('assignment adds pending unpaid tickets and retains the actor and original student snapshot',async () => {
      const student = await save('Original','00123');
      const result = await assign(student.id,[1052,1050,1051]);
      assert.equal(result.ticketsCreated,3);
      assert.deepEqual(result.tickets.map(t => t.ticket_number),[1050,1051,1052]);
      assert(result.tickets.every(t => !t.is_picked_up && !t.is_paid && t.student_id===student.id));
      await save('Renamed','00123',4,student.id,student.roster_updated_at);
      const audit = (await q('SELECT * FROM public.ticket_assignments'))[0];
      assert.equal(audit.actor_id,actor); assert.equal(audit.student_name,'Original'); assert.equal(audit.semester,2);
      assert.equal((await q('SELECT count(*) n FROM public.ticket_movements'))[0].n,0);
      await reject(() => q('SELECT public.delete_student($1)',[student.id]),'23503');
    });
    await run('a conflicting ticket rolls back the whole batch without changing ownership or audit',async () => {
      const a = await save('A','00123'); const b = await save('B','00124');
      await assign(a.id,[1050]);
      await reject(() => assign(b.id,[1051,1050]),'P0001');
      assert.equal((await q('SELECT count(*) n FROM public.tickets WHERE ticket_number=1051'))[0].n,0);
      assert.equal((await q('SELECT count(*) n FROM public.ticket_assignments'))[0].n,1);
      assert.equal((await q('SELECT student_id FROM public.tickets WHERE ticket_number=1050'))[0].student_id,a.id);
    });
    await run('a later invalid import row rolls back earlier rows',async () => {
      await reject(() => q('SELECT public.import_faculty_roster($1)',[JSON.stringify([{name:'Valid',code:'00123',semester:1},{name:'Invalid',code:'00124',semester:11}])]),'22023');
      assert.equal((await directory('0012')).total,0);
    });
    await run('only signed-in nonanonymous operators can call functions or read assignment audit',async () => {
      const student = await save('A','00123');
      await db.exec('SET ROLE authenticated'); await assign(student.id,[1050]);
      assert.equal((await q('SELECT * FROM public.ticket_assignments')).length,1);
      await reject(() => q('DELETE FROM public.ticket_assignments'),'42501');
      await reject(() => q('UPDATE public.students SET semester=5'),'42501');
      await db.exec('RESET ROLE; SET ROLE anon');
      await reject(() => directory(),'42501'); await reject(() => assign(student.id,[1051]),'42501');
      await reject(() => q('SELECT * FROM public.ticket_assignments'),'42501');
      await db.exec('RESET ROLE');
      await q("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");
      await reject(() => directory(),'42501');
    });
  } finally { await db.close(); }
});
