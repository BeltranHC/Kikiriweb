import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const files=['database.sql','20261031_faculty_distribution.sql','20261031_promotion_category.sql','20261031_distribution_only_history.sql','20261103_recipient_ticket_changes.sql','20261104_directory_performance.sql','20261104_semester_progress.sql','20261105_distribution_payments_deletion.sql'];
const migrations=await Promise.all(files.map(file=>readFile(new URL('../'+(file==='database.sql'?'':'supabase/migrations/')+file,import.meta.url),'utf8')));
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';

test('Distribution payments and deletions preserve history, enforce reversal before deletion and work for every signed-in operator',async t=>{
 const db=new PGlite();const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
 const login=async(id=actor)=>{await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await q("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:id===actor?'first@example.test':'second@example.test'})]);};
 const save=async(code)=>(await q("SELECT public.save_faculty_recipient($1,$2,2,'FINESI') v",['Person '+code,code]))[0].v;
 const assign=async(person,numbers,method=null)=>(await q('SELECT public.assign_faculty_tickets($1,$2,$3) v',[person.id,numbers,method]))[0].v;
 const fresh=async(ticket)=>(await q('SELECT to_jsonb(t) v FROM public.tickets t WHERE id=$1',[ticket.id]))[0].v;
 const payment=async(person,ticket,action='pay',method='cash')=>(await q('SELECT public.set_faculty_ticket_payment($1,$2,$3,$4,$5) v',[ticket.id,person.id,action,action==='pay'?method:null,ticket.assignment_updated_at]))[0].v;
 const remove=async(person,ticket)=>(await q('SELECT public.delete_faculty_ticket($1,$2,$3) v',[ticket.id,person.id,ticket.assignment_updated_at]))[0].v;
 const versions=async(person)=>(await q("SELECT jsonb_build_object('id',id,'updated_at',assignment_updated_at) v FROM public.tickets WHERE student_id=$1 AND deleted_at IS NULL ORDER BY id",[person.id])).map(row=>row.v);
 const removePerson=async(person,expected=null)=>(await q('SELECT public.delete_faculty_recipient($1,$2,$3) v',[person.id,person.roster_updated_at,JSON.stringify(expected??await versions(person))]))[0].v;
 const list=async(query='')=>(await q("SELECT public.faculty_directory_v2($1,NULL,NULL,'all',1,100) v",[query]))[0].v;
 const rows=async(table)=>q(`SELECT to_jsonb(t) v FROM public.${table} t ORDER BY id`);
 const reject=async(fn,code='P0001')=>{await db.exec('SAVEPOINT expected');try{await assert.rejects(fn(),error=>error.code===code);}finally{await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected');}};
 const run=(name,fn)=>t.test(name,async()=>{await db.exec('BEGIN');try{await login();await fn();}finally{await db.exec('ROLLBACK;RESET ROLE');}});
 try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`);
  for(const migration of migrations.slice(0,-1))await db.exec(migration);
  await q("INSERT INTO public.students(name,code,semester) VALUES('Legacy paid','OLD',11)");
  await q("INSERT INTO public.tickets(ticket_number,student_id,is_paid,is_picked_up,picked_up_at,payment_method) SELECT 900,id,true,true,'2020-01-02T12:00:00Z','en_momento_yape|previous@example.test' FROM public.students WHERE code='OLD'");
  await q("INSERT INTO public.ticket_movements(kind,ticket_ids,ticket_snapshots) SELECT 'pickup',ARRAY[id],'[]' FROM public.tickets WHERE ticket_number=900");
  const tables=['students','tickets','ticket_assignments','ticket_movements','faculty_changes'];const original=await Promise.all(tables.map(rows));
  await db.exec(migrations.at(-1));await db.exec(migrations.at(-1));
  for(let i=0;i<tables.length;i++){const after=await rows(tables[i]);assert.equal(after.length,original[i].length);for(let row=0;row<after.length;row++)for(const[key,value]of Object.entries(original[i][row].v))assert.deepEqual(after[row].v[key],value);}
  assert.equal((await rows('faculty_payments')).length,0);
  await run('Pending, cash and Yape allocations use authoritative prices, preserve pickup state and audit the session actor',async()=>{
   const person=await save('ALLOC');const pending=await assign(person,[1000]);assert.equal(pending.tickets[0].is_paid,false);assert.equal((await rows('faculty_payments')).length,0);
   for(const [method,numbers]of [['cash',[1001,1002]],['yape',[1003]]]){
    const batch=await assign(person,numbers,method);assert.equal(batch.paymentTotal,numbers.length*15);
    assert(batch.tickets.every(ticket=>ticket.is_paid&&ticket.paid_by===actor&&ticket.paid_at&&!ticket.is_picked_up&&ticket.picked_up_at===null));
    assert(batch.tickets.every(ticket=>ticket.payment_method.startsWith(method==='cash'?'en_momento_efectivo':'en_momento_yape')));
   }
   const events=await rows('faculty_payments');assert.equal(events.length,3);assert(events.every(event=>event.v.actor_id===actor&&event.v.amount===15));
   const directory=await list('ALLOC');assert.equal(directory.students[0].tickets.filter(t=>t.is_paid).length,3);assert(directory.students[0].tickets.every(t=>t.can_manage));
   await reject(()=>assign(person,[1100],'card'),'22023');assert.equal((await q('SELECT count(*) n FROM public.tickets WHERE ticket_number=1100'))[0].n,0);
  });
  await run('Existing tickets can be paid once; voiding preserves ownership and uses the original payment amount',async()=>{
   const person=await save('PAY');const ticket=(await assign(person,[2000])).tickets[0];await login(other);const paid=await payment(person,ticket,'pay','yape');assert.equal(paid.ticket.paid_by,other);assert.equal(paid.ticket.paid_amount,15);
   await reject(()=>payment(person,ticket));await reject(()=>payment(person,paid.ticket));
   await q('UPDATE public.tickets SET unit_price=99 WHERE id=$1',[ticket.id]);const actual=await fresh(ticket);const voided=await payment(person,actual,'void');assert.equal(voided.amount,15);assert.equal(voided.ticket.student_id,person.id);assert.equal(voided.ticket.is_paid,false);assert.equal(voided.ticket.payment_method,null);assert.equal(voided.ticket.paid_amount,null);
   const events=(await rows('faculty_payments')).map(row=>row.v);assert.equal(events.length,2);const reversal=events.find(e=>e.kind==='void');assert.equal(reversal.reverses_id,paid.paymentEventId);assert.equal(reversal.actor_id,other);await reject(()=>payment(person,voided.ticket,'void'));
  });
  await run('Paid tickets must be voided before deletion; deletion keeps IDs and original assignments and supports reuse without delivery history',async()=>{
   const person=await save('DELETE'),target=await save('REUSE');const batch=await assign(person,[3000],'cash');const ticket=batch.tickets[0];await reject(()=>remove(person,ticket));assert.equal((await fresh(ticket)).deleted_at,null);
   const voided=await payment(person,ticket,'void');const removed=await remove(person,voided.ticket);assert(removed.ticket.deleted_at);assert.equal(removed.ticket.student_id,null);assert.equal(removed.ticket.is_available,true);
   assert.equal((await list('DELETE')).students[0].tickets.length,0);assert.deepEqual((await q('SELECT ticket_numbers FROM public.ticket_assignments WHERE id=$1',[batch.assignmentId]))[0].ticket_numbers,[3000]);
   const reused=await assign(target,[3000]);assert.equal(reused.tickets[0].id,ticket.id);assert.equal(reused.tickets[0].deleted_at,null);assert.equal(reused.tickets[0].is_paid,false);assert.equal((await rows('faculty_payments')).length,2);
   assert((await rows('faculty_changes')).some(row=>row.v.entity_id===ticket.id&&row.v.operation==='delete'&&row.v.actor_id===actor));
  });
  await run('Legacy paid deliveries can be voided and removed while their pickup fields and movement snapshots remain intact',async()=>{
   const person=(await list('OLD')).students[0];const ticket=person.tickets[0];const before=await fresh(ticket);const movements=await rows('ticket_movements');await reject(()=>remove(person,ticket));
   const voided=await payment(person,ticket,'void');assert.equal(voided.ticket.is_picked_up,true);assert.equal(voided.ticket.picked_up_at,before.picked_up_at);assert((await rows('faculty_payments'))[0].v.is_legacy);
   const removed=await remove(person,voided.ticket);assert.equal(removed.ticket.is_available,false);assert.deepEqual(await rows('ticket_movements'),movements);const target=await save('NO-REUSE');await reject(()=>assign(target,[900]));
  });
  await run('Deleting a participant blocks paid tickets, detects changed assignments and retires unpaid tickets atomically',async()=>{
   const person=await save('PERSON');const paid=await assign(person,[4000],'cash');await reject(()=>removePerson(person));assert.equal((await list('PERSON')).total,1);
   await payment(person,paid.tickets[0],'void');const expected=await versions(person);await assign(person,[4001]);await reject(()=>removePerson(person,expected));assert.equal((await list('PERSON')).students[0].tickets.length,2);
   const result=await removePerson(person);assert.equal(result.ticketsRemoved,2);assert.equal((await list('PERSON')).total,0);const archived=(await q('SELECT to_jsonb(s) v FROM public.students s WHERE id=$1',[person.id]))[0].v;assert(archived.deleted_at);assert.equal(archived.code,'PERSON');assert.equal(archived.deleted_by,actor);
   assert.equal((await q("SELECT public.import_faculty_roster('[{\"name\":\"Archived\",\"code\":\"PERSON\",\"semester\":2}]') v"))[0].v.studentsCreated,0);assert.equal((await list('PERSON')).total,0);
   const recreated=await save('PERSON');assert.notEqual(recreated.id,person.id);assert.equal((await q("SELECT public.import_faculty_roster('[{\"name\":\"Duplicate\",\"code\":\"PERSON\",\"semester\":2}]') v"))[0].v.studentsExisting,1);
   await reject(()=>assign(person,[4002]),'P0002');await reject(()=>q("SELECT public.save_faculty_student('Edited','PERSON',2,'FINESI',$1,$2)",[person.id,archived.roster_updated_at]),'P0002');
   const history=(await q("SELECT public.faculty_assignment_history('PERSON') v"))[0].v;assert(history.assignments.some(item=>item.student_id===person.id));
  });
  await run('All authenticated accounts have payment and deletion RPC permissions while direct ledger or row writes and anonymous callers are denied',async()=>{
   await db.exec('SET ROLE authenticated');
   for(const [index,id]of [actor,other].entries()){
    await login(id);const person=await save('ACCOUNT-'+index);const assigned=await assign(person,[5000+index]);const paid=await payment(person,assigned.tickets[0]);const voided=await payment(person,paid.ticket,'void');await remove(person,voided.ticket);await removePerson(person);
   }
   await reject(()=>q('DELETE FROM public.faculty_payments'),'42501');await reject(()=>q("UPDATE public.faculty_payments SET actor_email='forged'"),'42501');await reject(()=>q('UPDATE public.students SET deleted_at=now()'),'42501');await reject(()=>q('UPDATE public.tickets SET is_paid=true'),'42501');
   await db.exec('RESET ROLE;SET ROLE anon');await reject(()=>q("SELECT public.assign_faculty_tickets(NULL,ARRAY[9999],'cash')"),'42501');await db.exec('RESET ROLE;SET ROLE authenticated');await q("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',true)");await reject(()=>q("SELECT public.set_faculty_ticket_payment(NULL,NULL,'pay','cash',now())"),'42501');
  });
  await run('A failed payment record rolls back the entire allocation including tickets, assignment and audit entries',async()=>{
   const person=await save('ROLLBACK');const assignments=await rows('ticket_assignments'),audit=await rows('faculty_changes');
   await db.exec("CREATE FUNCTION public.reject_payment_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'payment failure';END$$;CREATE TRIGGER reject_payment_test BEFORE INSERT ON public.faculty_payments FOR EACH ROW EXECUTE FUNCTION public.reject_payment_test()");
   await reject(()=>assign(person,[6000,6001],'cash'));assert.equal((await q('SELECT count(*) n FROM public.tickets WHERE ticket_number IN(6000,6001)'))[0].n,0);assert.deepEqual(await rows('ticket_assignments'),assignments);assert.deepEqual(await rows('faculty_changes'),audit);
  });
  await t.test('Reapplying the migration preserves archives, reused student codes, payment records and audit snapshots',async()=>{
   await login();const archived=await save('IDEMPOTENT');await removePerson(archived);const active=await save('IDEMPOTENT');await assign(active,[7000],'yape');const allTables=[...tables,'faculty_payments'];const before=await Promise.all(allTables.map(rows));await db.exec(migrations.at(-1));assert.deepEqual(await Promise.all(allTables.map(rows)),before);
  });
 }finally{await db.close();}
});
