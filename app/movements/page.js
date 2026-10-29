'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { History, RefreshCw, Undo2 } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { requestJson, jsonBody } from '@/lib/client';
import { useSearchState } from '@/hooks/useSearchState';
import { SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';
import { parsePayment, summarizePayments, APP_TIME_ZONE } from '@/lib/domain.mjs';
import { formatTicketNumber } from '@/lib/utils';
import styles from './page.module.css';

export default function MovementsPage() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const { query, setQuery } = useSearchState('movements');
  const [undo, setUndo] = useState(null);
  const toast = useToast();
  const refresh = useCallback(async signal => {
    try { setMovements(await requestJson('/api/movements', { signal })); }
    catch (error) { if (!signal?.aborted) toast.error(error.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [toast]);
  useEffect(() => { const controller = new AbortController(); refresh(controller.signal); const resume = () => refresh(); window.addEventListener(SESSION_RESTORED_EVENT, resume); return () => { controller.abort(); window.removeEventListener(SESSION_RESTORED_EVENT, resume); }; }, [refresh]);
  const cancelPickup = async () => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', { ticketIds: undo.activeTicketIds, isPickedUp: false, expectedMovementId: undo.id }));
      toast.info('Anulación registrada en el historial'); setUndo(null); await refresh();
    } catch (error) { toast.error(error.message); if (error.status === 409) { setUndo(null); refresh(); } }
  };
  const term = query.trim().toLowerCase().replace(/^#/, '');
  // Filter entire movements, so searching one ticket preserves the full batch.
  const filtered = movements.filter(event => !term || event.id.toLowerCase().includes(term) || (event.actor_email || '').toLowerCase().includes(term) ||
    event.ticket_snapshots.some(ticket => formatTicketNumber(ticket.ticket_number).includes(term) || (ticket.student_name || '').toLowerCase().includes(term)));
  return <div className={styles.container}>
    <div className={styles.header}><div><h1 className={styles.title}>Historial de movimientos</h1>
      <p className={styles.subtitle}>Entregas y anulaciones · {filtered.length} de {movements.length} movimientos</p></div>
      <button className="btn btn-secondary" onClick={() => refresh()}><RefreshCw size={16} /> Actualizar</button>
    </div>
    <div className={styles.searchSection}><label htmlFor="movement-search">Buscar por ticket, estudiante, cajero o movimiento</label>
      <input id="movement-search" type="search" className="input-field" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar movimientos..." />
    </div>
    {loading ? <p role="status">Cargando historial...</p> : filtered.length ? <div className={styles.tableContainer}><table className={styles.table}>
      <thead><tr><th>Movimiento</th><th>Detalle de entrega (Tickets y Alumnos)</th><th>Fecha y hora</th><th>Pago</th><th>Cajero responsable</th><th>Estado</th><th>Acción</th></tr></thead>
      <tbody>{filtered.map(event => {
        const isUndo = event.kind === 'undo';
        const totals = summarizePayments(event.ticket_snapshots.map(ticket => ({ ...ticket, payment_method: isUndo ? ticket.payment_method : event.payment_method })));
        const groups = event.ticket_snapshots.reduce((acc, ticket) => {
          const student = ticket.student_name || (ticket.is_extra ? 'Ticket Extra' : 'Sin asignar');
          if (!acc[student]) acc[student] = [];
          acc[student].push(ticket);
          return acc;
        }, {});
        const studentEntries = Object.entries(groups);
        const status = isUndo ? 'Anulación' : event.activeTicketIds.length === event.ticket_ids.length ? 'Entregado' : event.activeTicketIds.length ? 'Anulado parcialmente' : 'Anulado';
        return <tr key={event.id}>
          <td title={event.id}><strong>MOV-{event.id.slice(0, 8)}</strong></td>
          <td>
            <div className={styles.movementBreakdown}>
              {studentEntries.map(([student, tks]) => (
                <div key={student} className={styles.studentGroupCard}>
                  <div className={styles.studentGroupHeader}>
                    <span className={styles.studentGroupName}><strong>{student}</strong></span>
                    <span className={styles.studentGroupCount}>{tks.length} {tks.length === 1 ? 'pollada' : 'polladas'}</span>
                  </div>
                  <div className={styles.studentGroupTickets}>
                    {tks.map(ticket => (
                      <span className="badge badge-info" key={ticket.id}>
                        #{formatTicketNumber(ticket.ticket_number)}{ticket.is_extra ? ' (Extra)' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </td>
          <td>{new Date(event.created_at).toLocaleString('es-PE', { timeZone: APP_TIME_ZONE })}</td>
          <td>{isUndo ? 'Entrega anulada' : `${parsePayment(event.payment_method).label}${totals.total ? ` (S/ ${totals.total})` : ''}`}</td>
          <td>{event.actor_email || 'Desconocido'}</td><td><span className={`badge ${isUndo || !event.activeTicketIds.length ? 'badge-warning' : 'badge-success'}`}>{status}</span></td>
          <td>{!isUndo && event.activeTicketIds.length > 0 && <button className="btn btn-danger btn-sm" onClick={() => setUndo(event)}><Undo2 size={14} /> Anular {event.activeTicketIds.length} ticket(s)</button>}</td>
        </tr>;
      })}</tbody>
    </table></div> : <div className="empty-state"><History size={48} /><h3>No hay movimientos</h3></div>}
    <ConfirmModal isOpen={!!undo} title="Anular entrega" message={`Se anularán ${undo?.activeTicketIds.length || 0} ticket(s). El movimiento original y la anulación quedarán registrados.`}
      confirmText="Sí, anular" onConfirm={cancelPickup} onCancel={() => setUndo(null)} />
  </div>;
}
