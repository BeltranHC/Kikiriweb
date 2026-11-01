import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const base=await readFile(new URL('../database.sql',import.meta.url),'utf8');
const faculty=await readFile(new URL('../supabase/migrations/20261031_faculty_distribution.sql',import.meta.url),'utf8');
const schema=await readFile(new URL('../supabase/migrations/20261031_promotion_category.sql',import.meta.url),'utf8');
const operation=await readFile(new URL('../supabase/operations/assign_initial_promotion.sql',import.meta.url),'utf8');
const combined=schema.replace(/COMMIT;\s*$/,'')+operation.replace(/BEGIN;/,'');
const setup=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`;
const actor='11111111-1111-4111-8111-111111111111';
const snapshot=async(db,table)=>(await db.query(`SELECT to_jsonb(t) value FROM public.${table} t ORDER BY id`)).rows.map(row=>row.value);
async function database(unknown=35) {
  const db=new PGlite();await db.exec(setup);await db.exec(base);await db.exec(faculty);
  await db.query("INSERT INTO public.students(name) SELECT 'Original student ' || n FROM generate_series(1,$1::integer) n",[unknown]);
  await db.exec("INSERT INTO public.tickets(ticket_number,student_id) SELECT row_number() OVER(ORDER BY id)::integer,id FROM public.students;");
  await db.exec("INSERT INTO public.students(name,code,semester) VALUES('Faculty A','F-01',1),('Faculty B','F-02',6),('Faculty C','F-03',10);");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:'operator@example.test'})]);
  await db.exec("SELECT * FROM public.update_ticket_pickup(ARRAY(SELECT id FROM public.tickets ORDER BY ticket_number LIMIT 2),true,'previo',NULL)");
  return db;
}
test('Promotion update classifies exactly the 35 original students and preserves tickets, payments and movement history',async()=>{
  const db=await database();
  try {
    const students=await snapshot(db,'students');const tickets=await snapshot(db,'tickets');const movements=await snapshot(db,'ticket_movements');
    await db.exec(combined);
    const after=await snapshot(db,'students');assert.equal(after.length,students.length);
    for(const before of students) {
      const current=after.find(s=>s.id===before.id);
      if(before.semester===null) {
        assert.equal(current.semester,11);
        const {semester: ignoredSemester,roster_updated_at: ignoredVersion,...rest}=current;
        const {semester: oldSemester,roster_updated_at: oldVersion,...oldRest}=before;
        assert.deepEqual(rest,oldRest);
      } else assert.deepEqual(current,before);
    }
    assert.deepEqual(await snapshot(db,'tickets'),tickets);assert.deepEqual(await snapshot(db,'ticket_movements'),movements);
    const directory=(await db.query('SELECT public.faculty_directory(\'\',11,1,100) value')).rows[0].value;
    assert.equal(directory.total,35);assert(directory.students.every(s=>s.semester===11));
    const person=directory.students[0];
    await db.query('SELECT public.save_faculty_student($1,$2,11,NULL,$3,$4)',[person.name,'P-01',person.id,person.roster_updated_at]);
    assert.equal((await db.query('SELECT semester FROM public.students WHERE id=$1',[person.id])).rows[0].semester,11);
  } finally {await db.close();}
});
test('Reapplying promotion does not classify new students with an unknown semester',async()=>{
  const db=await database();
  try {
    await db.exec(combined);
    const original=await snapshot(db,'students');
    await db.exec("INSERT INTO public.students(name,code) VALUES('New unknown student','NEW-01')");
    await db.exec(combined);
    assert.equal((await db.query("SELECT semester FROM public.students WHERE code='NEW-01'")).rows[0].semester,null);
    for(const person of original) assert.deepEqual((await snapshot(db,'students')).find(s=>s.id===person.id),person);
  } finally {await db.close();}
});
test('An unexpected group size cancels the promotion update and schema change together',async()=>{
  const db=await database(36);
  try {
    const before=await snapshot(db,'students');
    await assert.rejects(db.exec(combined),error=>error.code==='P0001');await db.exec('ROLLBACK');
    assert.deepEqual(await snapshot(db,'students'),before);
    await assert.rejects(db.query('UPDATE public.students SET semester=11 WHERE code=\'F-01\''),error=>error.code==='23514');
  } finally {await db.close();}
});
