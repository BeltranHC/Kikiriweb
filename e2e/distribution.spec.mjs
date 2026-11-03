import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { participantReport } from '../lib/faculty-export.mjs';
import { parseCSV } from '../lib/csv.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fold = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
async function fixture(page) {
  const state = { calls: [], students: [
    { id:uuid(1),name:'PÉREZ JOSÉ',code:'00123',semester:2,school:'FINESI',roster_updated_at:'2026-10-31T12:00:00Z',tickets:[{id:uuid(91),ticket_number:1000,student_id:uuid(1),assignment_updated_at:'2026-11-03T10:00:00Z',can_edit:true}] },
    { id:uuid(2),name:'ALVAREZ ANA',code:'100002',semester:6,school:'FINESI',roster_updated_at:'2026-10-31T12:00:00Z',tickets:[] },
    { id:uuid(3),name:'TORRES LUIS',code:'100003',semester:10,school:'FINESI',roster_updated_at:'2026-10-31T12:00:00Z',tickets:[] },
  ] };
  state.changes=[];
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
    state.calls.push({ path:url.pathname,method,query:url.searchParams.get('q'),page:url.searchParams.get('page') });
    if(url.pathname==='/api/faculty/export') {
      await route.fulfill({headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="participantes_tickets_2026-11-03.csv"'},body:participantReport(state.students,state.students.flatMap(person=>person.tickets.map(ticket=>({...ticket,student_id:person.id}))))});
      return;
    }
    if (url.pathname === '/api/faculty' && method === 'GET') {
      const query=fold(url.searchParams.get('q') || ''); const semester=url.searchParams.get('semester') || 'all'; const type=url.searchParams.get('type')||'all';
      const students=state.students.filter(student => query.split(/\s+/).every(token => fold(student.name+' '+student.code).includes(token)) && (semester==='all' || (student.semester ?? 0)===Number(semester)) && (type==='all'||(student.recipient_type||'student')===type))
        .sort((a,b)=>(a.semester??12)-(b.semester??12) || a.name.localeCompare(b.name));
      await route.fulfill({json:{categories:['student','external','teacher'].map(type=>({type,count:state.students.filter(s=>(s.recipient_type||'student')===type).length})),students,total:students.length,hasMore:false,page:1,pageSize:30,semesters:[null,1,2,3,4,5,6,7,8,9,10,11].map(semester=>({semester,count:state.students.filter(s=>s.semester===semester).length})),summary:{totalStudents:state.students.length,withTickets:state.students.filter(s=>s.tickets.length).length,withoutTickets:state.students.filter(s=>!s.tickets.length).length}}});
    } else if (url.pathname === '/api/faculty' && ['POST','PATCH'].includes(method)) {
      const body=route.request().postDataJSON();
      let student=state.students.find(s=>s.id===body.id);
      if (method==='PATCH' && student.roster_updated_at!==body.expectedUpdatedAt) {await route.fulfill({status:409,json:{error:'Otro encargado modificó este estudiante'}});return;}
      if (method==='POST') {student={id:uuid(10+state.students.length),tickets:[]};state.students.push(student);}
      const before=JSON.parse(JSON.stringify(student));
      Object.assign(student,{recipient_type:body.recipientType||'student',name:body.name,code:body.code,semester:body.semester,school:body.school,roster_updated_at:new Date().toISOString()});
      state.changes.unshift({id:uuid(700+state.changes.length),entity_type:'student',operation:method==='POST'?'create':'update',student_name:student.name,actor_email:'reparto@example.test',created_at:new Date().toISOString(),before_data:method==='POST'?null:before,after_data:JSON.parse(JSON.stringify(student))});
      await route.fulfill({status:method==='POST'?201:200,json:student});
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
      const tickets=body.ticketNumbers.map(n=>({id:uuid(2000+n),ticket_number:n,student_id:student.id,is_picked_up:false,is_paid:false,can_edit:true,assignment_updated_at:new Date().toISOString()}));
      student.tickets.push(...tickets);
      state.assignments.push({id:uuid(501+state.assignments.length),student_id:student.id,student_name:student.name,student_code:student.code,semester:student.semester,created_at:new Date().toISOString(),actor_id:uuid(999),actor_email:'reparto@example.test',ticket_numbers:body.ticketNumbers});
      await route.fulfill({status:201,json:{ticketsCreated:tickets.length,tickets,studentId:student.id}});
    } else if (url.pathname==='/api/faculty/import') {
      await route.fulfill({json:{studentsCreated:2,studentsExisting:1,total:3}});
    } else await route.fulfill({status:404,json:{error:'Unknown fixture API'}});
  });
  return state;
}
const search = page => page.getByRole('searchbox',{name:'Buscar estudiantes'});
async function choose(page, code='00123') {
  await search(page).fill(code);
  await expect(page.getByRole('status').filter({hasText:'1 estudiantes encontrados'})).toBeVisible();
  await page.getByRole('article').getByRole('button',{name:'Asignar tickets',exact:true}).click();
}

test('Distribution searches by code and unaccented words, filters semesters, and retains the draft on refresh',async({page})=>{
  await fixture(page);await page.goto('/distribution');
  await expect(page.getByRole('heading',{name:'Reparto de tickets'})).toBeVisible();
  await search(page).fill('jose perez');await expect(page.getByRole('article')).toHaveCount(1);
  await choose(page);await page.getByLabel('Números de ticket').fill('1050,1052-1054');
  await page.getByRole('button',{name:'Actualizar padrón'}).click();
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
  await expect(dialog).not.toBeVisible();await search(page).fill('00555');
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
test('Distribution fits mobile screens and scrolls the selected student into the assignment form',async({page})=>{
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


for(const route of ['/dashboard','/students','/movements','/extras','/import']) test(`Legacy screen ${route} is temporarily unavailable and never loads its data`,async({page})=>{
  const state=await fixture(page);await page.goto(route);
  await expect(page.getByRole('heading',{name:'Temporalmente inhabilitado'})).toBeVisible();
  expect(state.calls).toHaveLength(0);
  await expect(page.getByRole('link',{name:'Reparto',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Estudiantes',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Ir a Reparto',exact:true}).click();await expect(page).toHaveURL(/\/distribution$/);
});
test('Signing in opens Reparto instead of the locked delivery dashboard',async({page})=>{
  await fixture(page);await page.goto('/');await page.getByRole('textbox',{name:'Correo electrónico',exact:true}).fill('reparto@example.test');
  await page.locator('#password').fill('fixture-password');await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page).toHaveURL(/\/distribution$/);await expect(page.getByRole('heading',{name:'Reparto de tickets'})).toBeVisible();
});
test('History shows each new assignment as a complete batch with actor and keeps its search on reload',async({page})=>{
  await fixture(page);await page.goto('/distribution');await choose(page);await page.getByLabel('Números de ticket').fill('1050,1052-1054');
  await page.getByRole('button',{name:'Asignar 4 tickets',exact:true}).click();await page.getByRole('button',{name:'Confirmar y asignar'}).click();
  await expect(page.getByText('Asignación guardada',{exact:true})).toBeVisible();await page.getByRole('link',{name:'Historial',exact:true}).click();
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
  await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Temporalmente inhabilitado'})).toBeVisible();
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
  await importer.getByRole('button',{name:'Cerrar importación'}).click();await expect(importer).not.toBeVisible();
  const assignment=page.getByRole('complementary',{name:'Asignar tickets al estudiante'});
  await assignment.getByRole('button',{name:'Cerrar asignación'}).click();await expect(assignment).not.toBeVisible();
  await expect(search(page)).toHaveValue('00123');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Continuar asignación',exact:true}).click();
  await expect(page.getByLabel('Números de ticket')).toHaveValue('1050, 1052-1054');await expect(page.getByLabel('Números de ticket')).toBeInViewport();
  expect(state.calls.filter(call=>call.method!=='GET')).toHaveLength(0);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'artifacts/ui-preview/distribution-mobile-actions.png',animations:'disabled'});
  await actions.getByRole('button',{name:'Importar padrón',exact:true}).click();
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
    await dialog.getByRole('button',{name:'Guardar estudiante'}).click();await expect(dialog).not.toBeVisible();
    await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:new RegExp('^'+label+' ')}).click();await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('article')).toContainText(name);
  }
  expect(state.students.filter(s=>s.recipient_type==='teacher'||s.recipient_type==='external').every(s=>s.code===null&&s.semester===null)).toBe(true);
});

test('Search stays above the assignment panel and a correction retains the original number and actor in history',async({page})=>{
  await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto('/distribution');await choose(page);
  expect(await page.evaluate(()=>document.querySelector('input[type="search"]').getBoundingClientRect().top<document.querySelector('aside').getBoundingClientRect().top)).toBe(true);
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
  await page.getByRole('group',{name:'Filtrar por semestre'}).getByRole('button',{name:/^VI /}).click();
  const button=page.getByRole('button',{name:'Exportar participantes CSV'});await expect(button.locator('svg')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await button.click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^participantes_tickets_.*\.csv$/);
  const rows=parseCSV(await readFile(await download.path(),'utf8'));expect(rows).toHaveLength(5);
  expect(rows.find(row=>row.codigo==='00123').tickets_asignados).toBe('1000');expect(rows.find(row=>row.nombre==='VISITANTE CSV').tickets_asignados).toBe('2050');expect(rows.find(row=>row.nombre==='DOCENTE SIN TICKETS').cantidad_tickets).toBe('0');
  await expect(search(page)).toHaveValue('00123');await expect(page.getByLabel('Números de ticket')).toHaveValue('1060-1062');await expect(button).toBeEnabled();
  expect(state.calls.filter(call=>call.method!=='GET')).toHaveLength(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
