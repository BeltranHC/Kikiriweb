import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const migrations=await Promise.all(['database.sql','supabase/migrations/20261031_faculty_distribution.sql','supabase/migrations/20261031_promotion_category.sql','supabase/migrations/20261031_distribution_only_history.sql','supabase/migrations/20261103_recipient_ticket_changes.sql'].map(read));
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('Participant categories, corrections, transfers, releases and automatic actor audit preserve previous data',async t=>{
 const db=new PGlite();const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
 const login=async(id=actor,email='operator@example.test')=>{await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await q("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({email})]);};
 const save=async(name,code,type='student',id=null,version=null)=>(await q("SELECT public.save_faculty_recipient($1,$2,$3,'FINESI',$4,$5,$6) v",[name,code,type==='student'?2:null,id,version,type]))[0].v;
 const assign=async(id,numbers)=>(await q('SELECT public.assign_student_tickets($1,$2) v',[id,numbers]))[0].v;
 const edit=async(ticket,student,action='update',number=null,destination=null)=>(await q('SELECT public.edit_faculty_ticket($1,$2,$3,$4,$5,$6) v',[ticket.id,student.id,action,number,destination,ticket.assignment_updated_at]))[0].v;
 const history=async(query='',page=1,size=30)=>(await q('SELECT public.faculty_change_history($1,NULL,NULL,$2,$3) v',[query,page,size]))[0].v;
 const reject=async(fn,code)=>{await db.exec('SAVEPOINT expected');try{await assert.rejects(fn(),e=>e.code===code);}finally{await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected');}};
 const run=(name,fn)=>t.test(name,async()=>{await db.exec('BEGIN');try{await login();await fn();}finally{await db.exec('ROLLBACK;RESET ROLE');}});
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`);
  for(const migration of migrations.slice(0,-1))await db.exec(migration);
  await q("INSERT INTO public.students(name,code) VALUES('Legacy person','OLD-01')");
  await q('INSERT INTO public.tickets(ticket_number,student_id) SELECT 900,id FROM public.students');
  const originalStudents=await q('SELECT to_jsonb(s) v FROM public.students s'),originalTickets=await q('SELECT to_jsonb(t) v FROM public.tickets t');
  await db.exec(migrations.at(-1));await db.exec(migrations.at(-1));
  for(const [table,before] of [['students',originalStudents],['tickets',originalTickets]]) {
   const after=(await q(`SELECT to_jsonb(t) v FROM public.${table} t`))[0].v;
   for(const [key,value] of Object.entries(before[0].v))assert.deepEqual(after[key],value);
  }
  assert.equal((await q('SELECT count(*) n FROM public.faculty_changes'))[0].n,0);
  await run('External and teacher profiles allow no student code, retain categories and keep semesters exclusive to students',async()=>{
   const ext=await save('Visitor',null,'external'),teacher=await save('Teacher',null,'teacher');assert.equal(ext.code,null);assert.equal(teacher.semester,null);
   await reject(()=>save('Missing code',null),'22023');await reject(()=>save('Bad category','BAD','admin'),'22023');
   const list=(await q("SELECT public.faculty_recipient_directory('',NULL,'external',1,30) v"))[0].v;assert.equal(list.total,1);assert.equal(list.students[0].id,ext.id);
   const none=(await q("SELECT public.faculty_recipient_directory('',0,'student',1,30) v"))[0].v;assert.equal(none.total,1);
   const updated=await save('Visitor corrected',null,'teacher',ext.id,ext.roster_updated_at);assert.equal(updated.recipient_type,'teacher');
   assert.equal(updated.roster_updated_by,actor);assert.equal(updated.roster_updated_by_email,'operator@example.test');
  });
  await run('Profile creation, editing and CSV inserts capture the session actor and immutable before/after snapshots',async()=>{
   const person=await save('Original profile','CODE');await login(other,'second@example.test');await save('Edited profile','CODE','student',person.id,person.roster_updated_at);
   const events=(await history('CODE')).changes;assert.equal(events.length,2);assert.equal(events[0].actor_id,other);assert.equal(events[0].before_data.name,'Original profile');assert.equal(events[0].after_data.name,'Edited profile');
   const rows=JSON.stringify([{name:'Import row',code:'IMPORT',semester:3}]);await q('SELECT public.import_faculty_roster($1)',[rows]);await q('SELECT public.import_faculty_roster($1)',[rows]);
   assert.equal((await history('IMPORT')).total,1);
  });
  await run('Correcting a number keeps ticket identity and original assignment while stale edits and duplicates roll back without audit',async()=>{
   const person=await save('Ticket owner','OWNER');const batch=await assign(person.id,[1000,1001]);const ticket=batch.tickets[0];
   const result=await edit(ticket,person,'update',1050);assert.equal(result.ticket.id,ticket.id);assert.equal(result.ticket.student_id,person.id);
   assert.deepEqual((await q('SELECT ticket_numbers FROM public.ticket_assignments WHERE id=$1',[batch.assignmentId]))[0].ticket_numbers,[1000,1001]);
   const count=(await history()).total;await reject(()=>edit(ticket,person,'update',1060),'P0001');await reject(()=>edit(result.ticket,person,'update',1001),'23505');assert.equal((await history()).total,count);
   const event=(await history('1050')).changes[0];assert.equal(event.before_data.ticket_number,1000);assert.equal(event.after_data.ticket_number,1050);assert.equal(event.actor_id,actor);
  });
  await run('Transfer keeps the ticket, creates a destination assignment, and records old/new names and the responsible user',async()=>{
   const a=await save('Source person','SOURCE'),b=await save('Destination teacher',null,'teacher');const original=await assign(a.id,[2000]);
   await login(other,'second@example.test');const result=await edit(original.tickets[0],a,'transfer',null,b.id);assert.equal(result.ticket.id,original.tickets[0].id);assert.equal(result.ticket.student_id,b.id);
   const event=(await history('2000')).changes[0];assert.equal(event.before_data.student_name,'Source person');assert.equal(event.after_data.student_name,'Destination teacher');assert.equal(event.actor_email,'second@example.test');
   const assignments=await q('SELECT * FROM public.ticket_assignments ORDER BY created_at');assert.equal(assignments.length,2);assert.equal(assignments[1].recipient_type,'teacher');assert.equal(assignments[1].actor_id,other);
  });
  await run('Release preserves the record and allows later allocation of the same ID without partially assigning a conflicting batch',async()=>{
   const a=await save('First owner','FIRST'),b=await save('Second owner','SECOND');const batch=await assign(a.id,[3000,3001]);const ticket=batch.tickets[0];
   const released=await edit(ticket,a,'release');assert.equal(released.ticket.student_id,null);assert.equal(released.ticket.is_available,true);
   await reject(()=>assign(b.id,[3000,3001,3002]),'P0001');assert.equal((await q('SELECT count(*) n FROM public.tickets WHERE ticket_number=3002'))[0].n,0);
   const reallocated=await assign(b.id,[3000]);assert.equal(reallocated.tickets[0].id,ticket.id);assert.equal(reallocated.tickets[0].is_available,false);assert.equal(reallocated.tickets[0].student_id,b.id);
   assert.equal((await q('SELECT count(*) n FROM public.ticket_assignments WHERE id=$1',[batch.assignmentId]))[0].n,1);
  });
  await run('Paid, delivered and previously undone delivery tickets cannot be corrected, released or transferred',async()=>{
   const person=await save('Protected owner','PROTECTED'),dest=await save('Target','TARGET');const ticket=(await assign(person.id,[4000])).tickets[0];
   for(const state of ['is_paid=true','is_paid=false,is_picked_up=true']) {
    await q('UPDATE public.tickets SET '+state+' WHERE id=$1',[ticket.id]);const latest=(await q('SELECT * FROM public.tickets WHERE id=$1',[ticket.id]))[0];
    for(const action of ['update','transfer','release'])await reject(()=>edit(latest,person,action,4001,dest.id),'P0001');
   }
   await q('UPDATE public.tickets SET is_picked_up=false,is_paid=false WHERE id=$1',[ticket.id]);
   await q("INSERT INTO public.ticket_movements(kind,ticket_ids,ticket_snapshots) VALUES('undo',$1,'[]')",[[ticket.id]]);
   const latest=(await q('SELECT * FROM public.tickets WHERE id=$1',[ticket.id]))[0];await reject(()=>edit(latest,person,'release'),'P0001');
  });
  await run('Anonymous access and forged audit writes are denied while operators can read and edit through transactional RPCs',async()=>{
   const person=await save('Security owner','SECURITY');const ticket=(await assign(person.id,[5000])).tickets[0];
   await db.exec('SET ROLE authenticated');await edit(ticket,person,'update',5001);assert((await history()).total>0);
   await reject(()=>q("UPDATE public.faculty_changes SET actor_email='forged'"),'42501');await reject(()=>q('DELETE FROM public.faculty_changes'),'42501');await reject(()=>q('UPDATE public.tickets SET ticket_number=5002'),'42501');
   await db.exec('RESET ROLE;SET ROLE anon');await reject(()=>history(),'42501');await db.exec('RESET ROLE');
   await q("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");await reject(()=>save('Anonymous','ANON'),'42501');
  });
  await run('A failed audit insert cancels the ticket change and its version update together',async()=>{
   const person=await save('Rollback owner','ROLLBACK');const ticket=(await assign(person.id,[6000])).tickets[0];
   await db.exec("CREATE FUNCTION public.reject_change_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit failure';END$$; CREATE TRIGGER reject_change_test BEFORE INSERT ON public.faculty_changes FOR EACH ROW EXECUTE FUNCTION public.reject_change_test()");
   await reject(()=>edit(ticket,person,'update',6001),'P0001');const actual=(await q('SELECT * FROM public.tickets WHERE id=$1',[ticket.id]))[0];assert.equal(actual.ticket_number,6000);assert.equal((await q('SELECT assignment_updated_at=$1::timestamptz preserved FROM public.tickets WHERE id=$2',[ticket.assignment_updated_at,ticket.id]))[0].preserved,true);
  });
  await run('Audit uses Lima date bounds and paginates over one thousand records without losing entries',async()=>{
   await q("INSERT INTO public.students(name,recipient_type) SELECT 'Bulk person '||n,'external' FROM generate_series(1,1005)n");
   const first=await history('Bulk',1,100),last=await history('Bulk',11,100);assert.equal(first.total,1005);assert.equal(last.changes.length,5);assert.equal(last.hasMore,false);
   const until=(await q("SELECT public.faculty_change_history('',NULL,'2000-01-01',1,30) v"))[0].v;assert.equal(until.total,0);
  });
 }finally{await db.close();}
});
