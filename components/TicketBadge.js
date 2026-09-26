'use client';

import { formatTicketNumber } from '@/lib/utils';
import styles from './TicketBadge.module.css';

export default function TicketBadge({ ticket, selected, onToggle, onUndo }) {
  const isPickedUp = ticket.is_picked_up;
  const formattedNumber = formatTicketNumber(ticket.ticket_number);

  return (
    <button
      className={`${styles.badge} ${isPickedUp ? styles.pickedUp : styles.pending} ${
        selected ? styles.selected : ''
      }`}
      onClick={() => {
        if (isPickedUp) {
          onUndo && onUndo(ticket.id, formattedNumber);
        } else {
          onToggle && onToggle(ticket);
        }
      }}
      title={
        isPickedUp
          ? `Ticket #${formattedNumber} - Recogido (Click para deshacer)`
          : `Ticket #${formattedNumber} - Pendiente (Click para seleccionar)`
      }
    >
      <span className={styles.number}>{formattedNumber}</span>
      {isPickedUp && <span className={styles.checkIcon}>✓</span>}
      {selected && !isPickedUp && <span className={styles.selectIcon}>●</span>}
    </button>
  );
}

