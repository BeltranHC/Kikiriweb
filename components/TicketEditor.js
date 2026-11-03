'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import { requestJson,jsonBody } from '@/lib/client';
import { ticketEditInput,recipientLabel } from '@/lib/faculty.mjs';
import { useFacultyDirectory } from '@/hooks/useFacultyDirectory';
import styles from './StudentEditor.module.css';
import layout from '@/app/distribution/page.module.css';
export default function TicketEditor({value,onClose,onSaved}) {
  const dialog=useRef(null);const title=useId();
  const [action,setAction]=useState('update');const [number,setNumber]=useState('');const [query,setQuery]=useState('');const [destination,setDestination]=useState(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const directory=useFacultyDirectory(query,1,'all',!!value&&action==='transfer'&&query.trim().length>0);
  useEffect(()=>{if(!value){dialog.current?.close();return;}setAction('update');setNumber(String(value.ticket.ticket_number));setQuery('');setDestination(null);setError('');dialog.current.showModal();},[value]);
  const submit=async event=>{
    event.preventDefault();if(busy)return;setError('');
    try {
      const input=ticketEditInput({action,ticketId:value.ticket.id,studentId:value.student.id,ticketNumber:number,destinationId:destination?.id,expectedUpdatedAt:value.ticket.assignment_updated_at});
      setBusy(true);const result=await requestJson('/api/faculty/tickets',jsonBody('PATCH',input));onSaved(result);onClose();
    }catch(issue){setError(issue.message);}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className={`modal-content confirm-dialog ${styles.dialog}`} aria-labelledby={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <div className={`confirm-header ${styles.header}`}><h2 id={title}>Editar ticket #{value?.ticket.ticket_number}</h2><button type="button" className={`btn btn-secondary btn-sm ${styles.closeButton}`} aria-label="Cerrar editor de ticket" disabled={busy} onClick={onClose}><X size={17} aria-hidden="true" />Cerrar</button></div>
    <form onSubmit={submit} className={styles.form}>
      <p>Asignado a {value?.student.name}. Cada cambio guardará tu usuario y los datos anteriores.</p>
      <div className="input-group"><label htmlFor="ticket-action">Operación</label><select id="ticket-action" className="input-field" value={action} onChange={event=>{setAction(event.target.value);setError('');}} disabled={busy}><option value="update">Corregir número</option><option value="transfer">Reasignar a otra persona</option><option value="release">Retirar asignación</option></select></div>
      {action==='update'&&<div className="input-group"><label htmlFor="corrected-ticket-number">Nuevo número de ticket</label><input id="corrected-ticket-number" className="input-field" inputMode="numeric" value={number} onChange={event=>setNumber(event.target.value)} disabled={busy} required /></div>}
      {action==='transfer'&&<><div className="input-group"><label htmlFor="ticket-destination-search">Buscar nuevo destinatario</label><input id="ticket-destination-search" className="input-field" value={query} maxLength={200} onChange={event=>{setQuery(event.target.value);setDestination(null);}} disabled={busy} placeholder="Nombre o código" /></div>
        {query.trim()&&<div className={layout.recipientOptions} aria-label="Destinatarios encontrados">{directory.loading?<p>Buscando...</p>:directory.students.filter(person=>person.id!==value?.student.id).map(person=><button type="button" key={person.id} className={`btn ${destination?.id===person.id?'btn-primary':'btn-secondary'}`} onClick={()=>setDestination(person)} disabled={busy}>{person.name} · {person.code||recipientLabel(person)}</button>)}</div>}
        {directory.error&&<p role="alert">{directory.error}</p>}{destination&&<p>Nuevo destinatario: <strong>{destination.name}</strong></p>}</>}
      {action==='release'&&<p>El ticket quedará disponible para asignarlo a otra persona. Se conservarán su registro y las asignaciones anteriores.</p>}
      {error&&<p role="alert" className="text-danger">{error}</p>}
      <div className="confirm-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" disabled={busy||(action==='transfer'&&!destination)}><Save size={16} />{busy?'Guardando...':action==='transfer'?'Reasignar ticket':action==='release'?'Retirar asignación':'Guardar corrección'}</button></div>
    </form>
  </dialog>;
}
