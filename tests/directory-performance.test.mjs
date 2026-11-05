import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const files=['database.sql','20261031_faculty_distribution.sql','20261031_promotion_category.sql','20261031_distribution_only_history.sql','20261103_recipient_ticket_changes.sql','20261104_directory_performance.sql','20261104_semester_progress.sql'];
const migrations=await Promise.all(files.map(file=>readFile(new URL('../'+(file==='database.sql'?'':'supabase/migrations/')+file,import.meta.url),'utf8')));

test('Optimized directory preserves data, combines filters before pagination and counts current ownership once',async t=>{
  const db=new PGlite();const q=async(sql,params=[])=>(await db.query(sql,params)).rows;
  const list=async({query='',semester=null,type=null,status='all',page=1,size=30}={})=>(await q('SELECT public.faculty_directory_v2($1,$2,$3,$4,$5,$6) v',[query,semester,type,status,page,size]))[0].v;
  const reject=async(fn,code)=>{await db.exec('SAVEPOINT expected');try{await assert.rejects(fn(),error=>error.code===code);}finally{await db.exec('ROLLBACK TO SAVEPOINT expected;RELEASE SAVEPOINT expected');}};
  const run=(name,fn)=>t.test(name,async()=>{await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK;RESET ROLE');}});
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated;`);
    for(const migration of migrations.slice(0,-1))await db.exec(migration);
    await q("SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)");
    await q(`INSERT INTO public.students(name,code,semester,recipient_type) VALUES
      ('PROMOCION ORIGINAL','PROMO',11,'student'),('P\u00c9REZ JOS\u00c9','00123',2,'student'),
      ('ANA SIN TICKETS','ANA',2,'student'),('VISITANTE',NULL,NULL,'external'),
      ('DOCENTE',NULL,NULL,'teacher'),('SIN SEMESTRE','PENDING',NULL,'student')`);
    await q("INSERT INTO public.tickets(ticket_number,student_id,is_paid) SELECT n,s.id,true FROM generate_series(1,350)n CROSS JOIN public.students s WHERE s.code='PROMO'");
    await q("INSERT INTO public.tickets(ticket_number,student_id) SELECT n,s.id FROM generate_series(1000,1001)n CROSS JOIN public.students s WHERE s.code='00123'");
    await q("INSERT INTO public.tickets(ticket_number,student_id) SELECT 1002,id FROM public.students WHERE recipient_type='teacher'");
    await q("INSERT INTO public.tickets(ticket_number,is_available,is_extra) VALUES(1200,true,false),(1201,false,true)");
    await q("INSERT INTO public.ticket_movements(kind,ticket_ids,ticket_snapshots) SELECT 'undo',ARRAY[id],'[]' FROM public.tickets WHERE ticket_number=1000");
    const snapshot=async()=>Promise.all(['students','tickets','ticket_movements','ticket_assignments','faculty_changes'].map(table=>q(`SELECT to_jsonb(t) v FROM public.${table} t ORDER BY id`)));
    const before=await snapshot();await db.exec(migrations.at(-1));await db.exec(migrations.at(-1));assert.deepEqual(await snapshot(),before);
    const summary={totalStudents:6,withTickets:3,withoutTickets:3,totalAssignedTickets:353};
    await run('Global totals include all 350 legacy Promotion tickets and ignore released or extra tickets without owners',async()=>{
      const all=await list();assert.deepEqual(all.summary,summary);assert.equal(all.total,6);
      const legacy=all.students.find(s=>s.code==='PROMO');assert.equal(legacy.tickets.length,350);assert.equal(legacy.tickets[0].can_edit,false);
      const owner=all.students.find(s=>s.code==='00123');assert.equal(owner.tickets[0].can_edit,false);assert.equal(owner.tickets[1].can_edit,true);
      assert.equal('search_name' in owner,false);assert.equal('ticket_count' in owner,false);
    });
    await run('With/without filters combine with semester, category and accent-insensitive name/code tokens before paging',async()=>{
      const none=await list({status:'without'});assert.equal(none.total,3);assert(none.students.every(s=>s.tickets.length===0));assert.deepEqual(none.summary,summary);
      const academic=await list({status:'without',semester:2,query:'ana'});assert.equal(academic.total,1);assert.equal(academic.students[0].code,'ANA');
      assert.equal((await list({status:'without',type:'external'})).students[0].name,'VISITANTE');
      const assigned=await list({status:'with',query:'jose 00123 perez'});assert.equal(assigned.total,1);assert.equal(assigned.students[0].tickets.length,2);
      assert.equal((await list({status:'without',semester:0})).students[0].code,'PENDING');
      assert.equal((await list({status:'without',type:'teacher'})).total,0);
      assert.equal((await list({status:'with',semester:11})).students[0].code,'PROMO');
      const first=await list({status:'without',size:1}),second=await list({status:'without',size:1,page:2});assert(first.hasMore);assert.notEqual(first.students[0].id,second.students[0].id);
      const empty=await list({status:'without',page:100});assert.equal(empty.students.length,0);assert.equal(empty.total,3);assert.deepEqual(empty.summary,summary);
    });
    await run('Moving and releasing tickets update ownership totals rather than counting assignment-history events',async()=>{
      await q("UPDATE public.tickets SET student_id=(SELECT id FROM public.students WHERE code='ANA') WHERE ticket_number=1001");
      assert.deepEqual((await list()).summary,{...summary,withTickets:4,withoutTickets:2});
      await q('UPDATE public.tickets SET student_id=NULL,is_available=true WHERE ticket_number=1001');
      assert.deepEqual((await list()).summary,{...summary,totalAssignedTickets:352});assert.equal((await list({query:'ANA',status:'without'})).total,1);
    });
    await run('Pagination and totals remain complete over one thousand matching participants',async()=>{
      await q("INSERT INTO public.students(name,recipient_type) SELECT 'BULK '||lpad(n::text,5,'0'),'external' FROM generate_series(1,1005)n");
      const first=await list({query:'BULK',status:'without',size:100}),last=await list({query:'BULK',status:'without',size:100,page:11});assert.equal(first.total,1005);assert.equal(first.students.length,100);assert.equal(last.students.length,5);assert.equal(last.hasMore,false);
      assert.equal(last.summary.totalStudents,1011);assert.equal(last.summary.totalAssignedTickets,353);
    });
    await run('Coverage counts each person once within their full semester and category, independently of search, status and pagination',async()=>{
      const all=await list();const second=all.semesters.find(s=>s.semester===2);
      assert.deepEqual(second,{semester:2,count:2,withTickets:1,withoutTickets:1});
      const promotion=all.semesters.find(s=>s.semester===11);assert.deepEqual(promotion,{semester:11,count:1,withTickets:1,withoutTickets:0});
      assert.equal(all.categories.find(c=>c.type==='external').withTickets,0);assert.equal(all.categories.find(c=>c.type==='teacher').withTickets,1);
      for(const filter of [{query:'ANA',status:'without',size:1},{query:'missing'},{semester:11,type:'student'},{type:'teacher',status:'with',page:20}]) {
        const filtered=await list(filter);assert.deepEqual(filtered.semesters,all.semesters);assert.deepEqual(filtered.categories,all.categories);
      }
      assert.equal(all.semesters.reduce((sum,s)=>sum+s.withTickets,0),2);
      assert.equal(all.categories.reduce((sum,c)=>sum+c.withTickets,0),all.summary.withTickets);
      await q("UPDATE public.tickets SET student_id=(SELECT id FROM public.students WHERE code='ANA') WHERE ticket_number=1001");
      assert.deepEqual((await list()).semesters.find(s=>s.semester===2),{semester:2,count:2,withTickets:2,withoutTickets:0});
      await q('UPDATE public.tickets SET student_id=NULL,is_available=true WHERE ticket_number=1001');
      assert.deepEqual((await list()).semesters.find(s=>s.semester===2),second);
      await q("UPDATE public.students SET semester=3 WHERE code='ANA'");
      const changed=await list();assert.deepEqual(changed.semesters.find(s=>s.semester===2),{semester:2,count:1,withTickets:1,withoutTickets:0});assert.deepEqual(changed.semesters.find(s=>s.semester===3),{semester:3,count:1,withTickets:0,withoutTickets:1});
    });
    await run('Authentication and filter validation are enforced inside the SECURITY DEFINER query',async()=>{
      await db.exec('SET ROLE authenticated');assert.equal((await list()).total,6);await reject(()=>list({status:'invalid'}),'22023');await reject(()=>list({size:101}),'22023');await reject(()=>list({type:'admin'}),'22023');
      await db.exec('RESET ROLE;SET ROLE anon');await reject(()=>list(),'42501');await db.exec('RESET ROLE');
      await q("SELECT set_config('request.jwt.claims','{\"is_anonymous\":true}',true)");await reject(()=>list(),'42501');
    });
  } finally {await db.close();}
});
