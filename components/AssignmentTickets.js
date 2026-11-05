'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Pencil, RefreshCw, X } from 'lucide-react';
import TicketEditor from '@/components/TicketEditor';
import { requestJson } from '@/lib/client';
import { parsePayment, TICKET_PRICE } from '@/lib/domain.mjs';
import { formatTicketNumber } from '@/lib/utils';
import styles from './AssignmentTickets.module.css';

export default function AssignmentTickets({ value, onClose, onChanged }) {
  const dialog = useRef(null); const title = useId(); const controller = useRef(null);
  const [tickets, setTickets] = useState([]); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [editing, setEditing] = useState(null);
  const assignmentId = value?.id;
  const refresh = useCallback(async () => {
    if (!assignmentId) return;
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setLoading(true); setError('');
    try {
      const result = await requestJson(`/api/faculty/tickets?${new URLSearchParams({ assignmentId })}`, { signal: current.signal });
      if (!current.signal.aborted && controller.current === current) setTickets(result.tickets);
    } catch (issue) { if (!current.signal.aborted) setError(issue.message); }
    finally { if (controller.current === current) { controller.current = null; if (!current.signal.aborted) setLoading(false); } }
  }, [assignmentId]);
  useEffect(() => {
    if (!assignmentId) { dialog.current?.close(); return; }
    setTickets([]); setMessage(''); setEditing(null); dialog.current.showModal(); refresh();
    return () => { controller.current?.abort(); controller.current = null; };
  }, [assignmentId, refresh]);
  const saved = result => {
    setTickets(current => current.flatMap(ticket => ticket.id !== result.ticket.id ? [ticket]
      : result.action === 'delete' || ['release', 'transfer'].includes(result.action) ? []
        : [{ ...ticket, ...result.ticket }]));
    setMessage(({ pay: 'Pago registrado. La asignación se conserva.', void: 'Pago anulado. El registro anterior se conserva en el historial.',
      update: 'Número corregido.', transfer: 'Ticket reasignado.', release: 'Asignación retirada.', delete: 'Ticket eliminado del reparto activo.' })[result.action] || 'Cambio guardado.');
    onChanged();
  };
  return <>
    <dialog ref={dialog} className={`modal-content confirm-dialog ${styles.dialog}`} aria-labelledby={title}
      onCancel={event => { event.preventDefault(); if (!editing) onClose(); }}>
      <div className={styles.header}><div><h2 id={title}>Editar tickets y pagos</h2><p>{value?.student_name}</p></div>
        <button type="button" className="btn btn-secondary btn-sm" aria-label="Cerrar tickets del historial" disabled={!!editing} onClick={onClose}><X size={17} aria-hidden="true" />Cerrar</button></div>
      <p>Se muestran los tickets que siguen activos en este lote. Cada cambio guardará tu usuario; el registro original de asignación se conserva.</p>
      <button type="button" className={`btn btn-secondary btn-sm ${styles.refresh}`} disabled={loading || !!editing} onClick={refresh}><RefreshCw size={15} />{loading ? 'Actualizando...' : 'Actualizar tickets'}</button>
      {message && <p role="status" className={styles.success}>{message}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {loading && <p role="status">Cargando tickets actuales...</p>}
      {!loading && !error && !tickets.length && <p role="status">Este lote ya no tiene tickets activos. Los tickets retirados, eliminados o reasignados permanecen en el historial.</p>}
      <ul className={styles.tickets} aria-label="Tickets actuales de la asignación" aria-busy={loading}>{tickets.map(ticket => <li key={ticket.id}>
        <div><strong>#{formatTicketNumber(ticket.ticket_number)}</strong><span>{ticket.is_paid ? `Pagado: ${parsePayment(ticket.payment_method).label}` : 'Pendiente de pago'}</span>
          <small>S/ {Number(ticket.is_paid ? ticket.paid_amount ?? ticket.unit_price ?? TICKET_PRICE : ticket.unit_price ?? TICKET_PRICE).toFixed(2)}</small></div>
        <button type="button" className="btn btn-secondary btn-sm" aria-label={`Editar ticket ${ticket.ticket_number}`} disabled={loading || !!editing}
          onClick={() => setEditing({ ticket, student: ticket.student, initialAction: ticket.is_paid ? 'void' : 'pay' })}><Pencil size={15} aria-hidden="true" />Editar / pago</button>
      </li>)}</ul>
    </dialog>
    <TicketEditor value={editing} onClose={() => { setEditing(null); refresh(); }} onSaved={saved} />
  </>;
}
