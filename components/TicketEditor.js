'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import { requestJson, jsonBody } from '@/lib/client';
import { ticketEditInput, ticketIdentityInput, facultyPaymentInput, recipientLabel } from '@/lib/faculty.mjs';
import { parsePayment, TICKET_PRICE, APP_TIME_ZONE } from '@/lib/domain.mjs';
import { useFacultyDirectory } from '@/hooks/useFacultyDirectory';
import styles from './StudentEditor.module.css';
import layout from '@/app/distribution/page.module.css';
const time=new Intl.DateTimeFormat('es-PE',{timeZone:APP_TIME_ZONE,dateStyle:'short',timeStyle:'short'});
export default function TicketEditor({value,onClose,onSaved}) {
  const dialog=useRef(null);const title=useId();
  const [action,setAction]=useState('update');const [number,setNumber]=useState('');const [query,setQuery]=useState('');const [destination,setDestination]=useState(null);
  const [method,setMethod]=useState('cash');const [confirming,setConfirming]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const directory=useFacultyDirectory(query,1,'all',!!value&&action==='transfer'&&query.trim().length>0);
  useEffect(()=>{if(!value){dialog.current?.close();return;}setAction(value.ticket.can_edit?'update':value.ticket.is_paid?'void':'pay');setNumber(String(value.ticket.ticket_number));setQuery('');setDestination(null);setMethod('cash');setConfirming(false);setError('');dialog.current.showModal();},[value]);
  const labels={update:'Guardar corrección',transfer:'Reasignar ticket',release:'Retirar asignación',pay:'Registrar pago',void:'Anular pago',delete:'Eliminar ticket'};
  const ticket=value?.ticket;const amount=Number(ticket?.is_paid ? ticket.paid_amount ?? ticket.unit_price ?? TICKET_PRICE : ticket?.unit_price ?? TICKET_PRICE).toFixed(2);
  const submit=async event=>{
    event.preventDefault();if(busy)return;setError('');
    if(['void','delete'].includes(action)&&!confirming){setConfirming(true);return;}
    try {
      const identity={ticketId:ticket.id,studentId:value.student.id,expectedUpdatedAt:ticket.assignment_updated_at};let input;let url;let verb='PATCH';
      if(['pay','void'].includes(action)){input=facultyPaymentInput({...identity,action,method});url='/api/faculty/payments';}
      else if(action==='delete'){input=ticketIdentityInput(identity);url='/api/faculty/tickets';verb='DELETE';}
      else{input=ticketEditInput({...identity,action,ticketNumber:number,destinationId:destination?.id});url='/api/faculty/tickets';}
      setBusy(true);const result=await requestJson(url,jsonBody(verb,input));onSaved(result);onClose();
    }catch(issue){setError(issue.message);setConfirming(false);}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className={`modal-content confirm-dialog ${styles.dialog}`} aria-labelledby={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <div className={`confirm-header ${styles.header}`}><h2 id={title}>Editar ticket #{ticket?.ticket_number}</h2><button type="button" className={`btn btn-secondary btn-sm ${styles.closeButton}`} aria-label="Cerrar editor de ticket" disabled={busy} onClick={onClose}><X size={17} aria-hidden="true" />Cerrar</button></div>
    <form onSubmit={submit} className={styles.form}>
      <p>Asignado a {value?.student.name}. Cada cambio guardará tu usuario y los datos anteriores.</p>
      <p className={layout.ticketState}><strong>{ticket?.is_paid ? `Pagado: ${parsePayment(ticket.payment_method).label}` : 'Pendiente de pago'}</strong><span>S/ {amount}</span>{ticket?.paid_at&&<small>{time.format(new Date(ticket.paid_at))} \u00b7 {ticket.paid_by_email||parsePayment(ticket.payment_method).email}</small>}</p>
      <div className="input-group"><label htmlFor="ticket-action">Operación</label><select id="ticket-action" className="input-field" value={action} onChange={event=>{setAction(event.target.value);setConfirming(false);setError('');}} disabled={busy}>
        <option value="update" disabled={!ticket?.can_edit}>Corregir número</option><option value="transfer" disabled={!ticket?.can_edit}>Reasignar a otra persona</option><option value="release" disabled={!ticket?.can_edit}>Retirar asignación</option>
        <option value="pay" disabled={ticket?.is_paid}>Registrar pago</option><option value="void" disabled={!ticket?.is_paid}>Anular pago</option><option value="delete" disabled={ticket?.is_paid}>Eliminar ticket</option>
      </select></div>
      {action==='update'&&<div className="input-group"><label htmlFor="corrected-ticket-number">Nuevo número de ticket</label><input id="corrected-ticket-number" className="input-field" inputMode="numeric" value={number} onChange={event=>setNumber(event.target.value)} disabled={busy} required /></div>}
      {action==='pay'&&<div className="input-group"><label htmlFor="ticket-payment-method">Medio de pago</label><select id="ticket-payment-method" className="input-field" value={method} onChange={event=>setMethod(event.target.value)} disabled={busy}><option value="cash">Efectivo</option><option value="yape">Yape</option></select><p>Registrar el pago de este ticket por S/ {amount}.</p></div>}
      {action==='transfer'&&<><div className="input-group"><label htmlFor="ticket-destination-search">Buscar nuevo destinatario</label><input id="ticket-destination-search" className="input-field" value={query} maxLength={200} onChange={event=>{setQuery(event.target.value);setDestination(null);}} disabled={busy} placeholder="Nombre o código" /></div>
        {query.trim()&&<div className={layout.recipientOptions} aria-label="Destinatarios encontrados">{directory.loading?<p>Buscando...</p>:directory.students.filter(person=>person.id!==value?.student.id).map(person=><button type="button" key={person.id} className={`btn ${destination?.id===person.id?'btn-primary':'btn-secondary'}`} onClick={()=>setDestination(person)} disabled={busy}>{person.name} \u00b7 {person.code||recipientLabel(person)}</button>)}</div>}
        {directory.error&&<p role="alert">{directory.error}</p>}{destination&&<p>Nuevo destinatario: <strong>{destination.name}</strong></p>}</>}
      {action==='release'&&<p>El ticket quedará disponible para asignarlo a otra persona. Se conservarán su registro y las asignaciones anteriores.</p>}
      {action==='void'&&<p>Anular el registro de pago por S/ {amount}. El ticket conservará su asignación y el pago anterior quedará en el historial.</p>}
      {action==='delete'&&<p>Se retirará este ticket de la persona. Se conservarán el registro y su historial. Los números con entregas anteriores no se reutilizarán.</p>}
      {confirming&&<p role="status" className={layout.warning}>{action==='void'?'Confirma que quieres anular este pago.':'Confirma que quieres eliminar este ticket.'}</p>}
      {error&&<p role="alert" className="text-danger">{error}</p>}
      <div className="confirm-actions"><button type="button" className="btn btn-secondary" onClick={()=>confirming?setConfirming(false):onClose()} disabled={busy}>Cancelar</button><button className={`btn ${['void','delete'].includes(action)?'btn-danger':'btn-primary'}`} disabled={busy||(action==='transfer'&&!destination)}><Save size={16} />{busy?'Guardando...':confirming?(action==='void'?'Confirmar anulación':'Confirmar eliminación'):labels[action]}</button></div>
    </form>
  </dialog>;
}
