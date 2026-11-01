import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { identityTokens, promotionDuplicateCases, buildDuplicateReviewSQL, buildDuplicateCleanupSQL } from '../lib/promotion-dedup.mjs';

const base=await readFile(new URL('../database.sql',import.meta.url),'utf8');
const faculty=await readFile(new URL('../supabase/migrations/20261031_faculty_distribution.sql',import.meta.url),'utf8');
const promotion=await readFile(new URL('../supabase/migrations/20261031_promotion_category.sql',import.meta.url),'utf8');
const template=await readFile(new URL('../supabase/operations/merge_promotion_duplicates.sql',import.meta.url),'utf8');
const setup=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`;
const actor='11111111-1111-4111-8111-111111111111';
const source=[{name:'Pérez José Luis',code:'FAC-01',semester:9,school:'FINESI'}];
const cases=promotionDuplicateCases([{name:'José Luis Pérez'}],source);
const cleanup=buildDuplicateCleanupSQL(cases,template);
const snap=async(db,table)=>(await db.query(`SELECT to_jsonb(t) value FROM public.${table} t ORDER BY id`)).rows.map(row=>row.value);
async function fixture() {
  const db=new PGlite();await db.exec(setup);await db.exec(base);await db.exec(faculty);await db.exec(promotion);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:'test@example.test'})]);
  const keep=(await db.query("INSERT INTO public.students(name,semester,school) VALUES('José Luis Pérez',11,'') RETURNING *")).rows[0];
  await db.exec("INSERT INTO public.students(name,semester) SELECT 'Other promotion '||n,11 FROM generate_series(1,34)n");
  const duplicate=(await db.query("SELECT public.save_faculty_student('Pérez José Luis','FAC-01',9,'FINESI',NULL,NULL) value")).rows[0].value;
  await db.query("UPDATE public.students SET dni='12345678' WHERE id=$1",[duplicate.id]);
  const unrelated=(await db.query("SELECT public.save_faculty_student('Torres Lucía María','FAC-02',10,'FINESI',NULL,NULL) value")).rows[0].value;
  return {db,keep,duplicate,unrelated};
}

test('Name identity compares complete words, accents, punctuation and reordered surnames while preserving ñ and repeated words',()=>{
  assert.deepEqual(identityTokens('PÉREZ, José Luis'),identityTokens('José   Luis Pérez'));
  assert.notDeepEqual(identityTokens('Ana Peña Torres'),identityTokens('Ana Pena Torres'));
  assert.notDeepEqual(identityTokens('Ana Ana Torres'),identityTokens('Ana Torres'));
  assert.notDeepEqual(identityTokens('José Pérez'),identityTokens('José Luis Pérez'));
  assert.equal(promotionDuplicateCases([{name:'José Pérez'}],source)[0].local_status,'sin_coincidencia');
  assert.equal(promotionDuplicateCases([{name:'José Luis Pérez'}],[...source,{...source[0],code:'OTHER'}])[0].local_status,'revisar');
  assert.equal(promotionDuplicateCases([{name:'José Luis Pérez'},{name:'Pérez José Luis'}],source)[0].local_status,'revisar');
});

test('Review only reads current records and revalidates expected names and codes',async()=>{
  const {db,keep,duplicate}=await fixture();
  try {
    const before=await snap(db,'students');const rows=(await db.query(buildDuplicateReviewSQL(cases))).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].accion,'unificar');assert.equal(rows[0].promotion_id,keep.id);assert.equal(rows[0].duplicate_id,duplicate.id);
    assert.deepEqual(await snap(db,'students'),before);
    const malicious=promotionDuplicateCases([{name:"Name $promotion_input_0$ '; DROP TABLE public.students; -- Lastname"}],[]);
    await db.query(buildDuplicateReviewSQL(malicious));assert.deepEqual(await snap(db,'students'),before);
  } finally {await db.close();}
});

test('Merging keeps the promotion ID, transfers its code and relationships, preserves history and prevents reimported duplicates',async()=>{
  const {db,keep,duplicate,unrelated}=await fixture();
  try {
    await db.query('SELECT public.assign_student_tickets($1,ARRAY[1,2])',[keep.id]);
    const assigned=(await db.query('SELECT public.assign_student_tickets($1,ARRAY[10,11]) value',[duplicate.id])).rows[0].value;
    await db.query("SELECT * FROM public.update_ticket_pickup($1,true,'en_momento_yape',NULL)",[[assigned.tickets[0].id]]);
    const before=await snap(db,'students');const tickets=await snap(db,'tickets');const assignments=await snap(db,'ticket_assignments');const history=await snap(db,'ticket_movements');
    await db.exec(cleanup);
    const after=await snap(db,'students');assert.equal(after.length,before.length-1);
    assert(!after.some(s=>s.id===duplicate.id));const survivor=after.find(s=>s.id===keep.id);
    assert.equal(survivor.name,keep.name);assert.equal(survivor.semester,11);assert.equal(survivor.code,'FAC-01');assert.equal(survivor.dni,'12345678');assert.equal(survivor.school,'FINESI');
    assert.deepEqual(after.find(s=>s.id===unrelated.id),before.find(s=>s.id===unrelated.id));
    assert.deepEqual(await snap(db,'tickets'),tickets.map(t=>({...t,student_id:t.student_id===duplicate.id?keep.id:t.student_id})));
    assert.deepEqual(await snap(db,'ticket_assignments'),assignments.map(a=>({...a,student_id:a.student_id===duplicate.id?keep.id:a.student_id})));
    assert.deepEqual(await snap(db,'ticket_movements'),history);
    const backup=(await snap(db,'student_deduplication_log'))[0];
    assert.deepEqual(backup.removed_before,before.find(s=>s.id===duplicate.id));assert.deepEqual(backup.kept_before,before.find(s=>s.id===keep.id));
    assert.deepEqual(backup.tickets_before,tickets.filter(t=>t.student_id===duplicate.id));
    await db.exec(cleanup);assert.deepEqual(await snap(db,'students'),after);assert.equal((await snap(db,'student_deduplication_log')).length,1);
    const imported=(await db.query('SELECT public.import_faculty_roster($1) value',[JSON.stringify(source)])).rows[0].value;
    assert.equal(imported.studentsCreated,0);assert.equal(imported.studentsExisting,1);assert.equal((await snap(db,'students')).length,after.length);
    await db.exec('SET ROLE authenticated');await assert.rejects(db.query('SELECT * FROM public.student_deduplication_log'),error=>error.code==='42501');await db.exec('RESET ROLE');
  } finally {await db.close();}
});

test('Duplicate names, conflicting IDs and unexpected codes are left for review without deleting records',async()=>{
  const {db,keep,duplicate}=await fixture();
  try {
    for(const update of [
      `INSERT INTO public.students(name,code,semester) VALUES('Luis José Pérez','FAC-03',10)`,
      `UPDATE public.students SET code='DIFFERENT' WHERE id='${keep.id}'`,
      `UPDATE public.students SET dni='87654321' WHERE id='${keep.id}'`,
      `UPDATE public.students SET code='CHANGED' WHERE id='${duplicate.id}'`,
    ]) {
      await db.exec('BEGIN');await db.exec(update);
      const review=(await db.query(buildDuplicateReviewSQL(cases))).rows;assert(review.every(row=>row.accion==='revisar'));
      await db.exec('ROLLBACK');
    }
    // Exercise an actual guarded cleanup, not only its review projection.
    await db.query("UPDATE public.students SET code='DIFFERENT' WHERE id=$1",[keep.id]);
    const before=await snap(db,'students');await db.exec(cleanup);
    assert.deepEqual(await snap(db,'students'),before);assert.equal((await snap(db,'student_deduplication_log')).length,0);
  } finally {await db.close();}
});

test('A hidden change to a ticket causes the whole merge, deletion and backup creation to roll back',async()=>{
  const {db,duplicate}=await fixture();
  try {
    await db.query('SELECT public.assign_student_tickets($1,ARRAY[10,11])',[duplicate.id]);
    await db.exec(`CREATE FUNCTION public.bad_merge_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.is_paid:=true;RETURN NEW;END$$;
      CREATE TRIGGER bad_merge BEFORE UPDATE OF student_id ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.bad_merge_trigger();`);
    const students=await snap(db,'students');const tickets=await snap(db,'tickets');
    await assert.rejects(db.exec(cleanup),error=>error.code==='P0001');await db.exec('ROLLBACK');
    assert.deepEqual(await snap(db,'students'),students);assert.deepEqual(await snap(db,'tickets'),tickets);
    assert.equal((await db.query("SELECT to_regclass('public.student_deduplication_log') value")).rows[0].value,null);
  } finally {await db.close();}
});

test('Unrecognized student relationships stop cleanup instead of cascading into unrelated data',async()=>{
  const {db,duplicate}=await fixture();
  try {
    await db.exec('CREATE TABLE public.external_records(student_id uuid REFERENCES public.students(id) ON DELETE CASCADE)');
    await db.query('INSERT INTO public.external_records VALUES($1)',[duplicate.id]);
    const before=await snap(db,'students');await assert.rejects(db.exec(cleanup),error=>error.code==='P0001');await db.exec('ROLLBACK');
    assert.deepEqual(await snap(db,'students'),before);assert.equal((await db.query('SELECT count(*) n FROM public.external_records')).rows[0].n,1);
  } finally {await db.close();}
});

test('Only a database administrator can execute the destructive cleanup',async()=>{
  const {db}=await fixture();
  try {
    const before=await snap(db,'students');await db.exec('SET ROLE authenticated');
    await assert.rejects(db.exec(cleanup),error=>error.code==='42501');await db.exec('ROLLBACK;RESET ROLE');
    assert.deepEqual(await snap(db,'students'),before);
  } finally {await db.close();}
});
