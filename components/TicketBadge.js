'use client';

import { Check, Circle } from 'lucide-react';
import { formatTicketNumber } from '@/lib/utils';
import styles from './TicketBadge.module.css';

export default function TicketBadge({ ticket, selected, onToggle, onUndo, disabled = false }) {
  const number = formatTicketNumber(ticket.ticket_number);
  return <button type="button" disabled={disabled} aria-pressed={ticket.is_picked_up ? undefined : !!selected}
    className={`${styles.badge} ${ticket.is_picked_up ? styles.pickedUp : styles.pending} ${selected && !ticket.is_picked_up ? styles.selected : ''}`}
    onClick={() => ticket.is_picked_up ? onUndo?.(ticket.id, number, ticket.movement_id) : onToggle?.(ticket)}
    title={`Ticket #${number} - ${ticket.is_picked_up ? 'Recogido (anular entrega)' : 'Pendiente (seleccionar)'}`}>
    <span className={styles.number}>{number}</span>
    {ticket.is_picked_up ? <Check size={14} aria-hidden="true" /> : selected && <Circle size={10} aria-hidden="true" />}
  </button>;
}
