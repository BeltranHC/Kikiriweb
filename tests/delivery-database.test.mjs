import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildAnalytics} from '../lib/analytics.mjs';
import {PGlite} from '@electric-sql/pglite';
const names=['database.sql','20261031_faculty_distribution.sql','20261031_promotion_category.sql','20261031_distribution_only_history.sql','20261103_recipient_ticket_changes.sql','20261104_directory_performance.sql','20261104_semester_progress.sql','20261105_distribution_payments_deletion.sql','20261106_batch_ticket_payments.sql','20261110_enable_deliveries.sql','20261110_prepaid_delivery.sql'];
const files=await Promise.all(names.map(name=>readFile(new URL('../'+(name==='database.sql'?'':'supabase/migrations/')+name,import.meta.url),'utf8')));
const analyticsMigration=await readFile(new URL('../supabase/migrations/20261112_statistics_dashboard.sql',import.meta.url),'utf8');
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
test('Delivery reactivation preserves prepaid tickets and reconciles legacy, distribution and delivery cash without double charges',async t=>{
 const db=new PGlite();const q=async(sql,values=[])=>(await db.query(sql,values)).rows;
 const login=async(id=actor)=>{await q("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);await q("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:id===actor?'distribution@example.test':'delivery@example.test'})]);};
 const save=async code=>(await q("SELECT public.save_faculty_recipient($1,$2,2,'FINESI') v",['Person '+code,code]))[0].v;
 const assign=async(person,numbers,method=null)=>(await q('SELECT public.assign_faculty_tickets($1,$2,$3) v',[person.id,numbers,method]))[0].v;
 const fresh=async ticket=>(await q('SELECT to_jsonb(t) v FROM public.tickets t WHERE id=$1',[ticket.id]))[0].v;
 const snapshot=tickets=>JSON.stringify(tickets.map(ticket=>({id:ticket.id,updated_at:ticket.assignment_updated_at})));
 const deliver=async(tickets,method=null)=>(await q('SELECT to_jsonb(t) v FROM public.deliver_tickets($1,$2,$3) t',[tickets.map(ticket=>ticket.id),method,snapshot(tickets)])).map(row=>row.v);
 const undo=async tickets=>(await q('SELECT to_jsonb(t) v FROM public.undo_delivery($1,$2) t',[tickets.map(ticket=>ticket.id),tickets[0].movement_id])).map(row=>row.v);
 const stats=async()=>(await q("SELECT public.delivery_stats((clock_timestamp() AT TIME ZONE 'America/Lima')::date) v"))[0].v;
 const rows=async table=>q(`SELECT to_jsonb(t) v FROM public.${table} t ORDER BY to_jsonb(t)::text`);
 const reject=async(fn,code='P0001')=>{await db.exec('SAVEPOINT expected');try{await assert.rejects(fn(),error=>error.code===code);}finally{await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected');}};
 const run=(name,fn)=>t.test(name,async()=>{await db.exec('BEGIN');try{await login();await fn();}finally{await db.exec('ROLLBACK;RESET ROLE');}});
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`);
  for(const file of files.slice(0,-2))await db.exec(file);await login();const legacy=await save('LEGACY');
  await q("INSERT INTO public.tickets(ticket_number,student_id,is_paid,unit_price,payment_method,paid_at) VALUES(1,$1,true,15,'en_momento_efectivo|old@example.test','2020-01-02T10:00:00Z'),(2,$1,true,20,'en_momento_yape|old@example.test','2020-01-02T10:00:00Z'),(3,$1,true,15,'previo|old@example.test',NULL)",[legacy.id]);
  const old=(await q('SELECT to_jsonb(t) v FROM public.tickets t WHERE ticket_number=2'))[0].v;await q("SELECT public.set_faculty_ticket_payment($1,$2,'void',NULL,$3)",[old.id,legacy.id,old.assignment_updated_at]);
  const pre=await save('PREPAID');await assign(pre,[4],'cash');await save('WITHOUT');
  const tables=['students','tickets','ticket_assignments','ticket_movements','faculty_changes','faculty_payments'];const before=await Promise.all(tables.map(rows));await db.exec(files.at(-2));assert.deepEqual(await Promise.all(tables.map(rows)),before);const baseline=await rows('legacy_ticket_payments');assert.equal(baseline.length,3);await db.exec(files.at(-2));assert.deepEqual(await rows('legacy_ticket_payments'),baseline);
  const priorUpgrade=await Promise.all(tables.map(rows));await db.exec(files.at(-1));assert.deepEqual(await Promise.all(tables.map(rows)),priorUpgrade);assert.deepEqual(await rows('legacy_ticket_payments'),baseline);await db.exec(files.at(-1));assert.deepEqual(await Promise.all(tables.map(rows)),priorUpgrade);
  await db.exec(analyticsMigration);
  await t.test('Opening cash includes old payments, their pre-existing reversals and distribution money without inventing dates',async()=>{const result=await stats();assert.equal(result.collectedTotal,45);assert.equal(result.collectedCashTotal,30);assert.equal(result.collectedYapeTotal,0);assert.equal(result.collectedOtherTotal,15);assert.equal(result.legacyWithoutDate,1);assert.equal(result.collectedNow,-5);assert.equal(result.totalStudents,2);});
  await run('Statistics snapshot reconciles cash and current counters without changing any record',async()=>{
   const before=await Promise.all(tables.map(rows));const source=(await q('SELECT public.ticket_analytics_source() v'))[0].v;const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'});const report=buildAnalytics(source,{from:'1900-01-01',to:day,group:'all',actor:'all'});const current=await stats();assert.equal(report.summary.tickets,current.totalTickets);assert.equal(report.summary.picked,current.pickedUp);assert.equal(report.finance.accumulated,current.collectedTotal);assert.equal(report.finance.cash,current.collectedCashTotal);assert.equal(report.finance.yape,current.collectedYapeTotal);assert.deepEqual(await Promise.all(tables.map(rows)),before);
   await db.exec('SET ROLE authenticated');await q('SELECT public.ticket_analytics_source()');await db.exec('RESET ROLE;SET ROLE anon');await reject(()=>q('SELECT public.ticket_analytics_source()'),'42501');await db.exec('RESET ROLE');
   await q("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',false)");await reject(()=>q('SELECT public.ticket_analytics_source()'),'42501');
  });
  await run('Explicit Prepagado records zero, preserves existing paid tickets and keeps cash unchanged with the acting user',async()=>{
   const person=await save('CONFIRM');const paid=(await assign(person,[1800],'yape')).tickets[0];const pending=(await assign(person,[1801,1802])).tickets;const balance=await stats();const originalPayments=(await rows('faculty_payments')).length;await login(other);
   const delivered=await deliver([paid,...pending],'prepaid');const previous=delivered.find(ticket=>ticket.id===paid.id);
   for(const key of ['payment_id','payment_method','paid_at','paid_amount','paid_by','paid_by_email'])assert.equal(previous[key],paid[key]);
   for(const ticket of delivered.filter(ticket=>ticket.id!==paid.id)){assert.equal(ticket.is_paid,true);assert.equal(ticket.is_picked_up,true);assert.equal(ticket.paid_amount,0);assert.equal(ticket.payment_method,'prepaid|delivery@example.test');assert.equal(ticket.paid_by,other);assert(ticket.payment_id);}
   const cash=await stats();for(const key of ['collectedTotal','collectedCashTotal','collectedYapeTotal','collectedNow','collectedCash','collectedYape'])assert.equal(cash[key],balance[key]);
   const entries=await q("SELECT amount,method,actor_id FROM public.faculty_payments WHERE ticket_id=ANY($1)",[pending.map(ticket=>ticket.id)]);assert.equal(entries.length,2);assert(entries.every(entry=>Number(entry.amount)===0&&entry.method==='prepaid'&&entry.actor_id===other));assert.equal((await rows('faculty_payments')).length,originalPayments+2);
   const event=(await q('SELECT * FROM public.ticket_movements WHERE id=$1',[delivered[0].movement_id]))[0];assert.equal(event.payment_method,'prepaid');assert(event.ticket_snapshots.every(ticket=>Number(ticket.collected_now)===0));assert.equal(event.actor_id,other);
   const analyticsSource=(await q('SELECT public.ticket_analytics_source() v'))[0].v;const analytics=buildAnalytics(analyticsSource,{from:'1900-01-01',to:new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'}),group:'all',actor:'all'});assert.equal(analytics.summary.prepaid,2);assert.equal(analytics.summary.picked,3);assert.equal(analytics.finance.accumulated,cash.collectedTotal);assert.equal(analyticsSource.movements.find(movement=>movement.id===event.id).items.length,3);assert.equal(analytics.activity.delivered,3);
   const audit=await q("SELECT * FROM public.faculty_changes WHERE entity_id=$1 AND after_data->>'payment_method' LIKE 'prepaid%'",[pending[0].id]);assert(audit.some(event=>event.actor_id===other));await reject(()=>deliver([paid,...pending],'prepaid'));
  });
  await run('Prepagado survives undo and redelivery, and grouped cancellation changes no cash',async()=>{
   const person=await save('PREVOID');let tickets=await deliver((await assign(person,[1900,1901])).tickets,'prepaid');const balance=await stats();const payments=await rows('faculty_payments');tickets=await undo(tickets);tickets=await deliver(tickets);assert.deepEqual(await rows('faculty_payments'),payments);tickets=await undo(tickets);
   const result=(await q("SELECT public.set_faculty_ticket_payments($1,$2,'pending',0) v",[person.id,snapshot(tickets)]))[0].v;assert.equal(result.changed,2);assert.equal(result.total,0);assert(result.tickets.every(ticket=>!ticket.is_paid));assert.equal((await stats()).collectedTotal,balance.collectedTotal);
   const reversals=await q("SELECT * FROM public.faculty_payments WHERE ticket_id=ANY($1) AND kind='void'",[tickets.map(ticket=>ticket.id)]);assert.equal(reversals.length,2);assert(reversals.every(entry=>Number(entry.amount)===0&&entry.method==='prepaid'&&entry.reverses_id&&!entry.is_legacy));
  });
  await run('Prepagado rejects stale versions and rolls back the complete batch if its second confirmation fails',async()=>{
   const person=await save('PREFAIL');const tickets=(await assign(person,[2000,2001])).tickets.sort((a,b)=>a.id.localeCompare(b.id));const before=await Promise.all(tables.map(rows));
   await db.exec(`CREATE FUNCTION public.reject_prepaid_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.ticket_id='${tickets[1].id}'::uuid THEN RAISE EXCEPTION 'failure';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_prepaid_test BEFORE INSERT ON public.faculty_payments FOR EACH ROW EXECUTE FUNCTION public.reject_prepaid_test()`);await reject(()=>deliver(tickets,'prepaid'));assert.deepEqual(await Promise.all(tables.map(rows)),before);
   await q('UPDATE public.tickets SET unit_price=17 WHERE id=$1',[tickets[1].id]);const changed=await Promise.all(tables.map(rows));await reject(()=>deliver(tickets,'prepaid'));assert.deepEqual(await Promise.all(tables.map(rows)),changed);
  });
  await run('Prepagado requires zero and zero-value cash records remain forbidden; reinstall preserves confirmations',async()=>{
   const person=await save('PRECHECK');const ticket=(await assign(person,[2100])).tickets[0];
   for(const [method,amount]of [['prepaid',15],['prepaid',-15],['cash',0],['yape',0]])await reject(()=>q("INSERT INTO public.faculty_payments(ticket_id,kind,amount,method,actor_id,ticket_snapshot) VALUES($1,'payment',$2,$3,$4,'{}')",[ticket.id,amount,method,actor]),'23514');
   await deliver([ticket],'prepaid');const before=await Promise.all(tables.map(rows));await db.exec(files.at(-1).replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));assert.deepEqual(await Promise.all(tables.map(rows)),before);
  });
  await run('Mixed delivery charges only pending tickets and preserves the original prepaid method, date, actor and amount',async()=>{
   const person=await save('MIX');const paid=(await assign(person,[1000],'yape')).tickets[0];const pending=(await assign(person,[1001])).tickets[0];const balance=await stats();await login(other);const result=await deliver([paid,pending],'cash');
   const previous=result.find(ticket=>ticket.id===paid.id);for(const key of ['payment_id','payment_method','paid_at','paid_amount','paid_by','paid_by_email'])assert.equal(previous[key],paid[key]);assert.equal(previous.picked_up_by,other);assert(result.every(ticket=>ticket.is_picked_up));assert.equal((await stats()).collectedTotal,balance.collectedTotal+15);
   const event=(await q('SELECT ticket_snapshots FROM public.ticket_movements WHERE id=$1',[result[0].movement_id]))[0];assert.deepEqual(event.ticket_snapshots.map(ticket=>ticket.collected_now).sort((a,b)=>a-b),[0,15]);await reject(()=>deliver([paid,pending],'cash'));
  });
  await run('Undo preserves every payment and redelivering the same tickets collects zero additional money',async()=>{
   const person=await save('UNDO');const tickets=(await assign(person,[1100,1101])).tickets;const delivered=await deliver(tickets,'yape');const balance=await stats(),payments=await rows('faculty_payments');const reverted=await undo(delivered);assert(reverted.every(ticket=>ticket.is_paid&&!ticket.is_picked_up));assert.equal((await stats()).collectedTotal,balance.collectedTotal);assert.deepEqual(await rows('faculty_payments'),payments);await deliver(reverted);assert.deepEqual(await rows('faculty_payments'),payments);await reject(()=>undo(delivered));
  });
  await run('Stale versions, released tickets, deleted profiles and invalid methods cannot deliver or collect anything',async()=>{
   const person=await save('STALE');const tickets=(await assign(person,[1200,1201])).tickets;await q('UPDATE public.tickets SET unit_price=17 WHERE id=$1',[tickets[1].id]);const before=await rows('faculty_payments');await reject(()=>deliver(tickets,'cash'));assert.deepEqual(await rows('faculty_payments'),before);assert.equal((await fresh(tickets[0])).is_picked_up,false);await reject(async()=>deliver(await Promise.all(tickets.map(fresh)),'card'),'22023');
  });
  await run('An error in the second delivery payment rolls back all money, pickup and audit changes',async()=>{
   const person=await save('FAIL');const tickets=(await assign(person,[1300,1301])).tickets.sort((a,b)=>a.id.localeCompare(b.id));const before=await Promise.all(tables.map(rows));await db.exec(`CREATE FUNCTION public.reject_delivery_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.ticket_id='${tickets[1].id}'::uuid THEN RAISE EXCEPTION 'failure';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_delivery_test BEFORE INSERT ON public.faculty_payments FOR EACH ROW EXECUTE FUNCTION public.reject_delivery_test()`);await reject(()=>deliver(tickets,'cash'));assert.deepEqual(await Promise.all(tables.map(rows)),before);
  });
  await run('Legacy reversals use the preserved baseline amount after a price change, including grouped reversals',async()=>{
   const ticket=(await q('SELECT to_jsonb(t) v FROM public.tickets t WHERE ticket_number=1'))[0].v;await q('UPDATE public.tickets SET unit_price=99 WHERE id=$1',[ticket.id]);const current=await fresh(ticket);const balance=await stats();const result=(await q("SELECT public.set_faculty_ticket_payments($1,$2,'pending',15) v",[legacy.id,snapshot([current])]))[0].v;assert.equal(result.total,15);assert.equal((await stats()).collectedTotal,balance.collectedTotal-15);
  });
  await run('Delivery search handles exact ticket numbers, code and names while excluding profiles without tickets and archived or released rows',async()=>{
   const person=await save('SEARCH');const assigned=await assign(person,[1400,1401]);await q('UPDATE public.tickets SET student_id=NULL,assignment_id=NULL,is_available=true WHERE id=$1',[assigned.tickets[1].id]);const result=(await q("SELECT public.delivery_directory('1400','pending',1,30) v"))[0].v;assert.equal(result.total,1);assert.equal(result.students[0].tickets.length,1);assert.equal((await q("SELECT public.delivery_directory('WITHOUT','all',1,30) v"))[0].v.total,0);assert.equal((await q("SELECT public.delivery_directory('SEARCH','all',1,30) v"))[0].v.total,1);
  });
  await run('Authenticated delivery users can deliver and read cash but cannot edit the immutable opening balance or use obsolete writers',async()=>{
   await db.exec('SET ROLE authenticated');await login(other);const person=await save('ACCOUNT');await deliver((await assign(person,[1500],'cash')).tickets);await stats();await reject(()=>q('DELETE FROM public.legacy_ticket_payments'),'42501');await reject(()=>q('SELECT public.ticket_cash_events()'),'42501');await reject(()=>q('SELECT public.create_ticket(9999,NULL,true)'),'42501');await db.exec('RESET ROLE;SET ROLE anon');await reject(()=>stats(),'42501');
  });
  await run('Released and archived tickets cannot be delivered even with a valid old snapshot',async()=>{
   const person=await save('INACTIVE');const tickets=(await assign(person,[1600,1601])).tickets;
   await q('SELECT public.delete_faculty_ticket($1,$2,$3)',[tickets[0].id,person.id,tickets[0].assignment_updated_at]);await reject(()=>deliver([tickets[0]],'cash'));
   await q('UPDATE public.students SET deleted_at=now() WHERE id=$1',[person.id]);await reject(()=>deliver([tickets[1]],'cash'));assert.equal((await fresh(tickets[1])).is_picked_up,false);
  });
  await run('An existing extra ticket is collected through the same ledger and cannot be charged twice',async()=>{
   const ticket=(await q("INSERT INTO public.tickets(ticket_number,is_extra,unit_price) VALUES(1700,true,17.25) RETURNING to_jsonb(tickets) v"))[0].v;const balance=await stats();const result=await deliver([ticket],'yape');assert.equal(result[0].paid_amount,17.25);assert.equal((await stats()).collectedTotal,balance.collectedTotal+17.25);await reject(()=>deliver([ticket],'yape'));
  });
 }finally{await db.close();}
});
