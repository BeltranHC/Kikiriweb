'use client';

import { useState, useEffect } from 'react';
import TicketBadge from './TicketBadge';
import { Check, Clock, CheckCircle, Banknote } from 'lucide-react';
import { TICKET_PRICE } from '@/lib/domain.mjs';
import styles from './TicketGrid.module.css';

export default function TicketGrid({
  tickets,
  selectedIds: propSelectedIds,
  onToggleTicket,
  onPickUp,
  onUndoPickUp,
  hidePickupBar = false,
}) {
  const [localSelectedIds, setLocalSelectedIds] = useState([]);
  const isControlled = propSelectedIds !== undefined;
  const selectedIds = isControlled ? propSelectedIds : localSelectedIds;

  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('en_momento_efectivo');
  const pending = tickets.filter(ticket => !ticket.is_picked_up);
  const selected = pending.filter(ticket => selectedIds.includes(ticket.id));
  const amount = Math.round(selected.reduce((total, ticket) => total + Number(ticket.unit_price ?? TICKET_PRICE), 0) * 100) / 100;

  useEffect(() => {
    if (!isControlled) {
      setLocalSelectedIds(previous => {
        const next = previous.filter(id => tickets.some(ticket => ticket.id === id && !ticket.is_picked_up));
        return next.length === previous.length ? previous : next;
      });
    }
  }, [tickets, isControlled]);

  const toggle = ticket => {
    if (onToggleTicket) {
      onToggleTicket(ticket);
    } else {
      setShowPayment(false);
      setLocalSelectedIds(previous => previous.includes(ticket.id) ? previous.filter(id => id !== ticket.id) : [...previous, ticket.id]);
    }
  };

  const handleSelectAll = () => {
    setShowPayment(false);
    if (onToggleTicket) {
      const allSelected = pending.every(ticket => selectedIds.includes(ticket.id));
      pending.forEach(ticket => {
        const isCurrentSelected = selectedIds.includes(ticket.id);
        if (allSelected && isCurrentSelected) {
          onToggleTicket(ticket);
        } else if (!allSelected && !isCurrentSelected) {
          onToggleTicket(ticket);
        }
      });
    } else {
      setLocalSelectedIds(selected.length === pending.length ? [] : pending.map(ticket => ticket.id));
    }
  };

  const pickup = async () => {
    if (!selected.length || loading) return;
    setLoading(true);
    try {
      await onPickUp(selected.map(ticket => ticket.id), paymentMethod);
      if (!isControlled) setLocalSelectedIds([]);
      setShowPayment(false);
    } catch { /* The parent displays the error; keep the selection for retry. */ }
    finally { setLoading(false); }
  };

  const methods = [
    ['en_momento_efectivo', 'Efectivo'], ['en_momento_yape', 'Yape'], ['previo', 'Ya pagado'],
  ];

  return <div className={styles.gridContainer} data-ticket-selection={selected.length > 0 ? 'true' : 'false'} data-mutation-pending={loading ? 'true' : 'false'}>
    <div className={styles.gridHeader}>
      <div className={styles.gridStats}>
        <span className="badge badge-success"><Check size={14} /> {tickets.length - pending.length} recogidos</span>
        <span className="badge badge-warning"><Clock size={14} /> {pending.length} pendientes</span>
      </div>
      {pending.length > 0 && <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={handleSelectAll}>
        {selected.length === pending.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
      </button>}
    </div>
    <div className={styles.grid}>{[...tickets].sort((a, b) => a.ticket_number - b.ticket_number).map(ticket =>
      <TicketBadge key={ticket.id} ticket={ticket} selected={selectedIds.includes(ticket.id)} disabled={loading} onToggle={toggle} onUndo={onUndoPickUp} />
    )}</div>
    {!hidePickupBar && selected.length > 0 && <div className={styles.pickupBar}>{showPayment ? <div className={styles.paymentSection}>
      <div className={styles.paymentHeader}>
        <span className={styles.paymentTotal}>Total a cobrar: <strong>S/ {paymentMethod === 'previo' ? 0 : amount}</strong></span>
        <div className={styles.paymentOptions} role="group" aria-label="Método de pago">
          {methods.map(([value, label]) => <button key={value} type="button" disabled={loading} aria-pressed={paymentMethod === value}
            className={`${styles.paymentPill} ${paymentMethod === value ? styles.active : ''}`} onClick={() => setPaymentMethod(value)}>
            <span><Banknote size={14} className="inline-icon" /> {label}</span><strong>{value === 'previo' ? 'Pre-venta' : `S/ ${amount}`}</strong>
          </button>)}
        </div>
      </div>
      <div className={styles.paymentActions}>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setShowPayment(false)}>Cancelar</button>
        <button type="button" className="btn btn-success" disabled={loading} onClick={pickup}><CheckCircle size={16} /> {loading ? 'Registrando...' : 'Confirmar recojo'}</button>
      </div>
    </div> : <><span className={styles.pickupCount}>{selected.length} ticket(s) seleccionado(s)</span>
      <button type="button" className="btn btn-success" onClick={() => setShowPayment(true)}>Siguiente <CheckCircle size={16} /></button></>}</div>}
  </div>;
}
