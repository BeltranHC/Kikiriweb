import { stringifyCSV } from './csv.mjs';
import { fetchAll } from './pagination.mjs';
import { RECIPIENT_TYPES,SEMESTERS,PROMOTION_SEMESTER } from './faculty.mjs';
import { APP_TIME_ZONE } from './domain.mjs';

export function participantReport(participants,tickets) {
  const byParticipant=new Map();
  for(const ticket of tickets) {
    if(!ticket.student_id||ticket.is_available) continue;
    if(!byParticipant.has(ticket.student_id)) byParticipant.set(ticket.student_id,[]);
    byParticipant.get(ticket.student_id).push(ticket.ticket_number);
  }
  const categoryRank={student:0,external:1,teacher:2};
  const sorted=[...participants].sort((a,b)=>(categoryRank[a.recipient_type||'student']-categoryRank[b.recipient_type||'student'])||
    ((a.semester??12)-(b.semester??12))||a.name.localeCompare(b.name,'es')||a.id.localeCompare(b.id));
  const rows=[['ID_participante','Nombre_completo','Codigo','DNI','Categoria','Semestre','Escuela_profesional','Cantidad_tickets','Tickets_asignados','Ultima_modificacion_Lima','Modificado_por']];
  for(const person of sorted) {
    const numbers=(byParticipant.get(person.id)||[]).sort((a,b)=>a-b);
    const semester=(person.recipient_type||'student')!=='student'?'':person.semester===PROMOTION_SEMESTER?'Promoción':SEMESTERS[person.semester-1]||'';
    rows.push([person.id,person.name,person.code||'',person.dni||'',RECIPIENT_TYPES[person.recipient_type||'student'],semester,person.school||'',numbers.length,numbers.join('; '),
      person.roster_updated_at?new Date(person.roster_updated_at).toLocaleString('es-PE',{timeZone:APP_TIME_ZONE,hour12:false}):'',person.roster_updated_by_email||'']);
  }
  return stringifyCSV(rows);
}

export async function loadParticipantExport(supabase) {
  // Fetch both tables separately so a nested ticket relationship cannot truncate a large allocation.
  const [participants,tickets]=await Promise.all([
    fetchAll(()=>supabase.from('students').select('id,name,code,dni,semester,school,recipient_type,roster_updated_at,roster_updated_by_email').order('id')),
    fetchAll(()=>supabase.from('tickets').select('id,ticket_number,student_id,is_available').not('student_id','is',null).eq('is_available',false).order('id')),
  ]);
  return participantReport(participants,tickets);
}
