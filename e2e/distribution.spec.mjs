import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { participantReport } from '../lib/faculty-export.mjs';
import { parseCSV } from '../lib/csv.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fold = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
async function fixture(page) {
  const state = { calls: [], students: [
    { id:uuid(1),name:'PÉREZ JOSÉ',code:'00123',semester:2,school:'FINESI',roster_updated_at:'2026-10-31T12:00:00Z',tickets:[{id:uuid(91),ticket_number:1000,assignment_id:uuid(501),student_id:uuid(1),assignment_updated_at:'2026-11-03T10:00:00Z',can_edit:true}] },
    { id:uuid(2),name:'ALVAREZ ANA',code:'100002',semester:6,school:'FINESI',roster_updated_at:'2026-10-31T12:00:00Z',tickets:[] },
    { id:uuid(3),name:'TORRES LUIS',code:'100003',semester:10,school:'FINESI',roster_updated_at:'2026-10-31T12:00:00Z',tickets:[] },
  ] };
  state.changes=[];state.payments=[];state.deletedStudents=[];state.deletedTickets=[];
  state.assignments=[{id:uuid(501),student_id:uuid(1),student_name:'PÉREZ JOSÉ',student_code:'00123',semester:2,created_at:'2026-10-31T15:30:00Z',actor_id:uuid(999),actor_email:'reparto@example.test',ticket_numbers:[1000],current_student_name:'PÉREZ JOSÉ'}];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      if(url.pathname.endsWith('/auth/v1/token')&&url.searchParams.get('grant_type')==='password') {
        const now=Math.floor(Date.now()/1000);
        const token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uuid(999),email:'reparto@example.test',aud:'authenticated',exp:now+3600,iat:now})).toString('base64url'),'fixture-signature'].join('.');
        await route.fulfill({json:{access_token:token,token_type:'bearer',refresh_token:'fixture-refresh-token',expires_in:3600,user:{id:uuid(999),aud:'authenticated',role:'authenticated',email:'reparto@example.test',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()}}});
      } else await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    const method = route.request().method();
    state.calls.push({ path:url.pathname,method,query:url.searchParams.get('q'),page:url.searchParams.get('page'),ticketStatus:url.searchParams.get('ticketStatus') });
    if(url.pathname==='/api/faculty/export') {
      await route.fulfill({headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="participantes_tickets_2026-11-03.csv"'},body:participantReport(state.students,state.students.flatMap(person=>person.tickets.map(ticket=>({...ticket,student_id:person.id}))))});
      return;
    }
    if (url.pathname === '/api/faculty' && method === 'GET') {
      const query=fold(url.searchParams.get('q') || ''); const semester=url.searchParams.get('semester') || 'all'; const type=url.searchParams.get('type')||'all'; const ticketStatus=url.searchParams.get('ticketStatus')||'all';
      const students=state.students.filter(student => query.split(/\s+/).every(token => fold(student.name+' '+student.code).includes(token)) && (semester==='all' || (student.semester ?? 0)===Number(semester)) && (type==='all'||(student.recipient_type||'student')===type) && (ticketStatus==='all'||(ticketStatus==='without'?student.tickets.length===0:student.tickets.length>0)))
        .sort((a,b)=>(a.semester??12)-(b.semester??12) || a.name.localeCompare(b.name));
      await route.fulfill({json:{categories:['student','external','teacher'].map(type=>({type,count:state.students.filter(s=>(s.recipient_type||'student')===type).length,withTickets:state.students.filter(s=>(s.recipient_type||'student')===type&&s.tickets.length>0).length})),students,total:students.length,hasMore:false,page:1,pageSize:30,semesters:[null,1,2,3,4,5,6,7,8,9,10,11].map(semester=>({semester,count:state.students.filter(s=>(s.recipient_type||'student')==='student'&&s.semester===semester).length,withTickets:state.students.filter(s=>(s.recipient_type||'student')==='student'&&s.semester===semester&&s.tickets.length>0).length})),summary:{totalAssignedTickets:state.students.reduce((total,person)=>total+person.tickets.length,0),totalStudents:state.students.length,withTickets:state.students.filter(s=>s.tickets.length).length,withoutTickets:state.students.filter(s=>!s.tickets.length).length}}});
    } else if (url.pathname === '/api/faculty' && method==='DELETE') {
      const body=route.request().postDataJSON();const person=state.students.find(student=>student.id===body.id);
      if(!person||person.roster_updated_at!==body.expectedUpdatedAt||person.tickets.some(ticket=>ticket.is_paid)||body.expectedTickets.length!==person.tickets.length||person.tickets.some(ticket=>!body.expectedTickets.some(expected=>expected.id===ticket.id&&expected.updated_at===ticket.assignment_updated_at))) {await route.fulfill({status:409,json:{error:'Anula los pagos y actualiza las asignaciones antes de eliminar'}});return;}
      const timestamp=new Date().toISOString();const before=JSON.parse(JSON.stringify(person));
      for(const ticket of person.tickets){state.deletedTickets.push({...ticket,student_id:null,deleted_at:timestamp,is_available:!ticket.is_picked_up});state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'ticket',operation:'delete',student_name:person.name,actor_email:'reparto@example.test',created_at:timestamp,before_data:{...ticket,student_name:person.name},after_data:{deleted_at:timestamp}});}
      state.deletedStudents.push({...before,deleted_at:timestamp});state.students=state.students.filter(student=>student.id!==person.id);state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'student',operation:'delete',student_name:person.name,actor_email:'reparto@example.test',created_at:timestamp,before_data:before,after_data:{...before,deleted_at:timestamp}});
      await route.fulfill({json:{studentId:person.id,ticketsRemoved:person.tickets.length}});
    } else if (url.pathname === '/api/faculty' && ['POST','PATCH'].includes(method)) {
      const body=route.request().postDataJSON();
      let student=state.students.find(s=>s.id===body.id);
      if (method==='PATCH' && student.roster_updated_at!==body.expectedUpdatedAt) {await route.fulfill({status:409,json:{error:'Otro encargado modificó este estudiante'}});return;}
      if (method==='POST') {student={id:uuid(10+state.students.length),tickets:[]};state.students.push(student);}
      const before=JSON.parse(JSON.stringify(student));
      Object.assign(student,{recipient_type:body.recipientType||'student',name:body.name,code:body.code,semester:body.semester,school:body.school,roster_updated_at:new Date().toISOString()});
      state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'student',operation:method==='POST'?'create':'update',student_name:student.name,actor_email:'reparto@example.test',created_at:new Date().toISOString(),before_data:method==='POST'?null:before,after_data:JSON.parse(JSON.stringify(student))});
      await route.fulfill({status:method==='POST'?201:200,json:student});
    } else if(url.pathname==='/api/faculty/payments'&&method==='PATCH') {
      const body=route.request().postDataJSON();
      if(Array.isArray(body.tickets)){
        const person=state.students.find(student=>student.id===body.studentId);const selected=body.tickets.map(item=>person?.tickets.find(ticket=>ticket.id===item.id&&ticket.assignment_updated_at===item.updated_at));
        if(state.failBatch||selected.some(ticket=>!ticket)){await route.fulfill({status:409,json:{error:'Las asignaciones o pagos cambiaron. Actualiza los tickets antes de continuar.'}});return;}
        const changing=selected.filter(ticket=>body.condition==='pending'?ticket.is_paid:!ticket.is_paid);
        const total=changing.reduce((sum,ticket)=>sum+(body.condition==='pending'?ticket.paid_amount??ticket.unit_price??15:ticket.unit_price??15),0);
        if(total!==body.expectedTotal){await route.fulfill({status:409,json:{error:'El importe cambio'}});return;}
        const timestamp=new Date().toISOString();
        for(const ticket of changing){const before={...ticket};const paid=body.condition!=='pending';const amount=paid?ticket.unit_price??15:ticket.paid_amount??ticket.unit_price??15;
          Object.assign(ticket,{is_paid:paid,payment_method:paid?(body.condition==='cash'?'en_momento_efectivo':'en_momento_yape')+'|reparto@example.test':null,paid_amount:paid?amount:null,paid_at:paid?timestamp:null,paid_by_email:paid?'reparto@example.test':null,can_manage:true,can_edit:!paid&&!ticket.is_picked_up,assignment_updated_at:timestamp});
          state.payments.push({kind:paid?'payment':'void',amount,method:body.condition,actor_email:'reparto@example.test',ticket_id:ticket.id});state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'ticket',operation:'update',student_name:person.name,actor_email:'reparto@example.test',created_at:timestamp,before_data:{...before,student_name:person.name},after_data:{...ticket,student_name:person.name}});
        }
        await route.fulfill({json:{studentId:person.id,tickets:selected,condition:body.condition,changed:changing.length,unchanged:selected.length-changing.length,total}});return;
      }
      const person=state.students.find(student=>student.id===body.studentId);const ticket=person?.tickets.find(item=>item.id===body.ticketId);
      if(!ticket||ticket.assignment_updated_at!==body.expectedUpdatedAt||(body.action==='pay'?ticket.is_paid:!ticket.is_paid)){await route.fulfill({status:409,json:{error:'El pago cambio. Actualiza el padron'}});return;}
      const before={...ticket,student_name:person.name};const timestamp=new Date().toISOString();const paid=body.action==='pay';
      Object.assign(ticket,{is_paid:paid,payment_method:paid?(body.method==='cash'?'en_momento_efectivo':'en_momento_yape')+'|reparto@example.test':null,paid_amount:paid?15:null,paid_at:paid?timestamp:null,paid_by_email:paid?'reparto@example.test':null,unit_price:15,can_manage:true,can_edit:!paid&&!ticket.is_picked_up,assignment_updated_at:timestamp});
      state.payments.push({kind:paid?'payment':'void',amount:15,method:body.method,actor_email:'reparto@example.test',ticket_id:ticket.id});state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'ticket',operation:'update',student_name:person.name,actor_email:'reparto@example.test',created_at:timestamp,before_data:before,after_data:{...ticket,student_name:person.name}});
      await route.fulfill({json:{ticket,action:body.action,previousStudentId:person.id,amount:15}});
    } else if(url.pathname==='/api/faculty/tickets'&&method==='GET') {
      const assignmentId=url.searchParams.get('assignmentId');
      if(state.failHistoryTickets){await route.fulfill({status:503,json:{error:'No se pudieron cargar los tickets actuales'}});return;}
      const tickets=state.students.flatMap(student=>student.tickets.filter(ticket=>ticket.assignment_id===assignmentId&&!ticket.deleted_at).map(ticket=>({...ticket,can_manage:true,student:{id:student.id,name:student.name,code:student.code}})));
      await route.fulfill({json:{assignmentId,tickets}});
    } else if(url.pathname==='/api/faculty/tickets'&&method==='DELETE') {
      const body=route.request().postDataJSON();const person=state.students.find(student=>student.id===body.studentId);const ticket=person?.tickets.find(item=>item.id===body.ticketId);
      if(!ticket||ticket.is_paid||ticket.assignment_updated_at!==body.expectedUpdatedAt){await route.fulfill({status:409,json:{error:'Anula primero el pago o actualiza el ticket'}});return;}
      const before={...ticket,student_name:person.name};const timestamp=new Date().toISOString();person.tickets=person.tickets.filter(item=>item.id!==ticket.id);Object.assign(ticket,{student_id:null,deleted_at:timestamp,is_available:!ticket.is_picked_up,can_manage:false,can_edit:false,assignment_updated_at:timestamp});state.deletedTickets.push({...ticket});state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'ticket',operation:'delete',student_name:person.name,actor_email:'reparto@example.test',created_at:timestamp,before_data:before,after_data:{...ticket}});
      await route.fulfill({json:{ticket,action:'delete',previousStudentId:person.id}});
    } else if(url.pathname==='/api/faculty/tickets'&&method==='PATCH') {
      const body=route.request().postDataJSON();const student=state.students.find(s=>s.id===body.studentId);const ticket=student?.tickets.find(t=>t.id===body.ticketId);
      if(!ticket||ticket.assignment_updated_at!==body.expectedUpdatedAt) {await route.fulfill({status:409,json:{error:'Otro usuario modificó este ticket'}});return;}
      if(body.action==='update'&&state.students.some(s=>s.tickets.some(t=>t.id!==ticket.id&&t.ticket_number===body.ticketNumber))) {await route.fulfill({status:409,json:{error:'El número ya está registrado'}});return;}
      const before={...ticket,student_name:student.name};
      if(body.action==='update')ticket.ticket_number=body.ticketNumber;
      if(body.action==='release'||body.action==='transfer') {student.tickets=student.tickets.filter(t=>t.id!==ticket.id);ticket.student_id=body.action==='release'?null:body.destinationId;ticket.is_available=body.action==='release';if(body.action==='transfer')state.students.find(s=>s.id===body.destinationId).tickets.push(ticket);}
      ticket.assignment_updated_at=new Date().toISOString();
      const destination=state.students.find(s=>s.id===ticket.student_id);
      state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'ticket',operation:'update',student_name:destination?.name||student.name,actor_email:'reparto@example.test',created_at:new Date().toISOString(),before_data:before,after_data:{...ticket,student_name:destination?.name}});
      await route.fulfill({json:{ticket,action:body.action,previousStudentId:student.id}});
    } else if(url.pathname==='/api/faculty/changes') {
      const query=fold(url.searchParams.get('q')||'');const matches=state.changes.filter(c=>fold(JSON.stringify(c)).includes(query));
      await route.fulfill({json:{changes:matches,total:matches.length,hasMore:false,summary:{}}});
    } else if (url.pathname==='/api/faculty/assignments' && method==='GET') {
      const query=fold(url.searchParams.get('q')||'');const numeric=Number(query.replace(/^#/,''));const semester=url.searchParams.get('semester')||'all';
      const from=url.searchParams.get('from');const to=url.searchParams.get('to');
      const records=state.assignments.filter(item=>(!query||fold(item.student_name+' '+item.student_code+' '+item.actor_email+' '+item.id).includes(query)||item.ticket_numbers.includes(numeric)) &&
        (semester==='all'||(item.semester??0)===Number(semester)) && (!from||Date.parse(item.created_at)>=Date.parse(from+'T05:00:00Z')) && (!to||Date.parse(item.created_at)<Date.parse(to+'T05:00:00Z')+86400000))
        .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
      const number=Number(url.searchParams.get('page')||1);
      await route.fulfill({json:{assignments:records.slice((number-1)*30,number*30),total:records.length,page:number,pageSize:30,hasMore:number*30<records.length,summary:{assignments:state.assignments.length,tickets:state.assignments.reduce((sum,a)=>sum+a.ticket_numbers.length,0),students:new Set(state.assignments.map(a=>a.student_id)).size}}});
    } else if (url.pathname==='/api/faculty/assignments') {
      const body=route.request().postDataJSON();const student=state.students.find(s=>s.id===body.studentId);
      if (body.ticketNumbers.some(n=>state.students.some(s=>s.tickets.some(t=>t.ticket_number===n)))) {await route.fulfill({status:409,json:{error:'Estos tickets ya están registrados. No se asignó ningún ticket del lote.'}});return;}
      const assignmentId=uuid(501+state.assignments.length);const paid=['cash','yape'].includes(body.paymentMethod);const timestamp=new Date().toISOString();
      const tickets=body.ticketNumbers.map(n=>({id:uuid(2000+n),ticket_number:n,student_id:student.id,assignment_id:assignmentId,is_picked_up:false,is_paid:paid,can_edit:!paid,can_manage:true,unit_price:15,paid_amount:paid?15:null,paid_at:paid?timestamp:null,payment_method:paid?(body.paymentMethod==='cash'?'en_momento_efectivo':'en_momento_yape')+'|reparto@example.test':null,assignment_updated_at:timestamp}));
      for(const ticket of tickets)if(paid){state.payments.push({kind:'payment',method:body.paymentMethod,amount:15,actor_email:'reparto@example.test',ticket_id:ticket.id});state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'ticket',operation:'update',student_name:student.name,actor_email:'reparto@example.test',created_at:timestamp,before_data:{is_paid:false},after_data:{...ticket,student_name:student.name}});}
      student.tickets.push(...tickets);
      state.assignments.push({id:assignmentId,student_id:student.id,student_name:student.name,student_code:student.code,semester:student.semester,created_at:new Date().toISOString(),actor_id:uuid(999),actor_email:'reparto@example.test',ticket_numbers:body.ticketNumbers});
      await route.fulfill({status:201,json:{ticketsCreated:tickets.length,tickets,studentId:student.id,paymentMethod:paid?body.paymentMethod:null,paymentTotal:paid?tickets.length*15:0}});
    } else if (url.pathname==='/api/faculty/import') {
      await route.fulfill({json:{studentsCreated:2,studentsExisting:1,total:3}});
    } else await route.fulfill({status:404,json:{error:'Unknown fixture API'}});
  });
  return state;
}
const search = page => page.getByRole('searchbox',{name:'Buscar estudiantes'});
async function closeAssignment(page) { const dialog=page.getByRole('dialog',{name:'Asignar tickets',exact:true});if(await dialog.isVisible())await dialog.getByRole('button',{name:'Cerrar asignaci\u00f3n'}).click(); }
async function choose(page, code='00123') {
  await closeAssignment(page);
  await search(page).fill(code);
  await expect(page.getByRole('status').filter({hasText:'1 estudiantes encontrados'})).toBeVisible();
  await page.getByRole('article').getByRole('button',{name:/^(Asignar tickets|Continuar asignaci\u00f3n|Seleccionado)$/}).click();
}

test('Distribution searches by code and unaccented words, filters semesters, and retains the draft on refresh',async({page})=>{
  await fixture(page);await page.goto('/distribution');
  await expect(page.getByRole('heading',{name:'Reparto de tickets'})).toBeVisible();
  await search(page).fill('jose perez');await expect(page.getByRole('article')).toHaveCount(1);
  await choose(page);await page.getByLabel('Números de ticket').fill('1050,1052-1054');
  await closeAssignment(page);await page.getByRole('button',{name:'Actualizar padrón'}).click();await choose(page);
  await expect(page.getByLabel('Números de ticket')).toHaveValue('1050,1052-1054');
  await page.reload();await expect(search(page)).toHaveValue('00123');
  await search(page).fill('');
  await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:/^VI /}).click();
  await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('ALVAREZ ANA');
});
test('Distribution assigns multiple ticket numbers atomically without marking payment or pickup',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');await choose(page);
  await page.getByLabel('Números de ticket').fill('1050, 1052-1054');
  await page.getByRole('button',{name:'Asignar 4 tickets',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Confirmar asignación'})).toContainText('PÉREZ JOSÉ');
  await page.getByRole('button',{name:'Confirmar y asignar'}).click();
  await expect(page.getByText('Asignación guardada',{exact:true})).toBeVisible();
  expect(state.students[0].tickets.slice(1).map(t=>t.ticket_number)).toEqual([1050,1052,1053,1054]);
  expect(state.students[0].tickets.slice(1).every(t=>!t.is_paid&&!t.is_picked_up)).toBe(true);
  expect(state.calls.filter(c=>c.method!=='GET').map(c=>c.path)).toEqual(['/api/faculty/assignments']);
});
test('A conflicting ticket keeps the input and saves no partial batch',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');await choose(page,'100002');
  await page.getByLabel('Números de ticket').fill('1050,1000');await page.getByRole('button',{name:'Asignar 2 tickets',exact:true}).click();await page.getByRole('button',{name:'Confirmar y asignar'}).click();
  await expect(page.getByRole('complementary', {name:'Asignar tickets al estudiante'}).getByRole('alert')).toContainText('No se asignó ningún ticket');
  await expect(page.getByLabel('Números de ticket')).toHaveValue('1050,1000');expect(state.students[1].tickets).toHaveLength(0);
});
test('Missing students can be added and their current semester can be corrected',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');await page.getByRole('button',{name:'Nuevo estudiante',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Nuevo estudiante'});
  await dialog.getByLabel('Nombre completo').fill('NUEVO ESTUDIANTE');await dialog.getByLabel('Código de estudiante').fill('00555');await dialog.getByLabel('Semestre',{exact:true}).selectOption('6');await dialog.getByRole('button',{name:'Guardar estudiante'}).click();
  await expect(dialog).not.toBeVisible();await closeAssignment(page);await search(page).fill('00555');
  await page.getByRole('button',{name:'Editar a NUEVO ESTUDIANTE'}).click();
  const edit=page.getByRole('dialog',{name:'Editar estudiante'});await edit.getByLabel('Semestre',{exact:true}).selectOption('8');await edit.getByRole('button',{name:'Guardar estudiante'}).click();
  await expect(edit).not.toBeVisible();await expect(page.getByRole('heading',{name:'VIII semestre',exact:true})).toBeVisible();expect(state.students.find(s=>s.code==='00555').semester).toBe(8);
});
test('Roster import previews semester groups and reports existing codes',async({page})=>{
  await fixture(page);await page.goto('/distribution');await page.getByRole('button',{name:'Importar padrón',exact:true}).click();
  await page.getByLabel('CSV del padrón').setInputFiles({name:'facultad.csv',mimeType:'text/csv',buffer:Buffer.from('Código;Nombres;Apellidos;Escuela Profesional;Semestre\n00123;José;Pérez;FINESI;II\n100004;Ana;Demo;FINESI;I\n100005;Luis;Demo;FINESI;X')});
  const panel=page.getByRole('region',{name:'Importar padrón de la facultad'});
  await expect(panel.getByRole('row')).toHaveCount(4);await expect(panel.getByRole('row').nth(1)).toContainText('100004');
  await panel.getByRole('button',{name:'Importar 3 estudiantes'}).click();await expect(panel.getByRole('status')).toContainText('2 estudiantes nuevos y 1 ya registrados');
});
test('Distribution fits mobile screens and opens assignment in a modal without scrolling to the page bottom',async({page})=>{
  await page.setViewportSize({width:390,height:844});await fixture(page);await page.goto('/distribution');await choose(page);
  await expect(page.getByLabel('Números de ticket')).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByLabel('Números de ticket').fill('1050-1054');await page.screenshot({path:'artifacts/ui-preview/distribution-mobile.png',fullPage:true});
});
test('Desktop distribution preview shows the chosen student and pending assignment',async({page})=>{
  await fixture(page);await page.goto('/distribution');await choose(page);await page.getByLabel('Números de ticket').fill('1050,1052-1054');
  await page.screenshot({path:'artifacts/ui-preview/distribution-desktop.png',fullPage:true});
});


test('Promotion has its own filter and editor option, distinct from students with an unknown semester',async({page})=>{
  const state=await fixture(page);state.students[0].semester=11;
  state.students.push({id:uuid(44),name:'PENDING SEMESTER',code:'PENDING-01',semester:null,school:'FINESI',tickets:[],roster_updated_at:'2026-10-31T12:00:00Z'});
  await page.goto('/distribution');
  const filters=page.getByRole('group',{name:'Filtrar por semestre'});
  await filters.getByRole('button',{name:/^Promoción /}).click();
  await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('PÉREZ JOSÉ');
  await expect(page.getByRole('heading',{name:'Promoción',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Editar a PÉREZ JOSÉ'}).click();
  const dialog=page.getByRole('dialog',{name:'Editar estudiante'});
  await expect(dialog.getByLabel('Semestre',{exact:true})).toHaveValue('11');
  await dialog.getByRole('button',{name:'Guardar estudiante'}).click();await expect(dialog).not.toBeVisible();
  await filters.getByRole('button',{name:/^Sin semestre /}).click();
  await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('PENDING SEMESTER');
});


for(const route of ['/students','/extras','/import']) test(`Legacy screen ${route} is temporarily unavailable and never loads its data`,async({page})=>{
  const state=await fixture(page);await page.goto(route);
  await expect(page.getByRole('heading',{name:'Temporalmente inhabilitado'})).toBeVisible();
  expect(state.calls).toHaveLength(0);
  await expect(page.getByRole('link',{name:'Reparto',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Estudiantes',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Ir a Reparto',exact:true}).click();await expect(page).toHaveURL(/\/distribution$/);
});
test('Signing in opens Reparto while delivery is also available',async({page})=>{
  await fixture(page);await page.goto('/');await page.getByRole('textbox',{name:'Correo electrónico',exact:true}).fill('reparto@example.test');
  await page.locator('#password').fill('fixture-password');await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page).toHaveURL(/\/distribution$/);await expect(page.getByRole('heading',{name:'Reparto de tickets'})).toBeVisible();
});
test('History shows each new assignment as a complete batch with actor and keeps its search on reload',async({page})=>{
  await fixture(page);await page.goto('/distribution');await choose(page);await page.getByLabel('Números de ticket').fill('1050,1052-1054');
  await page.getByRole('button',{name:'Asignar 4 tickets',exact:true}).click();await page.getByRole('button',{name:'Confirmar y asignar'}).click();
  await expect(page.getByText('Asignación guardada',{exact:true})).toBeVisible();await closeAssignment(page);await page.getByRole('link',{name:'Historial',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Historial de asignaciones'})).toBeVisible();
  const search=page.getByLabel('Buscar por ticket, estudiante, código o encargado');await search.fill('1052');
  const row=page.getByRole('row').filter({hasText:'#1052'});await expect(row).toHaveCount(1);await expect(row).toContainText('#1050');await expect(row).toContainText('#1054');await expect(row).toContainText('reparto@example.test');
  await page.reload();await expect(search).toHaveValue('1052');await expect(row).toHaveCount(1);
});
test('History supports Lima date filters and server pagination without losing search while refreshing',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution/history');
  await page.getByLabel('Desde',{exact:true}).fill('2026-10-31');await page.getByLabel('Hasta',{exact:true}).fill('2026-10-31');
  await expect(page.getByRole('row').filter({hasText:'00123'})).toContainText('10:30');
  await page.getByRole('button',{name:'Limpiar filtros'}).click();
  for(let i=0;i<65;i++) state.assignments.push({...state.assignments[0],id:uuid(600+i),ticket_numbers:[2000+i]});
  await page.getByRole('button',{name:'Actualizar historial'}).click();
  await expect(page.getByRole('status').filter({hasText:'66 asignaciones encontradas'})).toBeVisible();
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();await expect(page.getByRole('navigation',{name:'Paginación de asignaciones'})).toContainText('Página 2');
  const search=page.getByLabel('Buscar por ticket, estudiante, código o encargado');await search.fill('2001');
  await expect(page.getByRole('row').filter({hasText:'#2001'})).toHaveCount(1);await page.getByRole('button',{name:'Actualizar historial'}).click();await expect(search).toHaveValue('2001');
  await page.screenshot({path:'artifacts/ui-preview/assignment-history-desktop.png',fullPage:true});
});
test('Assignment history and the blocked screen fit a mobile viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await fixture(page);await page.goto('/distribution/history');
  await expect(page.getByText('PÉREZ JOSÉ',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const mobileNav=await page.getByRole('navigation',{name:'Navegación móvil'}).boundingBox();expect(mobileNav.y).toBeGreaterThan(700);
  await expect(page.getByRole('link',{name:'KikiriWeb, reparto de tickets'})).toBeVisible();
  await page.screenshot({path:'artifacts/ui-preview/assignment-history-mobile.png',fullPage:true,animations:'disabled'});
  await page.goto('/students');await expect(page.getByRole('heading',{name:'Temporalmente inhabilitado'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/ui-preview/delivery-disabled-mobile.png',fullPage:true,animations:'disabled'});
});


test('A visible edit action updates the complete student profile and keeps assigned tickets',async({page})=>{
  const state=await fixture(page);const originalTickets=JSON.parse(JSON.stringify(state.students[0].tickets));
  await page.goto('/distribution');await search(page).fill('00123');
  const editButton=page.getByRole('button',{name:'Editar a PÉREZ JOSÉ'});
  await expect(editButton).toHaveText('Editar datos');await editButton.click();
  const dialog=page.getByRole('dialog',{name:'Editar estudiante'});
  await dialog.getByLabel('Nombre completo').fill('PÉREZ JOSÉ LUIS');await dialog.getByLabel('Código de estudiante').fill('00124');
  await dialog.getByLabel('Semestre',{exact:true}).selectOption('8');await dialog.getByLabel('Escuela profesional').fill('FINESI CORREGIDA');
  await dialog.getByRole('button',{name:'Guardar estudiante'}).click();await expect(dialog).not.toBeVisible();
  await search(page).fill('00124');await expect(page.getByRole('article')).toContainText('PÉREZ JOSÉ LUIS');
  await expect(page.getByRole('heading',{name:'VIII semestre',exact:true})).toBeVisible();
  expect(state.students[0].school).toBe('FINESI CORREGIDA');expect(state.students[0].tickets).toEqual(originalTickets);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Editar a PÉREZ JOSÉ LUIS'}).click();
  await expect(dialog.getByLabel('Código de estudiante')).toHaveValue('00124');
  await page.screenshot({path:'artifacts/ui-preview/student-editor-mobile.png',animations:'disabled'});
});


test('Mobile actions and panels close without saving and retain the assignment draft',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');
  const actions=page.getByRole('group',{name:'Acciones del padrón'});
  for(const width of [360,390,430]) {
    await page.setViewportSize({width,height:800});
    const controls=[actions.getByRole('link',{name:'Historial de asignaciones'}),actions.getByRole('button',{name:'Importar padrón',exact:true}),actions.getByRole('button',{name:'Nuevo estudiante',exact:true})];
    for(const control of controls) {
      await expect(control).toBeVisible();await expect(control.locator('svg')).toBeVisible();
      const box=await control.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:360,height:800});
  await actions.getByRole('button',{name:'Importar padrón',exact:true}).click();
  const importer=page.getByRole('region',{name:'Importar padrón de la facultad'});
  await expect(importer.getByRole('button',{name:'Cerrar importación'})).toHaveText('Cerrar');
  await choose(page);await page.getByLabel('Números de ticket').fill('1050, 1052-1054');
  await closeAssignment(page);await importer.getByRole('button',{name:'Cerrar importación'}).click();await expect(importer).not.toBeVisible();
  const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});
  await expect(assignment).not.toBeVisible();
  await expect(search(page)).toHaveValue('00123');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Continuar asignación',exact:true}).click();
  await expect(page.getByLabel('Números de ticket')).toHaveValue('1050, 1052-1054');await expect(page.getByLabel('Números de ticket')).toBeInViewport();
  expect(state.calls.filter(call=>call.method!=='GET')).toHaveLength(0);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'artifacts/ui-preview/distribution-mobile-actions.png',animations:'disabled'});
  await closeAssignment(page);await actions.getByRole('button',{name:'Importar padrón',exact:true}).click();
  await importer.scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/ui-preview/distribution-mobile-import-close.png',animations:'disabled'});
});

test('The student editor has an accessible close action even on a short mobile viewport',async({page})=>{
  await page.setViewportSize({width:360,height:480});const state=await fixture(page);await page.goto('/distribution');
  await page.getByRole('button',{name:'Nuevo estudiante',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Nuevo estudiante'});await dialog.getByLabel('Nombre completo').fill('BORRADOR SIN GUARDAR');
  await dialog.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const close=dialog.getByRole('button',{name:'Cerrar editor'});await expect(close).toHaveText('Cerrar');await expect(close).toBeInViewport();
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:'artifacts/ui-preview/student-editor-mobile-close.png',animations:'disabled'});
  await close.click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Nuevo estudiante',exact:true}).click();await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect(state.calls.filter(call=>call.method!=='GET')).toHaveLength(0);expect(state.students).toHaveLength(3);
});


test('External and teacher profiles can be created without student codes and filtered separately',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');
  for(const [type,label,name] of [['external','Externo','VISITANTE DEMO'],['teacher','Docente','DOCENTE DEMO']]) {
    await page.getByRole('button',{name:'Nuevo estudiante',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Nuevo estudiante'});
    await dialog.getByLabel('Tipo de participante').selectOption(type);await dialog.getByLabel('Nombre completo').fill(name);
    await expect(dialog.getByLabel('Código o documento (opcional)')).not.toHaveAttribute('required');await expect(dialog.getByLabel('Semestre',{exact:true})).toHaveCount(0);
    await dialog.getByRole('button',{name:'Guardar estudiante'}).click();await expect(dialog).not.toBeVisible();await closeAssignment(page);
    await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:new RegExp('^'+label+' ')}).click();await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText(name);
  }
  expect(state.students.filter(s=>s.recipient_type==='teacher'||s.recipient_type==='external').every(s=>s.code===null&&s.semester===null)).toBe(true);
});

test('Assignment opens as a modal and a correction retains the original number and actor in history',async({page})=>{
  await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto('/distribution');await choose(page);
  await expect(page.getByRole('dialog',{name:'Asignar tickets',exact:true})).toBeVisible();
  const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});await assignment.locator('summary').filter({hasText:'Ver y editar'}).click();await assignment.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Editar ticket #1000'});await dialog.getByLabel('Nuevo número de ticket').fill('1050');await dialog.getByRole('button',{name:'Guardar corrección'}).click();await expect(dialog).not.toBeVisible();
  expect(state.students[0].tickets[0].ticket_number).toBe(1050);await expect(assignment.getByRole('button',{name:'Editar ticket 1050',exact:true})).toBeVisible();
  await page.goto('/distribution/history');await page.getByRole('link',{name:'Cambios de fichas y tickets'}).click();await expect(page.getByRole('heading',{name:'Historial de cambios'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Historial',exact:true})).toHaveAttribute('aria-current','page');
  const row=page.getByRole('row').filter({hasText:'reparto@example.test'});await expect(row).toContainText('1000');await expect(row).toContainText('1050');
  const changeSearch=page.getByLabel('Buscar cambios por persona, ticket o usuario');await changeSearch.fill('1050');await expect(row).toHaveCount(1);await page.reload();await expect(changeSearch).toHaveValue('1050');await expect(row).toHaveCount(1);
  await page.screenshot({path:'artifacts/ui-preview/ticket-correction-history-mobile.png',fullPage:true,animations:'disabled'});
});

test('Assigned tickets can be transferred and released without removing the original assignment snapshot',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');await choose(page);const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});
  await assignment.locator('summary').filter({hasText:'Ver y editar'}).click();await assignment.getByRole('button',{name:'Editar ticket 1000'}).click();let dialog=page.getByRole('dialog',{name:'Editar ticket #1000'});
  await dialog.getByLabel('Operación').selectOption('transfer');await dialog.getByLabel('Buscar nuevo destinatario').fill('100002');await dialog.getByRole('button',{name:/ALVAREZ ANA/}).click();await dialog.getByRole('button',{name:'Reasignar ticket',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect(state.students[0].tickets).toHaveLength(0);expect(state.students[1].tickets[0].ticket_number).toBe(1000);expect(state.assignments[0].ticket_numbers).toEqual([1000]);
  await choose(page,'100002');await assignment.locator('summary').filter({hasText:'Ver y editar'}).click();await assignment.getByRole('button',{name:'Editar ticket 1000'}).click();dialog=page.getByRole('dialog',{name:'Editar ticket #1000'});
  await dialog.getByLabel('Operación').selectOption('release');await dialog.getByRole('button',{name:'Retirar asignación',exact:true}).click();await expect(dialog).not.toBeVisible();expect(state.students[1].tickets).toHaveLength(0);expect(state.changes).toHaveLength(2);
});


test('Mobile CSV download exports all participants independently of filters and keeps the assignment draft',async({page})=>{
  await page.setViewportSize({width:360,height:800});const state=await fixture(page);
  state.students.push({id:uuid(80),name:'VISITANTE CSV',recipient_type:'external',code:null,semester:null,tickets:[{id:uuid(81),ticket_number:2050}]});
  state.students.push({id:uuid(82),name:'DOCENTE SIN TICKETS',recipient_type:'teacher',code:null,semester:null,tickets:[]});
  await page.goto('/distribution');await choose(page);await page.getByLabel('Números de ticket').fill('1060-1062');
  await closeAssignment(page);await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:/^VI /}).click();
  const button=page.getByRole('button',{name:'Exportar participantes CSV'});await expect(button.locator('svg')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await button.click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^participantes_tickets_.*\.csv$/);
  const rows=parseCSV(await readFile(await download.path(),'utf8'));expect(rows).toHaveLength(5);
  expect(rows.find(row=>row.codigo==='00123').tickets_asignados).toBe('1000');expect(rows.find(row=>row.nombre==='VISITANTE CSV').tickets_asignados).toBe('2050');expect(rows.find(row=>row.nombre==='DOCENTE SIN TICKETS').cantidad_tickets).toBe('0');
  await expect(search(page)).toHaveValue('00123');await expect(page.getByLabel('Números de ticket')).toHaveValue('1060-1062');await expect(button).toBeEnabled();await page.getByRole('button',{name:'Limpiar filtros',exact:true}).click();await choose(page);await expect(page.getByLabel('Números de ticket')).toHaveValue('1060-1062');
  expect(state.calls.filter(call=>call.method!=='GET')).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('Main totals remain global, include legacy Promotion tickets and update after assigning and releasing tickets',async({page})=>{
  await page.setViewportSize({width:390,height:844});const state=await fixture(page);state.students[0].semester=11;state.assignments=[];
  const summary=page.getByRole('region',{name:'Resumen del padrón'});const total=summary.locator('div').filter({hasText:'Total de participantes'});
  const pending=summary.locator('div').filter({hasText:'Participantes sin tickets'});const distributed=summary.locator('div').filter({hasText:'Tickets repartidos'});
  await page.goto('/distribution');await expect(total.locator('strong')).toHaveText('3');await expect(pending.locator('strong')).toHaveText('2');await expect(distributed.locator('strong')).toHaveText('1');await expect(distributed).toContainText('Incluye Promoción');
  await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:/^VI /}).click();await expect(page.getByRole('article')).toHaveCount(1);await expect(distributed.locator('strong')).toHaveText('1');await expect(pending.locator('strong')).toHaveText('2');
  await page.getByRole('article').getByRole('button',{name:'Asignar tickets',exact:true}).click();await page.getByLabel('Números de ticket').fill('1050-1052');await page.getByRole('button',{name:'Asignar 3 tickets',exact:true}).click();await page.getByRole('button',{name:'Confirmar y asignar'}).click();await expect(page.getByText('Asignaci\u00f3n guardada',{exact:true})).toBeVisible();await closeAssignment(page);
  await expect(distributed.locator('strong')).toHaveText('4');await expect(pending.locator('strong')).toHaveText('1');await expect(total.locator('strong')).toHaveText('3');
  await choose(page,'100002');const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});await assignment.locator('summary').filter({hasText:'Ver y editar'}).click();await assignment.getByRole('button',{name:'Editar ticket 1050',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Editar ticket #1050'});await dialog.getByLabel('Operación').selectOption('release');await dialog.getByRole('button',{name:'Retirar asignación',exact:true}).click();await expect(dialog).not.toBeVisible();
  await closeAssignment(page);await expect(distributed.locator('strong')).toHaveText('3');await expect(pending.locator('strong')).toHaveText('1');expect(state.students[0].tickets[0].ticket_number).toBe(1000);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/ui-preview/distribution-main-totals-mobile.png',animations:'disabled'});
});


test('Ticket filters combine with search and semester, reset together and preserve the active assignment draft',async({page})=>{
  await page.setViewportSize({width:360,height:800});const state=await fixture(page);await page.goto('/distribution');
  const filters=page.getByRole('group',{name:'Filtrar por tickets asignados'});
  await expect(page.getByRole('article')).toHaveCount(3);
  await filters.getByRole('button',{name:'Sin tickets',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:/^VI /}).click();await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('article').getByRole('button',{name:'Asignar tickets',exact:true}).click();await page.getByLabel('Números de ticket').fill('1300-1302');
  await closeAssignment(page);await search(page).fill('missing');await expect(page.getByRole('article')).toHaveCount(0);await page.getByRole('button',{name:'Limpiar filtros',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(3);await expect(search(page)).toHaveValue('');
  await filters.getByRole('button',{name:'Con tickets',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('00123');
  await page.getByRole('button',{name:'Actualizar padrón'}).click();
  const summary=page.getByRole('region',{name:'Resumen del padrón'});await expect(summary).toContainText('Total de participantes3');await expect(summary).toContainText('Participantes sin tickets2');
  await filters.getByRole('button',{name:'Sin tickets',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(2);
  await choose(page,'100002');await expect(page.getByLabel('Números de ticket')).toHaveValue('1300-1302');await closeAssignment(page);
  expect(state.calls.filter(c=>c.method!=='GET')).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:'artifacts/ui-preview/distribution-ticket-filters-mobile.png',animations:'disabled'});
});

test('Fast typing sends only the final query and an obsolete response cannot replace the latest results',async({page})=>{
  const state=await fixture(page);await page.goto('/distribution');await expect(page.getByRole('article')).toHaveCount(3);state.calls.length=0;
  await search(page).pressSequentially('100002',{delay:20});await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('ALVAREZ ANA');
  expect(state.calls.filter(c=>c.path==='/api/faculty').map(c=>c.query)).toEqual(['100002']);
  let release;let started;const pending=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/faculty?**',async route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('q')!=='obsolete'){await route.fallback();return;}
    await new Promise(resolve=>{release=resolve;started();});try{await route.fulfill({json:{students:[],total:0,hasMore:false,semesters:[],summary:{}}});}catch{/* The client already cancelled this obsolete search. */}
  });
  await search(page).fill('obsolete');await pending;await search(page).fill('00123');await expect(page.getByRole('article')).toContainText('00123');release();
  await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('00123');await expect(search(page)).toHaveValue('00123');
});


test('Semester coverage is based on people, stays global under filters, and fits both desktop and narrow mobile screens',async({page})=>{
  const state=await fixture(page);
  for(let i=0;i<3;i++)state.students.push({id:uuid(810+i),name:`SEMESTER THREE ${i}`,code:`THREE-${i}`,recipient_type:'student',semester:3,tickets:i===0?[1,2,3].map(n=>({id:uuid(900+n),ticket_number:1100+n})):[]});
  await page.goto('/distribution');
  const semesters=page.getByRole('group',{name:'Filtrar por semestre'});
  const third=semesters.getByRole('button',{name:/^III /});const sixth=semesters.getByRole('button',{name:/^VI /});
  await expect(third).toContainText('33,3%');await expect(third).toHaveAttribute('title','III semestre: 1 de 3 con al menos un ticket (33,3%)');
  await expect(sixth).toContainText('0%');await expect(semesters.getByRole('button',{name:/^II /})).toContainText('100%');
  const empty=semesters.getByRole('button',{name:/^I /});await expect(empty).toHaveAttribute('title','I semestre: sin participantes');await expect(empty).not.toContainText('NaN');await expect(empty).not.toContainText('100%');
  await page.getByRole('group',{name:'Filtrar por tickets asignados'}).getByRole('button',{name:'Sin tickets',exact:true}).click();await search(page).fill('100002');await expect(page.getByRole('article')).toHaveCount(1);await expect(third).toContainText('33,3%');
  await page.getByRole('article').getByRole('button',{name:'Asignar tickets',exact:true}).click();await page.getByLabel('N\u00fameros de ticket').fill('1300-1302');await page.getByRole('button',{name:'Asignar 3 tickets',exact:true}).click();await page.getByRole('button',{name:'Confirmar y asignar'}).click();await expect(page.getByText('Asignaci\u00f3n guardada',{exact:true})).toBeVisible();await closeAssignment(page);await expect(sixth).toContainText('100%');
  await page.getByRole('button',{name:'Limpiar filtros',exact:true}).click();await expect(page.getByRole('article')).toHaveCount(6);await expect(third).toContainText('33,3%');
  await page.evaluate(()=>scrollTo({top:200,behavior:'instant'}));await page.screenshot({path:'artifacts/ui-preview/distribution-semester-progress-desktop.png',animations:'disabled'});
  for(const width of [320,360,390]) {
    await page.setViewportSize({width,height:900});await expect(page.getByLabel('Grupo de participantes')).toBeVisible();
    await expect(third).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByLabel('Grupo de participantes').selectOption('semester:0');await expect(page.getByRole('article')).toHaveCount(0);await page.getByLabel('Grupo de participantes').selectOption('all');await expect(page.getByRole('article')).toHaveCount(6);
  await page.evaluate(()=>scrollTo({top:220,behavior:'instant'}));await page.screenshot({path:'artifacts/ui-preview/distribution-semester-progress-mobile.png',animations:'disabled'});
});


test('Mobile search results sit immediately below the search box, before filters and retains a closed modal draft, without losing the draft',async({page})=>{
  const state=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/distribution');
  await choose(page);await page.getByLabel('N\u00fameros de ticket').fill('1400-1402');
  await closeAssignment(page);await search(page).fill('100002');await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText('ALVAREZ ANA');
  const bounds=async()=>{
    const elements=await Promise.all([search(page).elementHandle(),page.getByRole('article').elementHandle(),page.getByRole('group',{name:'Filtrar por semestre'}).elementHandle(),page.getByRole('region',{name:'Resumen del padr\u00f3n'}).elementHandle()]);
    const [input,result,filters,summary]=await page.evaluate(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {y:rect.top+window.scrollY,height:rect.height};}),elements);
    expect(result.y).toBeGreaterThan(input.y+input.height);expect(result.y-(input.y+input.height)).toBeLessThan(100);
    expect(result.y+result.height).toBeLessThan(filters.y);expect(result.y).toBeLessThan(summary.y);
  };
  for(const width of [320,390,768]){await page.setViewportSize({width,height:900});await bounds();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await choose(page);await expect(page.getByLabel('N\u00fameros de ticket')).toHaveValue('1400-1402');await closeAssignment(page);
  await search(page).fill('NO MATCH');await expect(page.getByRole('heading',{name:'No encontramos estudiantes'})).toBeVisible();
  await page.getByRole('button',{name:'Agregar estudiante',exact:true}).click();const editor=page.getByRole('dialog',{name:'Nuevo estudiante'});await expect(editor).toBeVisible();await editor.getByRole('button',{name:'Cerrar editor'}).click();await expect(editor).not.toBeVisible();
  await search(page).fill('100002');await expect(page.getByRole('article')).toHaveCount(1);await expect(search(page)).toBeFocused();
  await page.setViewportSize({width:390,height:844});await search(page).evaluate(element=>window.scrollTo({top:element.getBoundingClientRect().top+window.scrollY-100,behavior:'instant'}));await page.screenshot({path:'artifacts/ui-preview/distribution-mobile-search-results-first.png',animations:'disabled'});
  await page.setViewportSize({width:1440,height:1000});await expect(page.getByRole('article')).toHaveCount(1);await choose(page);await expect(page.getByLabel('N\u00fameros de ticket')).toHaveValue('1400-1402');await closeAssignment(page);
  await page.setViewportSize({width:390,height:844});await search(page).fill('');await expect(page.getByRole('article')).toHaveCount(3);await choose(page);await expect(page.getByLabel('N\u00fameros de ticket')).toHaveValue('1400-1402');await closeAssignment(page);
  expect(state.calls.filter(call=>call.method!=='GET')).toHaveLength(0);
});


for(const [method,label]of [['cash','Pag\u00f3 en efectivo'],['yape','Pag\u00f3 con Yape']])test(`Tickets can be paid during allocation using ${method} without marking pickup`,async({page})=>{
 const state=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/distribution');await choose(page,'100002');await page.getByLabel('N\u00fameros de ticket').fill('1600-1601');await page.getByRole('radio',{name:label}).check();await page.getByRole('button',{name:'Asignar 2 tickets',exact:true}).click();await page.getByRole('button',{name:'Confirmar y asignar'}).click();
 const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});await expect(assignment).toContainText('Pago registrado:');await expect(assignment).toContainText('S/ 30.00');expect(state.students[1].tickets).toHaveLength(2);expect(state.students[1].tickets.every(ticket=>ticket.is_paid&&!ticket.is_picked_up)).toBe(true);expect(state.payments).toHaveLength(2);expect(state.payments.every(event=>event.method===method)).toBe(true);await expect(page.getByRole('radio',{name:'Pendiente de pago',exact:true})).toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Existing payments can be registered and voided before deletion, and historical assignments remain intact',async({page})=>{
 const state=await fixture(page);await page.goto('/distribution');await choose(page);const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});await assignment.locator('summary').click();await assignment.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();let editor=page.getByRole('dialog',{name:'Editar ticket #1000'});
 await editor.getByLabel('Operaci\u00f3n').selectOption('pay');await editor.getByRole('group',{name:'Medio de pago',exact:true}).getByRole('button',{name:'Yape',exact:true}).click();await editor.getByRole('button',{name:'Registrar pago',exact:true}).click();await expect(editor).not.toBeVisible();await expect(assignment).toContainText('Pagado: Yape');
 await assignment.getByRole('button',{name:'Eliminar participante',exact:true}).click();const blocked=page.getByRole('dialog',{name:'Eliminar participante'});await expect(blocked).toContainText('Anula esos pagos');await expect(blocked.getByRole('button',{name:'Eliminar participante',exact:true})).toBeDisabled();await blocked.getByRole('button',{name:'Cancelar',exact:true}).click();
 await assignment.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();editor=page.getByRole('dialog',{name:'Editar ticket #1000'});await expect(editor.locator('option[value="delete"]')).toBeDisabled();await editor.getByLabel('Operaci\u00f3n').selectOption('void');await editor.getByRole('button',{name:'Anular pago',exact:true}).click();expect(state.students[0].tickets[0].is_paid).toBe(true);await editor.getByRole('button',{name:'Confirmar anulaci\u00f3n',exact:true}).click();await expect(editor).not.toBeVisible();expect(state.payments).toHaveLength(2);expect(state.students[0].tickets[0].is_paid).toBe(false);
 await assignment.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();await editor.getByLabel('Operaci\u00f3n').selectOption('delete');await editor.getByRole('button',{name:'Eliminar ticket',exact:true}).click();expect(state.students[0].tickets).toHaveLength(1);await editor.getByRole('button',{name:'Confirmar eliminaci\u00f3n',exact:true}).click();await expect(editor).not.toBeVisible();expect(state.students[0].tickets).toHaveLength(0);expect(state.deletedTickets).toHaveLength(1);expect(state.assignments[0].ticket_numbers).toEqual([1000]);
 await page.goto('/distribution/changes');await expect(page.getByRole('table')).toContainText('Eliminaci\u00f3n');await expect(page.getByRole('table')).toContainText('reparto@example.test');
});

test('Participant deletion confirms the affected assignments and updates totals while preserving the original history',async({page})=>{
 const state=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/distribution');await choose(page);await page.getByLabel('N\u00fameros de ticket').fill('1800-1802');await page.getByRole('complementary',{name:'Asignar tickets al estudiante'}).getByRole('button',{name:'Eliminar participante',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Eliminar participante'});await expect(dialog).toContainText('1 ticket asignado');await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(page.getByLabel('N\u00fameros de ticket')).toHaveValue('1800-1802');expect(state.calls.some(call=>call.method==='DELETE')).toBe(false);
 await page.getByRole('complementary',{name:'Asignar tickets al estudiante'}).getByRole('button',{name:'Eliminar participante',exact:true}).click();await dialog.getByRole('button',{name:'Eliminar participante',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('heading',{name:'No encontramos estudiantes'})).toBeVisible();await expect(page.getByRole('region',{name:'Resumen del padr\u00f3n'})).toContainText('Total de participantes2');expect(state.students).toHaveLength(2);expect(state.deletedStudents).toHaveLength(1);expect(state.deletedTickets).toHaveLength(1);expect(state.assignments[0].ticket_numbers).toEqual([1000]);
 await page.goto('/distribution/history');await expect(page.getByRole('table')).toContainText('1000');await expect(page.getByRole('table')).toContainText('reparto@example.test');
});


test('External participants without codes can be deleted using the same operator controls',async({page})=>{
 const state=await fixture(page);state.students.push({id:uuid(920),name:'VISITANTE A ELIMINAR',code:null,recipient_type:'external',semester:null,tickets:[],roster_updated_at:'2026-11-05T12:00:00Z'});await page.goto('/distribution');await search(page).fill('VISITANTE A ELIMINAR');await expect(page.getByRole('article')).toHaveCount(1);await page.getByRole('article').getByRole('button',{name:/^Eliminar a/}).click();const dialog=page.getByRole('dialog',{name:'Eliminar participante'});await expect(dialog).toContainText('Sin c\u00f3digo - Externo');await dialog.getByRole('button',{name:'Eliminar participante',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('heading',{name:'No encontramos estudiantes'})).toBeVisible();expect(state.students).toHaveLength(3);expect(state.deletedStudents[0].recipient_type).toBe('external');
});


for(const method of ['cash','yape'])test(`History registers ${method} payments without changing the original batch and retains search`,async({page})=>{
 const state=await fixture(page);const original=JSON.parse(JSON.stringify(state.assignments[0]));await page.goto('/distribution/history');
 const search=page.getByRole('searchbox');await search.fill('1000');await expect(page.getByRole('row').filter({hasText:'#1000'})).toHaveCount(1);
 await page.getByRole('button',{name:/Editar tickets de/}).click();const batch=page.getByRole('dialog',{name:'Editar tickets y pagos'});
 await expect(batch).toContainText('Pendiente de pago');await batch.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Editar ticket #1000'});await expect(editor.getByLabel('Operaci\u00f3n')).toHaveValue('pay');await editor.getByRole('group',{name:'Medio de pago',exact:true}).getByRole('button',{name:method==='cash'?'Efectivo':'Yape',exact:true}).click();
 await editor.getByRole('button',{name:'Registrar pago',exact:true}).click();await expect(editor).not.toBeVisible();
 await expect(batch).toContainText(method==='cash'?'Pagado: Efectivo':'Pagado: Yape');await expect(batch.getByRole('status')).toContainText('Pago registrado');
 expect(state.students[0].tickets[0].is_paid).toBe(true);expect(state.students[0].tickets[0].is_picked_up).toBeFalsy();expect(state.payments).toHaveLength(1);expect(state.assignments[0]).toEqual(original);
 await batch.getByRole('button',{name:'Cerrar tickets del historial'}).click();await expect(batch).not.toBeVisible();await expect(search).toHaveValue('1000');
 await page.getByRole('link',{name:'Cambios de fichas y tickets'}).click();await expect(page.getByRole('table')).toContainText('Pago registrado');await expect(page.getByRole('table')).toContainText('reparto@example.test');
});

test('History opens current ticket identities after a number correction and never edits reused historical numbers',async({page})=>{
 const state=await fixture(page);state.students[0].tickets[0].ticket_number=1099;
 state.students[1].tickets.push({id:uuid(922),ticket_number:1000,student_id:uuid(2),assignment_id:uuid(888),assignment_updated_at:'2026-11-05T12:00:00Z',can_edit:true});
 await page.goto('/distribution/history');await page.getByRole('button',{name:/Editar tickets de/}).click();const batch=page.getByRole('dialog',{name:'Editar tickets y pagos'});
 await expect(batch).toContainText('#1099');await expect(batch).not.toContainText('#1000');await batch.getByRole('button',{name:'Editar ticket 1099',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Editar ticket #1099'});await editor.getByLabel('Operaci\u00f3n').selectOption('update');await editor.getByLabel('Nuevo n\u00famero de ticket').fill('1100');await editor.getByRole('button',{name:'Guardar correcci\u00f3n'}).click();
 await expect(editor).not.toBeVisible();await expect(batch).toContainText('#1100');expect(state.assignments[0].ticket_numbers).toEqual([1000]);expect(state.students[1].tickets[0].ticket_number).toBe(1000);
});

test('History excludes reassigned tickets, handles retry and fits mobile without losing the filters',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);state.students[0].tickets[0].assignment_id=uuid(888);state.failHistoryTickets=true;
 await page.goto('/distribution/history');await page.getByRole('button',{name:/Editar tickets de/}).click();const batch=page.getByRole('dialog',{name:'Editar tickets y pagos'});
 await expect(batch.getByRole('alert')).toContainText('No se pudieron cargar');state.failHistoryTickets=false;await batch.getByRole('button',{name:'Actualizar tickets'}).click();
 await expect(batch).toContainText('Este lote ya no tiene tickets activos');await expect(batch.getByRole('button',{name:/Editar ticket [0-9]/})).toHaveCount(0);
 await batch.getByRole('button',{name:'Cerrar tickets del historial'}).click();state.students[0].tickets[0].assignment_id=uuid(501);
 await page.getByRole('button',{name:/Editar tickets de/}).click();await batch.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();const editor=page.getByRole('dialog',{name:'Editar ticket #1000'});
 const bounds=await editor.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
 await page.screenshot({path:'artifacts/ui-preview/history-payment-mobile.png',fullPage:true,animations:'disabled'});await editor.getByRole('button',{name:'Cerrar editor de ticket'}).click();await batch.getByRole('button',{name:'Cerrar tickets del historial'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


for(const method of ['cash','yape'])test(`Mobile grouped ${method} payment selects two tickets, confirms the sum once and preserves the other ticket`,async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);const person=state.students[0];
 person.tickets.push(...[1001,1002].map(number=>({...person.tickets[0],id:uuid(number),ticket_number:number,unit_price:15,is_paid:false})));
 await page.goto('/distribution');await choose(page);const assignment=page.getByRole('dialog',{name:'Asignar tickets',exact:true});await expect(assignment).toBeVisible();
 await assignment.locator('summary').filter({hasText:'Ver y editar'}).click();await assignment.getByRole('button',{name:'Pagar varios tickets'}).click();const group=page.getByRole('dialog',{name:'Pago de varios tickets'});
 await group.getByRole('checkbox',{name:'Seleccionar ticket 1000',exact:true}).check();await group.getByRole('checkbox',{name:'Seleccionar ticket 1001',exact:true}).check();await group.getByRole('group',{name:'Estado de los tickets seleccionados',exact:true}).getByRole('button',{name:method==='cash'?'Efectivo':'Yape',exact:true}).click();
 await expect(group.getByRole('status')).toContainText('Total a pagar: S/ 30.00');await group.getByRole('button',{name:'Revisar cambios'}).click();expect(state.payments).toHaveLength(0);if(method==='cash')await group.screenshot({path:'artifacts/ui-preview/group-payment-review-mobile.png',animations:'disabled'});
 await group.getByRole('button',{name:'Confirmar pago conjunto'}).click();await expect(group).not.toBeVisible();expect(person.tickets.filter(ticket=>ticket.is_paid)).toHaveLength(2);expect(person.tickets[2].is_paid).toBe(false);expect(state.payments).toHaveLength(2);
 expect(state.calls.filter(call=>call.path==='/api/faculty/payments'&&call.method==='PATCH')).toHaveLength(1);expect(person.tickets.every(ticket=>!ticket.is_picked_up)).toBe(true);
 await expect(assignment).toContainText('Pagado: '+(method==='cash'?'Efectivo':'Yape'));await page.screenshot({path:`artifacts/ui-preview/group-payment-${method}-mobile.png`,animations:'disabled'});
});

test('Pending is visible in the single editor and reverses an existing payment only after confirmation',async({page})=>{
 const state=await fixture(page);Object.assign(state.students[0].tickets[0],{is_paid:true,paid_amount:15,payment_method:'en_momento_yape|prior@example.test',can_manage:true,can_edit:false});await page.goto('/distribution');await choose(page);
 const assignment=page.getByRole('dialog',{name:'Asignar tickets',exact:true});await assignment.locator('summary').click();await assignment.getByRole('button',{name:'Editar ticket 1000',exact:true}).click();const editor=page.getByRole('dialog',{name:'Editar ticket #1000'});
 await editor.getByRole('group',{name:'Medio de pago',exact:true}).getByRole('button',{name:'Pendiente de pago',exact:true}).click();await editor.getByRole('button',{name:'Dejar pendiente de pago'}).click();expect(state.students[0].tickets[0].is_paid).toBe(true);
 await editor.getByRole('button',{name:'Confirmar anulaci\u00f3n'}).click();await expect(editor).not.toBeVisible();expect(state.students[0].tickets[0].is_paid).toBe(false);expect(state.students[0].tickets[0].student_id).toBe(uuid(1));expect(state.payments[0].kind).toBe('void');
});

test('History can leave two payments pending together and preserves assignment snapshots',async({page})=>{
 const state=await fixture(page);const person=state.students[0];Object.assign(person.tickets[0],{is_paid:true,paid_amount:15,payment_method:'en_momento_efectivo|old@example.test'});person.tickets.push({...person.tickets[0],id:uuid(911),ticket_number:1001});state.assignments[0].ticket_numbers.push(1001);const original=JSON.parse(JSON.stringify(state.assignments));
 await page.goto('/distribution/history');await page.getByRole('button',{name:/Editar tickets de/}).click();const batch=page.getByRole('dialog',{name:'Editar tickets y pagos'});await batch.getByRole('button',{name:'Pagar varios tickets'}).click();const group=page.getByRole('dialog',{name:'Pago de varios tickets'});
 await group.getByRole('checkbox',{name:'Seleccionar ticket 1000',exact:true}).check();await group.getByRole('checkbox',{name:'Seleccionar ticket 1001',exact:true}).check();await group.getByRole('group',{name:'Estado de los tickets seleccionados',exact:true}).getByRole('button',{name:'Pendiente de pago',exact:true}).click();await expect(group.getByRole('status')).toContainText('Total por anular: S/ 30.00');
 await group.getByRole('button',{name:'Revisar cambios'}).click();expect(state.payments).toHaveLength(0);await group.getByRole('button',{name:'Confirmar pendientes'}).click();await expect(group).not.toBeVisible();expect(person.tickets.every(ticket=>!ticket.is_paid)).toBe(true);expect(state.payments).toHaveLength(2);expect(state.assignments).toEqual(original);
});

test('A changed grouped payment keeps the selected tickets and sum visible and saves nothing',async({page})=>{
 const state=await fixture(page);state.failBatch=true;state.students[0].tickets.push({...state.students[0].tickets[0],id:uuid(912),ticket_number:1001});await page.goto('/distribution');await choose(page);const assignment=page.getByRole('dialog',{name:'Asignar tickets',exact:true});await assignment.locator('summary').click();await assignment.getByRole('button',{name:'Pagar varios tickets'}).click();
 const group=page.getByRole('dialog',{name:'Pago de varios tickets'});await group.getByRole('button',{name:'Seleccionar pendientes'}).click();await group.getByRole('button',{name:'Revisar cambios'}).click();await group.getByRole('button',{name:'Confirmar pago conjunto'}).click();await expect(group.getByRole('alert')).toContainText('pagos cambiaron');await expect(group.getByRole('checkbox',{name:'Seleccionar ticket 1000',exact:true})).toBeChecked();await expect(group.getByRole('status')).toContainText('S/ 30.00');expect(state.payments).toHaveLength(0);
});
