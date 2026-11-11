import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { assignmentHistoryFilters } from '../lib/assignment-history.mjs';
import { DISTRIBUTION_ONLY,APP_HOME_ROUTE,requireDeliveryEnabled,requireLegacyAdminEnabled } from '../lib/module-mode.mjs';

const base=await readFile(new URL('../database.sql',import.meta.url),'utf8');
const faculty=await readFile(new URL('../supabase/migrations/20261031_faculty_distribution.sql',import.meta.url),'utf8');
const promotion=await readFile(new URL('../supabase/migrations/20261031_promotion_category.sql',import.meta.url),'utf8');
const mode=await readFile(new URL('../supabase/migrations/20261031_distribution_only_history.sql',import.meta.url),'utf8');
const actor='11111111-1111-4111-8111-111111111111';
const setup=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`;

test('Distribution phase sets the home route and exposes a consistent locked-module response',()=>{
  assert.equal(DISTRIBUTION_ONLY,false);assert.equal(APP_HOME_ROUTE,'/distribution');assert.doesNotThrow(requireDeliveryEnabled);assert.throws(requireLegacyAdminEnabled,error=>error.status===423&&error.message==='Temporalmente inhabilitado');
});
test('Assignment history validates dates, pagination and academic groups',()=>{
  const filters=assignmentHistoryFilters(new URLSearchParams('from=2026-10-31&to=2026-10-31&semester=11'));
  assert.equal(filters.from,'2026-10-31T05:00:00.000Z');assert.equal(filters.until,'2026-11-01T05:00:00.000Z');
  for(const query of ['page=0','page=1.5','pageSize=101','semester=12','from=2026-02-30','from=2026-11-02&to=2026-10-31']) assert.throws(()=>assignmentHistoryFilters(new URLSearchParams(query)));
});
test('Assignment history preserves snapshots, searches entire batches, paginates all results and locks every legacy RPC overload',async t=>{
  const db=new PGlite();
  const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
  const history=async(query='',semester=null,from=null,until=null,page=1,size=30)=>(await q('SELECT public.faculty_assignment_history($1,$2,$3,$4,$5,$6) value',[query,semester,from,until,page,size]))[0].value;
  const rejected=async(fn,code)=>{await db.exec('SAVEPOINT expected');try{await assert.rejects(fn(),error=>error.code===code);}finally{await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected');}};
  try {
    await db.exec(setup);await db.exec(base);await db.exec(faculty);await db.exec(promotion);
    await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await q("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:'reparto@example.test'})]);
    const student=(await q("SELECT public.save_faculty_student('Pérez José','00123',11,'FINESI',NULL,NULL) value"))[0].value;
    const assignment=(await q('SELECT public.assign_student_tickets($1,ARRAY[1050,1051,1052]) value',[student.id]))[0].value;
    await q("UPDATE public.ticket_assignments SET created_at='2026-10-31T04:59:59Z' WHERE id=$1",[assignment.assignmentId]);
    const second=(await q('SELECT public.assign_student_tickets($1,ARRAY[1060]) value',[student.id]))[0].value;
    await q("UPDATE public.ticket_assignments SET created_at='2026-10-31T05:00:00Z' WHERE id=$1",[second.assignmentId]);
    // Simulate an old overload still present in a previously upgraded database.
    await db.exec('CREATE FUNCTION public.update_ticket_pickup(uuid[],boolean,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;GRANT EXECUTE ON FUNCTION public.update_ticket_pickup(uuid[],boolean,text) TO authenticated');
    const snapshots=(await q('SELECT to_jsonb(a) value FROM public.ticket_assignments a ORDER BY id')).map(r=>r.value);
    const tickets=(await q('SELECT to_jsonb(t) value FROM public.tickets t ORDER BY id')).map(r=>r.value);
    await db.exec(mode);await db.exec(mode);
    assert.deepEqual((await q('SELECT to_jsonb(a) value FROM public.ticket_assignments a ORDER BY id')).map(r=>r.value),snapshots);
    assert.deepEqual((await q('SELECT to_jsonb(t) value FROM public.tickets t ORDER BY id')).map(r=>r.value),tickets);
    await t.test('name, code, actor and a zero-padded ticket identify the full immutable assignment batch',async()=>{
      for(const query of ['jose perez','00123','reparto@example.test','#01051']) {
        const result=await history(query);assert(result.assignments.some(a=>a.id===assignment.assignmentId));
      }
      const ticket=await history('#01051');assert.equal(ticket.total,1);assert.deepEqual(ticket.assignments[0].ticket_numbers,[1050,1051,1052]);
      await q("SELECT public.save_faculty_student('Nombre Actualizado','00123',10,'FINESI',$1,$2)",[student.id,student.roster_updated_at]);
      const renamed=await history('actualizado');assert.equal(renamed.assignments[0].student_name,'Pérez José');assert.equal(renamed.assignments[0].semester,11);assert.equal(renamed.assignments[0].current_student_name,'Nombre Actualizado');
    });
    await t.test('Lima filters exclude the previous day and retain the first instant of the selected date',async()=>{
      const result=await history('',11,'2026-10-31T05:00:00Z','2026-11-01T05:00:00Z');assert.equal(result.total,1);assert.equal(result.assignments[0].id,second.assignmentId);
    });
    await t.test('server pagination includes more than one thousand assignments with deterministic ordering',async()=>{
      await q(`INSERT INTO public.ticket_assignments(student_id,student_name,student_code,semester,actor_id,actor_email,ticket_numbers,created_at)
        SELECT $1,'Pérez José','00123',11,$2,'other@example.test',ARRAY[2000+n], '2026-11-01T00:00:00Z'::timestamptz+n*interval '1 second' FROM generate_series(1,1001)n`,[student.id,actor]);
      const first=await history('',null,null,null,1,100);const last=await history('',null,null,null,11,100);
      assert.equal(first.total,1003);assert.equal(first.assignments.length,100);assert.equal(last.assignments.length,3);assert.equal(first.hasMore,true);assert.equal(last.hasMore,false);
      assert.equal(first.summary.tickets,1005);assert.equal(first.summary.students,1);
    });
    await t.test('signed-in operators can still allocate and read history while every legacy overload is denied',async()=>{
      await db.exec('BEGIN;SET ROLE authenticated');
      try {
        assert.equal((await history('')).total,1003);
        await q('SELECT public.assign_student_tickets($1,ARRAY[4000])',[student.id]);
        for(const signature of [
          'public.update_ticket_pickup(uuid[],boolean,text,uuid)','public.update_ticket_pickup(uuid[],boolean,text)',
          'public.create_student_with_tickets(text,text,text,integer[])','public.import_students(jsonb)',
          'public.create_ticket(integer,uuid,boolean)','public.delete_student(uuid)','public.ticket_stats(date)',
        ]) assert.equal((await q('SELECT has_function_privilege(\'authenticated\',$1,\'EXECUTE\') allowed',[signature]))[0].allowed,false);
        await rejected(()=>q('SELECT public.create_ticket(5000,$1,false)',[student.id]),'42501');
        await rejected(()=>q('SELECT public.update_ticket_pickup(ARRAY[]::uuid[],false,NULL,NULL)'),'42501');
      } finally {await db.exec('ROLLBACK;RESET ROLE');}
    });
    await t.test('anonymous callers cannot read history through either grants or a forged anonymous login',async()=>{
      await db.exec('BEGIN;SET ROLE anon');await rejected(()=>history(),'42501');await db.exec('ROLLBACK;RESET ROLE');
      await q("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");
      await assert.rejects(history(),error=>error.code==='42501');
    });
  } finally {await db.close();}
});
