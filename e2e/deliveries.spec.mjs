import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {deliveryCashCSV} from '../lib/delivery.mjs';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fold=value=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
async function fixture(page){
 const version='2026-11-01T10:00:00Z';const state={calls:[],payments:[],movements:[],sequence:0,fail:false,students:[
  {id:uuid(1),name:'ANA PAGADA',code:'00123',tickets:[{id:uuid(11),student_id:uuid(1),ticket_number:1001,is_picked_up:false,is_paid:true,paid_amount:15,payment_id:uuid(101),payment_method:'en_momento_yape|prior@example.test',paid_at:version,paid_by_email:'prior@example.test',unit_price:15,assignment_updated_at:version}]},
  {id:uuid(2),name:'BRUNO PENDIENTE',code:'00456',tickets:[1002,1003].map((number,index)=>({id:uuid(12+index),student_id:uuid(2),ticket_number:number,is_picked_up:false,is_paid:false,unit_price:index?20:15,assignment_updated_at:version}))}
 ]};
 const all=()=>state.students.flatMap(person=>person.tickets);
 const stats=()=>({totalTickets:all().length,pickedUp:all().filter(ticket=>ticket.is_picked_up).length,pending:all().filter(ticket=>!ticket.is_picked_up).length,totalStudents:2,pendingStudents:state.students.filter(person=>person.tickets.some(ticket=>!ticket.is_picked_up)).length,collectedTotal:45+state.payments.reduce((sum,p)=>sum+p.amount,0),collectedCashTotal:30+state.payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+p.amount,0),collectedYapeTotal:15+state.payments.filter(p=>p.method==='yape').reduce((sum,p)=>sum+p.amount,0),collectedOtherTotal:0,collectedNow:state.payments.reduce((sum,p)=>sum+p.amount,0),collectedCash:state.payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+p.amount,0),collectedYape:state.payments.filter(p=>p.method==='yape').reduce((sum,p)=>sum+p.amount,0)});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){await route.abort();return;}if(!url.pathname.startsWith('/api/')){await route.continue();return;}
  const method=route.request().method();state.calls.push({path:url.pathname,method});
  if(url.pathname==='/api/stats'){await route.fulfill({json:stats()});return;}
  if(url.pathname==='/api/students'){
   const query=fold(url.searchParams.get('q')||''),status=url.searchParams.get('status')||'all';const students=state.students.filter(person=>(!query||fold(person.name+' '+person.code).includes(query)||person.tickets.some(ticket=>String(ticket.ticket_number)===query))&&(status==='all'||(status==='pending'?person.tickets.some(ticket=>!ticket.is_picked_up):person.tickets.every(ticket=>ticket.is_picked_up))));
   await route.fulfill({json:{students,total:students.length,page:1,hasMore:false}});return;
  }
  if(url.pathname==='/api/tickets'&&method==='GET'){
   const ticket=all().find(ticket=>ticket.ticket_number===Number(url.searchParams.get('number')));await route.fulfill(ticket?{json:{...ticket,student:state.students.find(person=>person.id===ticket.student_id)}}:{status:404,json:{error:'Ticket no encontrado'}});return;
  }
  if(url.pathname==='/api/tickets'&&method==='PATCH'){
   const body=route.request().postDataJSON();const tickets=body.ticketIds.map(id=>all().find(ticket=>ticket.id===id));
   if(state.fail||tickets.some(ticket=>!ticket)||(body.isPickedUp?tickets.some(ticket=>ticket?.is_picked_up||!body.expectedTickets?.some(expected=>expected.id===ticket.id&&expected.updated_at===ticket.assignment_updated_at)):tickets.some(ticket=>!ticket.is_picked_up||ticket.movement_id!==body.expectedMovementId))){
    await route.fulfill({status:409,json:{error:'Los tickets cambiaron. Actualiza la seleccion.'}});return;
   }
   const now=new Date(Date.now()+1000*++state.sequence).toISOString();const id=uuid(500+state.movements.length);const snapshots=[];
   for(const ticket of tickets){const person=state.students.find(person=>person.id===ticket.student_id);const unpaid=!ticket.is_paid;snapshots.push({...ticket,student_name:person.name,student_code:person.code,collected_now:body.isPickedUp&&unpaid&&body.paymentMethod!=='prepaid'?ticket.unit_price:0});
    if(body.isPickedUp&&unpaid){Object.assign(ticket,{is_paid:true,paid_at:now,paid_amount:body.paymentMethod==='prepaid'?0:ticket.unit_price,paid_by_email:'delivery@example.test',payment_id:uuid(800+state.payments.length),payment_method:(({cash:'en_momento_efectivo',yape:'en_momento_yape',prepaid:'prepaid'})[body.paymentMethod])+'|delivery@example.test'});state.payments.push({event_id:ticket.payment_id,ticket_id:ticket.id,kind:'payment',amount:body.paymentMethod==='prepaid'?0:ticket.unit_price,method:body.paymentMethod,source:'delivery',created_at:now,actor_email:'delivery@example.test',snapshot:{...ticket,student_name:person.name,student_code:person.code}});}
    Object.assign(ticket,{is_picked_up:body.isPickedUp,picked_up_at:body.isPickedUp?now:null,picked_up_by:body.isPickedUp?uuid(999):null,movement_id:body.isPickedUp?id:null,assignment_updated_at:now});
   }
   state.movements.unshift({id,kind:body.isPickedUp?'pickup':'undo',created_at:now,actor_email:'delivery@example.test',ticket_ids:body.ticketIds,ticket_snapshots:snapshots,payment_method:({cash:'en_momento_efectivo',yape:'en_momento_yape',prepaid:'prepaid'})[body.paymentMethod]});
   await route.fulfill({json:tickets});return;
  }
  if(url.pathname==='/api/movements'){await route.fulfill({json:state.movements.map(event=>({...event,activeTicketIds:event.kind==='pickup'?event.ticket_ids.filter(id=>all().some(ticket=>ticket.id===id&&ticket.movement_id===event.id)):[]}))});return;}
  if(url.pathname==='/api/export'){await route.fulfill({headers:{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="caja.csv"'},body:deliveryCashCSV({entries:state.payments,summary:stats()},'2026-11-10')});return;}
  await route.fulfill({status:404,json:{error:'Unknown fixture API'}});
 });return state;
}
const ticket=(page,number)=>page.getByTitle(new RegExp('^Ticket #'+number+' -'));
async function confirm(page,method='cash'){
 await page.getByRole('button',{name:'Entregar seleccionados'}).click();const dialog=page.getByRole('dialog',{name:'Confirmar entrega'});if(await dialog.getByRole('group',{name:'Forma de pago',exact:true}).count())await dialog.getByRole('group',{name:'Forma de pago',exact:true}).getByRole('button',{name:({cash:'Efectivo',yape:'Yape',prepaid:'Prepagado'})[method],exact:true}).click();await dialog.getByRole('button',{name:'Confirmar y entregar'}).click();await expect(dialog).not.toBeVisible();
}

test('Delivery is visible on mobile, shows accumulated money separately from today and searches code and name',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Control de entregas'})).toBeVisible();await expect(page.getByRole('link',{name:'Entregas',exact:true})).toHaveAttribute('aria-current','page');
 const cash=page.getByRole('region',{name:'Caja de entregas'});await expect(cash).toContainText('45.00');await expect(cash).toContainText('0.00');const search=page.getByRole('searchbox');await search.fill('00456');await expect(page.getByRole('article',{name:'BRUNO PENDIENTE'})).toBeVisible();await expect(page.getByRole('article',{name:'ANA PAGADA'})).toHaveCount(0);await search.fill('ANA');await expect(page.getByRole('article',{name:'ANA PAGADA'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/ui-preview/delivery-mobile.png',fullPage:true,animations:'disabled'});
});

test('Prepaid delivery preserves money, method, original cashier and date without creating a second payment',async({page})=>{
 const state=await fixture(page);const original={...state.students[0].tickets[0]};await page.goto('/dashboard');await ticket(page,1001).click();await page.getByRole('button',{name:'Entregar seleccionados'}).click();const dialog=page.getByRole('dialog',{name:'Confirmar entrega'});await expect(dialog).toContainText('0.00');await expect(dialog.getByRole('group',{name:'Forma de pago',exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Confirmar y entregar'}).click();await expect(dialog).not.toBeVisible();expect(state.payments).toHaveLength(0);expect(state.students[0].tickets[0].payment_method).toBe(original.payment_method);expect(state.students[0].tickets[0].paid_at).toBe(original.paid_at);await expect(page.getByRole('region',{name:'Caja de entregas'})).toContainText('45.00');
});

for(const method of ['cash','yape'])test(`Mixed ${method} delivery collects only the unpaid ticket and records the selected tickets together`,async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto('/dashboard');await ticket(page,1001).click();await ticket(page,1002).click();await page.getByRole('button',{name:'Entregar seleccionados'}).click();const dialog=page.getByRole('dialog',{name:'Confirmar entrega'});await expect(dialog).toContainText('15.00');await expect(dialog).toContainText('ANA PAGADA');await expect(dialog).toContainText('BRUNO PENDIENTE');const payment=dialog.getByRole('group',{name:'Forma de pago',exact:true});await expect(payment.getByRole('button',{name:'Efectivo',exact:true})).toBeVisible();await expect(payment.getByRole('button',{name:'Yape',exact:true})).toBeVisible();await expect(payment.getByRole('combobox')).toHaveCount(0);await payment.getByRole('button',{name:({cash:'Efectivo',yape:'Yape',prepaid:'Prepagado'})[method],exact:true}).click();await expect(payment.getByRole('button',{name:({cash:'Efectivo',yape:'Yape',prepaid:'Prepagado'})[method],exact:true})).toHaveAttribute('aria-pressed','true');await dialog.screenshot({path:`artifacts/ui-preview/delivery-${method}-confirm-mobile.png`,animations:'disabled'});await dialog.getByRole('button',{name:'Confirmar y entregar'}).click();await expect(dialog).not.toBeVisible();expect(state.payments).toHaveLength(1);expect(state.payments[0].method).toBe(method);expect(state.movements[0].ticket_ids).toHaveLength(2);await expect(page.getByRole('region',{name:'Caja de entregas'})).toContainText('60.00');
});

test('Undoing delivery keeps its payment and redelivery collects nothing again',async({page})=>{
 const state=await fixture(page);await page.goto('/dashboard');await ticket(page,1002).click();await confirm(page);expect(state.payments).toHaveLength(1);await page.goto('/movements');await page.getByRole('button',{name:'Anular 1 ticket(s)',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Anular entrega'});await expect(dialog).toContainText('pagos se conservan');await dialog.getByRole('button',{name:/anular/i}).click();await expect(dialog).not.toBeVisible();expect(state.students[1].tickets[0].is_paid).toBe(true);await page.goto('/dashboard');await ticket(page,1002).click();await confirm(page);expect(state.payments).toHaveLength(1);await expect(page.getByRole('region',{name:'Caja de entregas'})).toContainText('60.00');
});

test('A stale delivery preserves the selection and search and never charges partially',async({page})=>{
 const state=await fixture(page);state.fail=true;await page.goto('/dashboard');const search=page.getByRole('searchbox');await search.fill('BRUNO');await ticket(page,1002).click();await page.getByRole('button',{name:'Entregar seleccionados'}).click();const dialog=page.getByRole('dialog',{name:'Confirmar entrega'});await dialog.getByRole('button',{name:'Confirmar y entregar'}).click();await expect(dialog.getByRole('alert')).toContainText('tickets cambiaron');expect(state.payments).toHaveLength(0);await dialog.getByRole('button',{name:'Cerrar confirmacion de entrega'}).click();await expect(search).toHaveValue('BRUNO');await expect(page.getByRole('region',{name:'Seleccion de entrega'})).toContainText('1 tickets seleccionados');
});

test('Cash CSV exports actual monetary events and accumulated balance rather than charging delivered prepaid tickets again',async({page})=>{
 await fixture(page);await page.goto('/dashboard');await ticket(page,1001).click();await ticket(page,1002).click();await confirm(page,'yape');const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar caja de hoy'}).click();const download=await downloadPromise;const text=await readFile(await download.path(),'utf8');expect(text).toContain('1002');expect(text).toContain('delivery@example.test');expect(text).toMatch(/"Acumulado registrado","60"/);expect(text).not.toMatch(/"1001","ANA/);
});


test('Mobile Prepagado delivers a mixed selection for zero, records the operator and never charges again after undo',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);const original={...state.students[0].tickets[0]};await page.goto('/dashboard');await ticket(page,1001).click();await ticket(page,1002).click();await page.getByRole('button',{name:'Entregar seleccionados'}).click();const dialog=page.getByRole('dialog',{name:'Confirmar entrega'});const payment=dialog.getByRole('group',{name:'Forma de pago'});
 await expect(payment.getByRole('button',{name:'Prepagado',exact:true})).toBeVisible();await expect(dialog).toContainText('Total a cobrar ahora: S/ 15.00');await payment.getByRole('button',{name:'Prepagado',exact:true}).click();await expect(payment.getByRole('button',{name:'Prepagado',exact:true})).toHaveAttribute('aria-pressed','true');await expect(dialog).toContainText('Total a cobrar ahora: S/ 0.00');await expect(dialog.getByRole('note')).toContainText('sin sumar un nuevo ingreso');
 await payment.getByRole('button',{name:'Efectivo',exact:true}).click();await expect(dialog).toContainText('Total a cobrar ahora: S/ 15.00');await payment.getByRole('button',{name:'Prepagado',exact:true}).click();await dialog.screenshot({path:'artifacts/ui-preview/delivery-prepaid-confirm-mobile.png',animations:'disabled'});await dialog.getByRole('button',{name:'Confirmar y entregar'}).click();await expect(dialog).not.toBeVisible();
 expect(state.payments).toHaveLength(1);expect(state.payments[0].amount).toBe(0);expect(state.payments[0].method).toBe('prepaid');expect(state.payments[0].actor_email).toBe('delivery@example.test');expect(state.students[0].tickets[0].payment_id).toBe(original.payment_id);expect(state.students[1].tickets[0].is_paid).toBe(true);await expect(page.getByRole('region',{name:'Caja de entregas'})).toContainText('45.00');
 await page.goto('/movements');await expect(page.getByRole('table')).toContainText('Prepagado; sin cobro nuevo');await expect(page.getByRole('table')).toContainText('delivery@example.test');await page.getByRole('button',{name:'Anular 2 ticket(s)',exact:true}).click();const undo=page.getByRole('dialog',{name:'Anular entrega'});await undo.getByRole('button',{name:/anular/i}).click();await expect(undo).not.toBeVisible();await page.goto('/dashboard');await ticket(page,1002).click();await confirm(page);expect(state.payments).toHaveLength(1);await expect(page.getByRole('region',{name:'Caja de entregas'})).toContainText('45.00');
});
