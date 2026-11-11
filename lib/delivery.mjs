import { validateUuid, ValidationError } from './validation.mjs';
import { TICKET_PRICE, APP_TIME_ZONE, parsePayment } from './domain.mjs';
import { stringifyCSV } from './csv.mjs';
export function deliverySelection(tickets) {
 const unpaid=tickets.filter(ticket=>!ticket.is_paid);return {count:tickets.length,prepaid:tickets.length-unpaid.length,unpaid:unpaid.length,total:unpaid.reduce((sum,ticket)=>sum+Math.round(Number(ticket.unit_price??TICKET_PRICE)*100),0)/100};
}
export function deliveryInput(body) {
 if(!body||typeof body.isPickedUp!=='boolean'||!Array.isArray(body.ticketIds)||body.ticketIds.length<1||body.ticketIds.length>2000)throw new ValidationError('Entrega invalida');
 const ticketIds=body.ticketIds.map(validateUuid);if(new Set(ticketIds.map(id=>id.toLowerCase())).size!==ticketIds.length)throw new ValidationError('Tickets repetidos');
 if(!body.isPickedUp)return {ticketIds,isPickedUp:false,expectedMovementId:validateUuid(body.expectedMovementId)};
 if(body.paymentMethod!=null&&!['cash','yape','prepaid'].includes(body.paymentMethod))throw new ValidationError('Indica efectivo, Yape o Prepagado');
 if(!Array.isArray(body.expectedTickets)||body.expectedTickets.length!==ticketIds.length)throw new ValidationError('Actualiza los tickets antes de entregar');
 const expectedTickets=body.expectedTickets.map(ticket=>{const id=validateUuid(ticket?.id);if(typeof ticket.updated_at!=='string'||!Number.isFinite(Date.parse(ticket.updated_at)))throw new ValidationError('Version invalida');return{id,updated_at:ticket.updated_at};});
 if(new Set(expectedTickets.map(ticket=>ticket.id.toLowerCase())).size!==ticketIds.length||expectedTickets.some(ticket=>!ticketIds.some(id=>id.toLowerCase()===ticket.id.toLowerCase())))throw new ValidationError('Seleccion invalida');
 return{ticketIds,isPickedUp:true,paymentMethod:body.paymentMethod??null,expectedTickets};
}
export function deliveryCashCSV(report,day) {
 const rows=[['Ticket','Participante','Codigo','Operacion','Origen','Medio','Importe (S/)','Fecha y hora Lima','Usuario']];
 for(const entry of report.entries){const ticket=entry.snapshot||{};rows.push([ticket.ticket_number,ticket.student_name||(ticket.is_extra?'Ticket extra':''),ticket.student_code||ticket.code||'',entry.kind==='void'?'Anulacion de pago':'Pago',({distribution:'Reparto',delivery:'Entregas',legacy:'Anterior'})[entry.source]||'Sin especificar',({cash:'Efectivo',yape:'Yape',prepaid:'Prepagado',legacy:'Previo / sin medio'})[entry.method],entry.amount,entry.created_at?new Date(entry.created_at).toLocaleString('es-PE',{timeZone:APP_TIME_ZONE}):'Sin fecha registrada',entry.actor_email||'Sin usuario registrado']);}
 const s=report.summary;rows.push([],['RESUMEN',day],['Neto del dia',s.collectedNow],['Efectivo del dia',s.collectedCash],['Yape del dia',s.collectedYape],['Acumulado registrado',s.collectedTotal],['Acumulado efectivo',s.collectedCashTotal],['Acumulado Yape',s.collectedYapeTotal],['Otros medios previos',s.collectedOtherTotal],['Pagos antiguos sin fecha',s.legacyWithoutDate]);return stringifyCSV(rows);
}
export function deliveryMovementTotal(event) {
 if(event.kind==='undo')return 0;
 return Math.round(event.ticket_snapshots.reduce((sum,ticket)=>{if('collected_now'in ticket)return sum+Number(ticket.collected_now);const method=parsePayment(ticket.payment_method||event.payment_method);return sum+(method.isCash||method.isYape?Number(ticket.unit_price??TICKET_PRICE):0);},0)*100)/100;
}
