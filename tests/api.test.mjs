import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as validation from '../lib/validation.mjs';
import * as domain from '../lib/domain.mjs';
import * as csv from '../lib/csv.mjs';
import { fetchAll } from '../lib/pagination.mjs';
import { cashReport } from '../lib/report.mjs';
import * as faculty from '../lib/faculty.mjs';
import * as facultyExport from '../lib/faculty-export.mjs';
import * as assignmentHistory from '../lib/assignment-history.mjs';
import { requireDeliveryEnabled } from '../lib/module-mode.mjs';

const NextResponse = { json: (value, options) => Response.json(value, options) };
async function compile(path, dependencies, exports) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(dependencies), source + '\nreturn {' + exports.join(',') + '};')(...Object.values(dependencies));
}
async function handlers(route, client, { deliveryEnabled = true } = {}) {
  const api = await compile('../lib/api.js', { NextResponse, createClient: () => client, ValidationError: validation.ValidationError }, ['requireSession', 'apiError', 'HttpError']);
  const methods = { students: ['GET', 'POST', 'DELETE'], tickets: ['GET', 'POST', 'PATCH'], stats: ['GET'], export: ['GET'], import: ['POST'], movements: ['GET'], faculty: ['GET','POST','PATCH'], 'faculty/import': ['POST'], 'faculty/assignments': ['GET','POST'], 'faculty/tickets': ['PATCH'], 'faculty/changes': ['GET'], 'faculty/export': ['GET'] }[route];
  return compile(`../app/api/${route}/route.js`, { NextResponse, ...api, ...validation, ...domain, ...csv, ...faculty, ...facultyExport, ...assignmentHistory, requireDeliveryEnabled: deliveryEnabled ? () => {} : requireDeliveryEnabled, fetchAll, cashReport }, methods);
}
for (const [route, methods] of Object.entries({ students: ['GET', 'POST', 'DELETE'], tickets: ['GET', 'POST', 'PATCH'], stats: ['GET'], export: ['GET'], import: ['POST'], movements: ['GET'], faculty: ['GET','POST','PATCH'], 'faculty/import': ['POST'], 'faculty/assignments': ['GET','POST'], 'faculty/tickets': ['PATCH'], 'faculty/changes': ['GET'], 'faculty/export': ['GET'] })) {
  for (const method of methods) test(`${method} /api/${route} refuses unauthenticated access before reading data`, async () => {
    const client = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, from: () => assert.fail('Database must not be accessed') };
    const response = await (await handlers(route, client))[method]({ json: () => assert.fail('Body must not be read'), formData: () => assert.fail('File must not be read') });
    assert.equal(response.status, 401);
  });
}
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'demo@example.test' };
const authenticated = rpc => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, rpc });
test('Anonymous Supabase accounts are not accepted as operators', async () => {
  const client = { auth: { getUser: async () => ({ data: { user: { ...user, is_anonymous: true } }, error: null }) } };
  assert.equal((await (await handlers('stats', client)).GET()).status, 403);
});
test('Student creation propagates transactional ticket conflicts', async () => {
  const client = authenticated(async () => ({ data: null, error: { code: '23505', message: 'duplicate ticket' } }));
  const response = await (await handlers('students', client)).POST({ json: async () => ({ name: 'Demo', ticketStart: 1, ticketEnd: 2 }) });
  assert.equal(response.status, 409);
});
test('Import validates the entire file before issuing a single transaction', async () => {
  const calls = [];
  const client = authenticated(async (name, args) => { calls.push({ name, args }); return { data: { studentsCreated: 1, ticketsCreated: 2 }, error: null }; });
  const request = text => ({ headers: new Headers(), formData: async () => new Map([['file', { name: 'TEST.CSV', size: text.length, text: async () => text }]]) });
  const route = await handlers('import', client);
  assert.equal((await route.POST(request('nombre,tickets\nDemo,"1;1"'))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await route.POST(request('nombre,tickets\nDemo,"1;2"'))).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'import_students');
});
test('Undo forwards the expected movement to prevent stale cancellations', async () => {
  let params;
  const client = authenticated(async (name, args) => { params = args; return { data: [], error: null }; });
  const response = await (await handlers('tickets', client)).PATCH({ json: async () => ({ ticketIds: [user.id], isPickedUp: false, expectedMovementId: user.id }) });
  assert.equal(response.status, 200);
  assert.equal(params.p_expected_movement_id, user.id);
});


test('Ticket search pagination pins its owner once and keeps counts and subsequent pages correct', async () => {
  const owner = { id: user.id, name: 'Pinned owner' };
  const matches = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const client = { ...authenticated(), from(table) {
    const query = { select(fields, options) { this.head = options?.head; return this; }, order() { return this; },
      eq(field) { if (field === 'id') this.owner = true; return this; }, or() { return this; }, neq() { return this; },
      maybeSingle() { this.single = true; return this; }, range(start, end) { this.start = start; this.end = end; return this; },
      then(resolve, reject) {
        const result = table === 'tickets' ? { data: { student_id: owner.id } } : this.owner ? { data: owner } :
          { data: this.head ? null : matches.slice(this.start, this.end + 1), count: matches.length };
        return Promise.resolve({ ...result, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const route = await handlers('students', client);
  const first = await (await route.GET({ url: 'http://localhost/api/students?q=1&pageSize=2&page=1' })).json();
  const second = await (await route.GET({ url: 'http://localhost/api/students?q=1&pageSize=2&page=2' })).json();
  const single = await (await route.GET({ url: 'http://localhost/api/students?q=1&pageSize=1&page=1' })).json();
  assert.deepEqual(first.students.map(student => student.id), [owner.id, 'a']);
  assert.deepEqual(second.students.map(student => student.id), ['b', 'c']);
  assert.equal(first.total, 4); assert.equal(first.hasMore, true); assert.equal(second.hasMore, false);
  assert.deepEqual(single.students.map(student => student.id), [owner.id]);
});

test('GET /api/students?status=pending queries pending tickets and filters by student IDs', async () => {
  const pendingId = '33333333-3333-4333-8333-333333333333';
  const pendingStudent = { id: pendingId, name: 'Estudiante Pendiente' };
  const client = { ...authenticated(), from(table) {
    const query = {
      select() { return this; },
      order() { return this; },
      eq(field, val) { this[field] = val; return this; },
      not() { return this; },
      in(field, values) { this.inField = field; this.inValues = values; return this; },
      range() { return this; },
      neq() { return this; },
      maybeSingle() { return this; },
      then(resolve, reject) {
        if (table === 'tickets') return Promise.resolve({ data: [{ student_id: pendingId }], error: null }).then(resolve, reject);
        return Promise.resolve({ data: [pendingStudent], count: 1, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const route = await handlers('students', client);
  const response = await (await route.GET({ url: 'http://localhost/api/students?status=pending' })).json();
  assert.equal(response.total, 1);
  assert.deepEqual(response.students, [pendingStudent]);
});

test('Ticket creation rejects JSON null with a validation response', async () => {
  const route = await handlers('tickets', authenticated(() => assert.fail('No writes expected')));
  assert.equal((await route.POST({ json: async () => null })).status, 400);
});

test('GET /api/tickets?number= looks up a single ticket and its student', async () => {
  const targetTicket = { id: user.id, ticket_number: 42, student_id: '22222222-2222-4222-8222-222222222222', is_picked_up: false };
  const targetStudent = { id: targetTicket.student_id, name: 'Estudiante Test', tickets: [targetTicket] };
  const client = {
    ...authenticated(),
    from(table) {
      return {
        select() { return this; },
        eq(field, val) {
          this.field = field;
          this.val = val;
          return this;
        },
        maybeSingle: async () => {
          if (table === 'tickets') return { data: targetTicket, error: null };
          if (table === 'students') return { data: targetStudent, error: null };
          return { data: null, error: null };
        },
      };
    },
  };
  const route = await handlers('tickets', client);
  const res = await route.GET({ url: 'http://localhost/api/tickets?number=42' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ticket_number, 42);
  assert.equal(data.student.name, 'Estudiante Test');
});


test('Faculty API validates directory filters before calling PostgreSQL', async () => {
  const calls=[];
  const client=authenticated(async (name,args) => { calls.push({name,args}); return {data:{students:[],total:0},error:null}; });
  const route=await handlers('faculty',client);
  assert.equal((await route.GET({url:'http://localhost/api/faculty?semester=12'})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await route.GET({url:'http://localhost/api/faculty?q=Jose&semester=2&page=3'})).status,200);
  assert.equal(calls[0].name,'faculty_recipient_directory'); assert.equal(calls[0].args.p_semester,2); assert.equal(calls[0].args.p_page,3);
  assert.equal((await route.GET({url:'http://localhost/api/faculty?semester=11'})).status,200);
  assert.equal(calls[1].args.p_semester,11);
});
test('Faculty edits require a version and propagate code conflicts',async () => {
  const calls=[];
  const client=authenticated(async (name,args) => {calls.push({name,args});return {data:null,error:{code:'23505',message:'students_code_unique_idx'}};});
  const route=await handlers('faculty',client);
  assert.equal((await route.PATCH({json:async () => ({id:user.id,name:'Demo',code:'00123'})})).status,400);
  assert.equal(calls.length,0);
  const response=await route.POST({json:async () => ({name:'Demo',code:'00123',semester:'VI'})});
  assert.equal(response.status,409); assert.match((await response.json()).error,/código/);
  assert.equal(calls[0].args.p_semester,6);
});
test('Faculty import sends the entire validated roster once and never sends ticket data', async () => {
  const calls=[];
  const client=authenticated(async (name,args) => { calls.push({name,args}); return {data:{studentsCreated:1,studentsExisting:0},error:null}; });
  const request=text=>({headers:new Headers(),formData:async()=>new Map([['file',{name:'roster.csv',size:Buffer.byteLength(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer}]])});
  const route=await handlers('faculty/import',client);
  assert.equal((await route.POST(request('codigo,nombre,semestre\n00123,Demo,II\n00123,Repeated,II'))).status,400);
  assert.equal(calls.length,0);
  assert.equal((await route.POST(request('codigo,nombre,semestre\n00123,Demo,II'))).status,200);
  assert.equal(calls.length,1); assert.equal(calls[0].name,'import_faculty_roster'); assert.equal(calls[0].args.p_rows[0].code,'00123');
  assert.equal('tickets' in calls[0].args.p_rows[0],false);
});
test('Assignment API rejects duplicate numbers and forwards a single atomic batch', async () => {
  const calls=[];
  const client=authenticated(async(name,args)=>{ calls.push({name,args});return {data:{ticketsCreated:2},error:null};});
  const route=await handlers('faculty/assignments',client);
  assert.equal((await route.POST({json:async()=>({studentId:user.id,ticketNumbers:[1050,1050]})})).status,400);
  assert.equal(calls.length,0);
  assert.equal((await route.POST({json:async()=>({studentId:user.id,ticketNumbers:[1051,1050]})})).status,201);
  assert.equal(calls.length,1);assert.equal(calls[0].name,'assign_student_tickets');assert.deepEqual(calls[0].args.p_ticket_numbers,[1050,1051]);
});


for(const [route,methods] of Object.entries({students:['GET','POST','DELETE'],tickets:['GET','POST','PATCH'],movements:['GET'],import:['POST'],stats:['GET'],export:['GET']})) {
  for(const method of methods) test(`${method} /api/${route} is locked during the distribution-only phase before any data access`,async()=>{
    const client={...authenticated(()=>assert.fail('Locked modules must not call RPCs')),from:()=>assert.fail('Locked modules must not query tables')};
    const response=await (await handlers(route,client,{deliveryEnabled:false}))[method]({json:()=>assert.fail('No body reads'),formData:()=>assert.fail('No file reads')});
    assert.equal(response.status,423);assert.equal((await response.json()).error,'Temporalmente inhabilitado');
  });
}
test('Assignment history remains available in distribution-only mode and forwards Lima date boundaries',async()=>{
  const calls=[];const client=authenticated(async(name,args)=>{calls.push({name,args});return {data:{assignments:[],total:0},error:null};});
  const route=await handlers('faculty/assignments',client,{deliveryEnabled:false});
  const response=await route.GET({url:'http://localhost/api/faculty/assignments?q=00123&from=2026-10-31&to=2026-10-31&semester=11&page=2'});
  assert.equal(response.status,200);assert.equal(calls[0].name,'faculty_assignment_history');
  assert.equal(calls[0].args.p_from,'2026-10-31T05:00:00.000Z');assert.equal(calls[0].args.p_until,'2026-11-01T05:00:00.000Z');assert.equal(calls[0].args.p_semester,11);
  assert.equal((await route.GET({url:'http://localhost/api/faculty/assignments?from=2026-11-02&to=2026-10-31'})).status,400);
  assert.equal(calls.length,1);
});


test('Ticket changes validate actions and pass only trusted IDs and concurrency tokens, never a claimed audit actor',async()=>{
  const calls=[];const route=await handlers('faculty/tickets',authenticated(async(name,args)=>{calls.push({name,args});return {data:{ticket:{id:user.id}},error:null};}));
  assert.equal((await route.PATCH({json:async()=>({action:'release',ticketId:user.id,studentId:user.id})})).status,400);
  const payload={action:'update',ticketId:user.id,studentId:user.id,ticketNumber:1234,expectedUpdatedAt:'2026-11-03T10:00:00Z',actorId:'forged'};
  assert.equal((await route.PATCH({json:async()=>payload})).status,200);assert.equal(calls[0].name,'edit_faculty_ticket');assert.equal(calls[0].args.p_ticket_number,1234);assert.equal('actorId' in calls[0].args,false);
});


test('The complete participant CSV is available in distribution mode, ignores screen filters and is never publicly cached',async()=>{
  const people=[{id:user.id,name:'Exported Student',code:'00123',semester:2},{id:'22222222-2222-4222-8222-222222222222',name:'Teacher Without Tickets',recipient_type:'teacher'}];
  const client={...authenticated(),from(table){return {select(){return this;},not(){return this;},eq(){return this;},order(){return this;},async range(start,end){return {data:(table==='students'?people:[{id:'ticket',student_id:user.id,ticket_number:1050}]).slice(start,end+1),error:null};}};}};
  const response=await (await handlers('faculty/export',client,{deliveryEnabled:false})).GET({url:'http://localhost/api/faculty/export?q=absent&semester=10'});
  assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/csv/);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.match(response.headers.get('Content-Disposition'),/attachment; filename="participantes_tickets_\d{4}-\d{2}-\d{2}\.csv"/);
  const rows=csv.parseCSV(await response.text());assert.equal(rows.length,2);assert.equal(rows[0].codigo,'00123');assert.equal(rows[0].tickets_asignados,'1050');assert.equal(rows[1].cantidad_tickets,'0');
});
