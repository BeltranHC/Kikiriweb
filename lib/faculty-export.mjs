import { stringifyCSV } from './csv.mjs';
import { fetchAll } from './pagination.mjs';
import { RECIPIENT_TYPES,SEMESTERS,PROMOTION_SEMESTER } from './faculty.mjs';
import { APP_TIME_ZONE, parsePayment, TICKET_PRICE } from './domain.mjs';

export function participantReport(participants,tickets) {
  const byParticipant=new Map();
  for(const ticket of tickets) {
    if(!ticket.student_id||ticket.is_available||ticket.deleted_at) continue;
    if(!byParticipant.has(ticket.student_id)) byParticipant.set(ticket.student_id,[]);
    byParticipant.get(ticket.student_id).push(ticket);
  }
  const categoryRank={student:0,external:1,teacher:2};
  const sorted=participants.filter(person=>!person.deleted_at).sort((a,b)=>(categoryRank[a.recipient_type||'student']-categoryRank[b.recipient_type||'student'])||
    ((a.semester??12)-(b.semester??12))||a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
  const rows=[['ID_participante','Nombre_completo','Codigo','DNI','Categoria','Semestre','Escuela_profesional','Cantidad_tickets','Tickets_asignados','Ultima_modificacion_Lima','Modificado_por','Cantidad_tickets_pagados','Cantidad_tickets_pendientes','Tickets_pagados_efectivo','Tickets_pagados_Yape','Tickets_pagados_otros','Tickets_pendientes_pago','Importe_pagado']];
  for(const person of sorted) {
    const assigned=(byParticipant.get(person.id)||[]).sort((a,b)=>a.ticket_number-b.ticket_number);
    const numbers=assigned.map(ticket=>ticket.ticket_number),paid=assigned.filter(ticket=>ticket.is_paid),pending=assigned.filter(ticket=>!ticket.is_paid);
    const paidNumbers=method=>paid.filter(ticket=>method==='other'?!parsePayment(ticket.payment_method).isCash&&!parsePayment(ticket.payment_method).isYape:method==='cash'?parsePayment(ticket.payment_method).isCash:parsePayment(ticket.payment_method).isYape).map(ticket=>ticket.ticket_number).join('; ');
    const paidTotal=paid.reduce((sum,ticket)=>sum+Math.round(Number(ticket.paid_amount??ticket.unit_price??TICKET_PRICE)*100),0)/100;
    const semester=(person.recipient_type||'student')!=='student'?'':person.semester===PROMOTION_SEMESTER?'Promoción':SEMESTERS[person.semester-1]||'';
    rows.push([person.id,person.name,person.code||'',person.dni||'',RECIPIENT_TYPES[person.recipient_type||'student'],semester,person.school||'',numbers.length,numbers.join('; '),
      person.roster_updated_at?new Date(person.roster_updated_at).toLocaleString('es-PE',{timeZone:APP_TIME_ZONE,hour12:false}):'',person.roster_updated_by_email||'',paid.length,pending.length,paidNumbers('cash'),paidNumbers('yape'),paidNumbers('other'),pending.map(ticket=>ticket.ticket_number).join('; '),paidTotal.toFixed(2)]);
  }
  return stringifyCSV(rows);
}

export async function loadParticipantExport(supabase) {
  // Fetch both tables separately so a nested ticket relationship cannot truncate a large allocation.
  const [participants,tickets]=await Promise.all([
    fetchAll(()=>supabase.from('students').select('id,name,code,dni,semester,school,recipient_type,roster_updated_at,roster_updated_by_email,deleted_at').is('deleted_at',null).order('id')),
    fetchAll(()=>supabase.from('tickets').select('id,ticket_number,student_id,is_available,deleted_at,is_paid,payment_method,unit_price,paid_amount').is('deleted_at',null).not('student_id','is',null).eq('is_available',false).order('id')),
  ]);
  return participantReport(participants,tickets);
}
