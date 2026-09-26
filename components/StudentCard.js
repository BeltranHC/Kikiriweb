'use client';

import { useState } from 'react';
import TicketGrid from './TicketGrid';
import { percentage } from '@/lib/utils';
import { GraduationCap, IdCard, Ticket, ChevronDown } from 'lucide-react';
import styles from './StudentCard.module.css';

export default function StudentCard({ student, onPickUp, onUndoPickUp }) {
  const [expanded, setExpanded] = useState(false);

  const tickets = student.tickets || [];
  const pickedUp = tickets.filter((t) => t.is_picked_up).length;
  const total = tickets.length;
  const pct = percentage(pickedUp, total);

  return (
    <div className={`${styles.card} animate-fade-in`}>
      {/* Card Header */}
      <div
        className={styles.cardHeader}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
      >
        <div className={styles.studentInfo}>
          <div className={styles.avatar}>
            {student.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className={styles.details}>
            <h3 className={styles.name}>{student.name}</h3>
            <div className={styles.meta}>
              {student.code && (
                <span className={styles.metaItem}>
                  <GraduationCap size={14} className="inline-icon" /> {student.code}
                </span>
              )}
              {student.dni && (
                <span className={styles.metaItem}>
                  <IdCard size={14} className="inline-icon" /> {student.dni}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.cardRight}>
          <div className={styles.progressSection}>
            <div className={styles.progressInfo}>
              <span className={styles.progressText}>
                {pickedUp}/{total}
              </span>
              <span className={`badge ${pct === 100 ? 'badge-success' : 'badge-warning'}`}>
                {pct}%
              </span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <span className={`${styles.expandIcon} ${expanded ? styles.expanded : ''}`}>
            <ChevronDown size={20} />
          </span>
        </div>
      </div>

      {/* Expandable Ticket Grid */}
      {expanded && (
        <div className={styles.cardBody}>
          {tickets.length > 0 ? (
            <TicketGrid
              tickets={tickets}
              onPickUp={(ticketIds, paymentMethod) => onPickUp(student.id, ticketIds, paymentMethod)}
              onUndoPickUp={(ticketId, ticketNumber) => onUndoPickUp && onUndoPickUp(student.id, ticketId, ticketNumber)}
            />
          ) : (
            <div className="empty-state">
              <span className="empty-state-icon"><Ticket size={32} /></span>
              <p>No hay tickets asignados</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
