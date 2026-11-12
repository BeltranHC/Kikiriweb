import { APP_TIME_ZONE, TICKET_PRICE, localDate, parsePayment } from './domain.mjs';
import { ValidationError } from './validation.mjs';
import { stringifyCSV } from './csv.mjs';

export const ANALYTICS_GROUPS = [
  ...Array.from({length:10},(_,i)=>({id:`semester:${i+1}`,label:`${['I','II','III','IV','V','VI','VII','VIII','IX','X'][i]} semestre`})),
  {id:'semester:11',label:'Promoción'},{id:'semester:0',label:'Sin semestre'},
  {id:'external',label:'Externos'},{id:'teacher',label:'Docentes'},{id:'extras',label:'Tickets extra'},{id:'unknown',label:'Sin grupo identificado'},
];
export const PAYMENT_CATEGORIES=[{id:'cash',label:'Efectivo',color:'#16a34a'},{id:'yape',label:'Yape',color:'#8b5cf6'},{id:'prepaid',label:'Prepagado',color:'#2563eb'},{id:'legacy',label:'Previos / otros',color:'#64748b'},{id:'pending',label:'Pendiente de pago',color:'#d97706'}];
const dayAdd=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function analyticsFilters(params,today=localDate()) {
  const from=params.has('from')?params.get('from'):dayAdd(today,-29),to=params.get('to')||today;
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  if((from&&!valid(from))||!valid(to)||(from&&from>to))throw new ValidationError('Revisa el rango de fechas');
  const group=params.get('group')||'all',actor=params.get('actor')||'all';
  if(group!=='all'&&!ANALYTICS_GROUPS.some(item=>item.id===group))throw new ValidationError('Grupo inválido');
  if(actor!=='all'&&actor!=='unknown'&&(actor.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor)))throw new ValidationError('Encargado inválido');
  return {from,to,group,actor};
}
const pct=(n,d)=>d?Math.round(n/d*1000)/10:0;
const cents=value=>{const n=Number(value);if(!Number.isFinite(n))throw new Error('Importe no válido en las estadísticas');return Math.round(n*100);};
const email=value=>value||'unknown';
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:APP_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const groupOf=(student,extra=false)=>extra?'extras':!student?'unknown':student.recipient_type==='external'?'external':student.recipient_type==='teacher'?'teacher':`semester:${student.semester??0}`;
const labelOf=id=>ANALYTICS_GROUPS.find(group=>group.id===id)?.label||'Sin grupo identificado';
const sumMoney=(rows)=>rows.reduce((sum,row)=>sum+cents(row.amount),0)/100;

export function buildAnalytics(source,filters,now=new Date()) {
  if(!source||!['students','tickets','assignments','movements','cash'].every(key=>Array.isArray(source[key])))throw new Error('La fuente de estadísticas está incompleta');
  const dateCache=new Map();
  const date=value=>{if(!value)return null;if(!dateCache.has(value)){const time=Date.parse(value);dateCache.set(value,Number.isFinite(time)?calendar.format(new Date(time)):null);}return dateCache.get(value);};
  const students=new Map(source.students.map(person=>[person.id,person]));
  const tickets=new Map(source.tickets.map(ticket=>[ticket.id,ticket]));
  const matches=(studentId,extra=false)=>filters.group==='all'||groupOf(students.get(studentId),extra)===filters.group;
  const roster=source.students.filter(person=>!person.deleted_at&&matches(person.id));
  const active=source.tickets.filter(ticket=>!ticket.deleted_at&&!ticket.is_available&&((ticket.student_id&&students.has(ticket.student_id)&&!students.get(ticket.student_id).deleted_at)||(!ticket.student_id&&ticket.is_extra))&&matches(ticket.student_id,!ticket.student_id&&ticket.is_extra));
  const byOwner=new Map();for(const ticket of active){const id=ticket.student_id||'extras';if(!byOwner.has(id))byOwner.set(id,[]);byOwner.get(id).push(ticket);}
  const paid=active.filter(ticket=>ticket.is_paid),picked=active.filter(ticket=>ticket.is_picked_up);
  const due=rows=>rows.filter(ticket=>!ticket.is_paid).reduce((sum,ticket)=>sum+cents(ticket.unit_price??TICKET_PRICE),0)/100;
  const summary={participants:roster.length,withTickets:roster.filter(person=>byOwner.has(person.id)).length,tickets:active.length,picked:picked.length,pendingPickup:active.length-picked.length,paid:paid.length,pendingPayment:active.length-paid.length,prepaid:paid.filter(ticket=>parsePayment(ticket.payment_method).method==='prepaid').length,due:due(active)};
  Object.assign(summary,{withoutTickets:summary.participants-summary.withTickets,pickupPct:pct(summary.picked,summary.tickets),paidPct:pct(summary.paid,summary.tickets),coveragePct:pct(summary.withTickets,summary.participants)});
  const payments=PAYMENT_CATEGORIES.map(category=>({...category,count:active.filter(ticket=>!ticket.is_paid?category.id==='pending':category.id===({en_momento_efectivo:'cash',en_momento_yape:'yape',prepaid:'prepaid'})[parsePayment(ticket.payment_method).method]||(ticket.is_paid&&category.id==='legacy'&&!['en_momento_efectivo','en_momento_yape','prepaid'].includes(parsePayment(ticket.payment_method).method))).length}));
  const matrix=[{id:'paid-picked',label:'Pagados y recogidos',paid:true,picked:true},{id:'paid-pending',label:'Pagados sin recoger',paid:true,picked:false},{id:'unpaid-picked',label:'Recogidos sin pagar',paid:false,picked:true},{id:'unpaid-pending',label:'Por pagar y recoger',paid:false,picked:false}].map(cell=>({...cell,count:active.filter(ticket=>!!ticket.is_paid===cell.paid&&!!ticket.is_picked_up===cell.picked).length}));
  const groups=ANALYTICS_GROUPS.map(group=>{const people=roster.filter(person=>groupOf(person)===group.id),rows=active.filter(ticket=>groupOf(students.get(ticket.student_id),!ticket.student_id&&ticket.is_extra)===group.id);return {...group,participants:people.length,withTickets:people.filter(person=>byOwner.has(person.id)).length,tickets:rows.length,picked:rows.filter(ticket=>ticket.is_picked_up).length,paid:rows.filter(ticket=>ticket.is_paid).length,due:due(rows)};}).filter(group=>group.participants||group.tickets||filters.group===group.id);
  for(const group of groups)Object.assign(group,{pending:group.tickets-group.picked,unpaid:group.tickets-group.paid,coveragePct:pct(group.withTickets,group.participants),pickupPct:pct(group.picked,group.tickets),paidPct:pct(group.paid,group.tickets)});
  const cash=source.cash.filter(row=>matches(row.student_id,!!row.is_extra&&!row.student_id));
  const movementRows=source.movements.map(row=>({...row,items:row.items.filter(item=>matches(item.student_id,!!item.is_extra&&!item.student_id))})).filter(row=>row.items.length);
  const assignmentRows=source.assignments.filter(row=>matches(row.student_id));
  const selectedActor=row=>filters.actor==='all'||email(row.actor_email)===filters.actor;
  const allDates=[...cash,...movementRows,...assignmentRows].filter(selectedActor).map(row=>date(row.created_at)).filter(day=>day&&day<=filters.to).sort();
  const from=filters.from||allDates[0]||dayAdd(filters.to,-29);
  const inRange=row=>{const day=date(row.created_at);return day&&day>=from&&day<=filters.to&&selectedActor(row);};
  const periodCash=cash.filter(inRange),periodMoves=movementRows.filter(inRange),periodAssignments=assignmentRows.filter(inRange);
  const days=Math.round((Date.parse(filters.to)-Date.parse(from))/86400000)+1;
  const granularity=days<=90?'day':days<=3650?'month':'year';
  const key=day=>granularity==='day'?day:granularity==='month'?day.slice(0,7):day.slice(0,4);
  const timelineMap=new Map();
  let cursor=granularity==='day'?from:granularity==='month'?from.slice(0,7)+'-01':from.slice(0,4)+'-01-01';
  while(cursor<=filters.to){timelineMap.set(key(cursor),{date:key(cursor),assigned:0,delivered:0,undone:0,cash:0,yape:0,legacy:0,income:0,voided:0,net:0,prepaid:0,cumulative:0});cursor=granularity==='day'?dayAdd(cursor,1):granularity==='month'?new Date(Date.UTC(Number(cursor.slice(0,4)),Number(cursor.slice(5,7)),1)).toISOString().slice(0,10):`${Number(cursor.slice(0,4))+1}-01-01`;}
  const operators=new Map();const operator=row=>{const id=email(row.actor_email);if(!operators.has(id))operators.set(id,{id,label:id==='unknown'?'Sin usuario registrado':id,assigned:0,delivered:0,undone:0,net:0,income:0,voided:0,prepaid:0});return operators.get(id);};
  const hours=Array.from({length:24},(_,hour)=>({hour,label:`${String(hour).padStart(2,'0')}:00`,delivered:0,undone:0}));
  const hourFormat=new Intl.DateTimeFormat('en-GB',{timeZone:APP_TIME_ZONE,hour:'2-digit',hourCycle:'h23'});
  for(const row of periodMoves){const n=row.items.length,field=row.kind==='pickup'?'delivered':'undone';timelineMap.get(key(date(row.created_at)))[field]+=n;operator(row)[field]+=n;hours[Number(hourFormat.format(new Date(row.created_at)))][field]+=n;}
  for(const row of periodAssignments){timelineMap.get(key(date(row.created_at))).assigned+=row.count;operator(row).assigned+=row.count;}
  const sources=[{id:'distribution',label:'Reparto',amount:0},{id:'delivery',label:'Entregas',amount:0},{id:'legacy',label:'Pagos anteriores',amount:0}];
  for(const row of periodCash){const bucket=timelineMap.get(key(date(row.created_at))),op=operator(row),amount=cents(row.amount);bucket.net+=amount;op.net+=amount;const origin=sources.find(item=>item.id===row.source)||sources[2];origin.amount+=amount;
    if(row.method==='prepaid'){if(row.kind==='payment'){bucket.prepaid++;op.prepaid++;}}else{const method=['cash','yape'].includes(row.method)?row.method:'legacy';bucket[method]+=amount;if(row.kind==='void'){bucket.voided+=Math.abs(amount);op.voided+=Math.abs(amount);}else{bucket.income+=amount;op.income+=amount;}}
  }
  let cumulative=cash.filter(row=>selectedActor(row)&&date(row.created_at)&&date(row.created_at)<from).reduce((sum,row)=>sum+cents(row.amount),0);
  const opening=cumulative/100;
  const timeline=[...timelineMap.values()].map(row=>{cumulative+=row.net;return {...row,...Object.fromEntries(['cash','yape','legacy','income','voided','net'].map(field=>[field,row[field]/100])),cumulative:cumulative/100};});
  const operatorList=[...operators.values()].map(row=>({...row,net:row.net/100,income:row.income/100,voided:row.voided/100})).sort((a,b)=>b.delivered-a.delivered||a.label.localeCompare(b.label,'es'));
  const actorIds=[...new Set([...source.cash,...source.movements,...source.assignments].map(row=>email(row.actor_email)))].sort();
  const attention=[...byOwner].map(([id,rows])=>{const person=students.get(id);const pendingPickup=rows.filter(ticket=>!ticket.is_picked_up),pendingPayment=rows.filter(ticket=>!ticket.is_paid);return {id,name:person?.name||'Tickets extra',code:person?.code||'',group:groupOf(person,id==='extras'),groupLabel:labelOf(groupOf(person,id==='extras')),tickets:rows.map(ticket=>ticket.ticket_number).sort((a,b)=>a-b),pendingPickup:pendingPickup.map(ticket=>ticket.ticket_number),pendingPayment:pendingPayment.map(ticket=>ticket.ticket_number),paidPending:pendingPickup.filter(ticket=>ticket.is_paid).map(ticket=>ticket.ticket_number),unpaidPicked:pendingPayment.filter(ticket=>ticket.is_picked_up).map(ticket=>ticket.ticket_number),due:due(rows)};}).filter(row=>row.pendingPickup.length||row.pendingPayment.length).sort((a,b)=>b.due-a.due||b.pendingPickup.length-a.pendingPickup.length||a.name.localeCompare(b.name,'es'));
  const finance={accumulated:sumMoney(cash),cash:sumMoney(cash.filter(row=>row.method==='cash')),yape:sumMoney(cash.filter(row=>row.method==='yape')),other:sumMoney(cash.filter(row=>row.method==='legacy')),undated:sumMoney(cash.filter(row=>!date(row.created_at))),undatedCount:cash.filter(row=>!date(row.created_at)&&Number(row.amount)!==0).length};
  const activity={assigned:periodAssignments.reduce((n,row)=>n+row.count,0),delivered:periodMoves.filter(row=>row.kind==='pickup').reduce((n,row)=>n+row.items.length,0),undone:periodMoves.filter(row=>row.kind==='undo').reduce((n,row)=>n+row.items.length,0),income:sumMoney(periodCash.filter(row=>row.kind==='payment')),voided:-sumMoney(periodCash.filter(row=>row.kind==='void')),net:sumMoney(periodCash),prepaid:periodCash.filter(row=>row.method==='prepaid'&&row.kind==='payment').length};
  return {generatedAt:now.toISOString(),filters:{...filters,effectiveFrom:from,granularity},summary,payments,matrix,groups,finance,activity,timeline,opening,operators:operatorList,hours,sources:sources.map(row=>({...row,amount:row.amount/100})),attention,options:{groups:ANALYTICS_GROUPS,actors:actorIds.map(id=>({id,label:id==='unknown'?'Sin usuario registrado':id}))}};
}

export function analyticsCSV(report){
 const s=report.summary,f=report.finance,a=report.activity;
 const rows=[['KikiriWeb - Estadísticas',report.generatedAt],['Grupo',report.filters.group],['Actividad desde',report.filters.effectiveFrom],['Actividad hasta',report.filters.to],['Encargado (actividad)',report.filters.actor],[],['ESTADO ACTUAL','Cantidad / S/'],
  ['Participantes',s.participants],['Con tickets',s.withTickets],['Sin tickets',s.withoutTickets],['Tickets asignados',s.tickets],['Tickets recogidos',s.picked],['Pendientes de recojo',s.pendingPickup],['Tickets pagados',s.paid],['Pendientes de pago',s.pendingPayment],['Prepagados',s.prepaid],['Por cobrar',s.due],['Ingresos netos acumulados',f.accumulated],['Efectivo acumulado',f.cash],['Yape acumulado',f.yape],['Otros medios anteriores',f.other],['Importe sin fecha conocida',f.undated],[],['ACTIVIDAD DEL PERIODO'],['Tickets asignados (operaciones)',a.assigned],['Entregas (operaciones)',a.delivered],['Anulaciones de entrega',a.undone],['Cobros',a.income],['Anulaciones de pago',a.voided],['Neto',a.net],[],['ESTADO DE PAGO','Tickets'],...report.payments.map(row=>[row.label,row.count]),[],['GRUPO','Participantes','Con tickets','Tickets','Recogidos','Pagados','Por cobrar'],...report.groups.map(row=>[row.label,row.participants,row.withTickets,row.tickets,row.picked,row.paid,row.due]),[],['PERIODO','Asignaciones','Entregas','Anulaciones','Efectivo neto','Yape neto','Otros neto','Neto','Acumulado con fecha'],...report.timeline.map(row=>[row.date,row.assigned,row.delivered,row.undone,row.cash,row.yape,row.legacy,row.net,row.cumulative]),[],['ENCARGADO','Asignaciones','Entregas','Anulaciones','Cobros','Anulaciones pago','Neto'],...report.operators.map(row=>[row.label,row.assigned,row.delivered,row.undone,row.income,row.voided,row.net]),[],['ORIGEN','Importe neto'],...report.sources.map(row=>[row.label,row.amount]),[],['PENDIENTES ACTUALES'],['Nombre','Código','Grupo','Tickets asignados','Sin recoger','Sin pagar','Pagados sin recoger','Recogidos sin pagar','Por cobrar'],...report.attention.map(row=>[row.name,row.code,row.groupLabel,row.tickets.join('; '),row.pendingPickup.join('; '),row.pendingPayment.join('; '),row.paidPending.join('; '),row.unpaidPicked.join('; '),row.due])];
 return stringifyCSV(rows);
}
