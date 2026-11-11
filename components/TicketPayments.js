'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import { requestJson, jsonBody } from '@/lib/client';
import { batchPaymentInput, paymentSelection } from '@/lib/ticket-payments.mjs';
import { parsePayment } from '@/lib/domain.mjs';
import PaymentOptions from './PaymentOptions';
import styles from './TicketPayments.module.css';

export default function TicketPayments({ value, onClose, onSaved }) {
  const dialog = useRef(null); const title = useId();
  const [ids,setIds] = useState([]); const [condition,setCondition] = useState('cash');
  const [confirming,setConfirming] = useState(false); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const tickets = useMemo(() => value?.tickets || [],[value]);
  const summary = useMemo(() => paymentSelection(tickets,ids,condition),[tickets,ids,condition]);
  useEffect(() => { if (!value) { dialog.current?.close(); return; } setIds([]);setCondition('cash');setConfirming(false);setError('');dialog.current.showModal(); },[value]);
  const reset = () => { setConfirming(false);setError(''); };
  const toggle = id => { reset();setIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current,id]); };
  const submit = async event => {
    event.preventDefault();if (busy || !summary.changing.length) return;
    if (!confirming) { setConfirming(true);return; }
    setBusy(true);setError('');
    try {
      const input = batchPaymentInput({ studentId:value.student.id, tickets:summary.selected.map(ticket => ({id:ticket.id,updated_at:ticket.assignment_updated_at})),condition,expectedTotal:summary.total });
      const result = await requestJson('/api/faculty/payments',jsonBody('PATCH',input));onSaved(result);onClose();
    } catch (issue) { setError(issue.message);setConfirming(false); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className={`modal-content confirm-dialog ${styles.dialog}`} aria-labelledby={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <div className={styles.header}><div><h2 id={title}>Pago de varios tickets</h2><p>{value?.student.name}</p></div><button type="button" className="btn btn-secondary btn-sm" aria-label="Cerrar pago de varios tickets" disabled={busy} onClick={onClose}><X size={17} />Cerrar</button></div>
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.selection}><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>{reset();setIds(tickets.filter(ticket=>!ticket.is_paid).map(ticket=>ticket.id));}}>Seleccionar pendientes</button><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>{reset();setIds([]);}}>Limpiar selección</button></div>
      <fieldset className={styles.tickets} disabled={busy}><legend>Tickets de esta persona</legend>{tickets.map(ticket=><label key={ticket.id}><input type="checkbox" checked={ids.includes(ticket.id)} onChange={()=>toggle(ticket.id)} aria-label={`Seleccionar ticket ${ticket.ticket_number}`} /><span><strong>#{ticket.ticket_number}</strong><small>{ticket.is_paid ? `Pagado: ${parsePayment(ticket.payment_method).label}` : 'Pendiente de pago'}</small></span></label>)}</fieldset>
      <PaymentOptions label="Estado de los tickets seleccionados" value={condition} onChange={method=>{reset();setCondition(method);}} disabled={busy} allowPending />
      <div role="status" className={styles.total}><strong>{summary.selected.length} tickets seleccionados</strong><span>{summary.changing.length} {condition==='pending'?'pagos por anular':'tickets por pagar'}</span><b>{condition==='pending'?'Total por anular':'Total a pagar'}: S/ {summary.total.toFixed(2)}</b>{summary.unchanged>0&&<small>{summary.unchanged} sin cambios: {condition==='pending'?'ya estaban pendientes':'ya estaban pagados y no se cobrarán otra vez'}.</small>}</div>
      {condition==='pending'&&<p>Al confirmar se anularán los pagos seleccionados. Se conservarán las asignaciones y el historial de cada pago.</p>}
      {condition!=='pending'&&<p>El medio elegido se aplicará a los tickets pendientes. Para cambiar el medio de un pago anterior, déjalo pendiente primero.</p>}
      {confirming&&<p className={styles.warning} role="alert">Confirma {condition==='pending'?'la anulación de':'el pago de'} {summary.changing.length} tickets por S/ {summary.total.toFixed(2)}{condition==='pending'?'':condition==='cash'?' en efectivo':' con Yape'}. Se guardará tu usuario.</p>}
      {error&&<p role="alert" className="text-danger">{error}</p>}
      <div className="confirm-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>confirming?setConfirming(false):onClose()}>Cancelar</button><button className={`btn ${condition==='pending'?'btn-danger':'btn-primary'}`} disabled={busy||!summary.changing.length}><Save size={16}/>{busy?'Guardando...':confirming?condition==='pending'?'Confirmar pendientes':'Confirmar pago conjunto':'Revisar cambios'}</button></div>
    </form>
  </dialog>;
}
