'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { Ticket } from 'lucide-react';
import TicketGrid from '@/components/TicketGrid';
import ConfirmModal from '@/components/ConfirmModal';
import { requestJson, jsonBody } from '@/lib/client';
import { SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';
import styles from './page.module.css';

export default function ExtrasPage() {
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [number, setNumber] = useState('');
  const [adding, setAdding] = useState(false);
  const [undo, setUndo] = useState(null);
  const toast = useToast();
  const refresh = useCallback(async (signal) => {
    try { setExtras(await requestJson('/api/tickets?type=extra', { signal })); }
    catch (error) { if (!signal?.aborted) toast.error(error.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [toast]);
  useEffect(() => { const controller = new AbortController(); refresh(controller.signal); const resume = () => refresh(); window.addEventListener(SESSION_RESTORED_EVENT, resume); return () => { controller.abort(); window.removeEventListener(SESSION_RESTORED_EVENT, resume); }; }, [refresh]);
  const add = async event => {
    event.preventDefault(); setAdding(true);
    try {
      await requestJson('/api/tickets', jsonBody('POST', { ticketNumber: Number(number), isExtra: true }));
      toast.success(`Ticket extra #${number} agregado`); setNumber(''); await refresh();
    } catch (error) { toast.error(error.message); }
    finally { setAdding(false); }
  };
  const pickup = async (ticketIds, paymentMethod) => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', { ticketIds, isPickedUp: true, paymentMethod }));
      toast.success('Entrega registrada'); await refresh();
    } catch (error) { toast.error(error.message); if (error.status === 409) refresh(); throw error; }
  };
  const cancelPickup = async () => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', { ticketIds: [undo.id], isPickedUp: false, expectedMovementId: undo.movementId }));
      toast.info('Entrega anulada'); setUndo(null); await refresh();
    } catch (error) { toast.error(error.message); }
  };
  return <div className={styles.page}>
    <div><h1 className={styles.title}>Tickets extra</h1><p className={styles.subtitle}>Tickets sin estudiante asignado</p></div>
    <form className={styles.addForm} onSubmit={add}>
      <label className="sr-only" htmlFor="extra-number">Número de ticket</label>
      <input id="extra-number" type="number" min="1" step="1" className="input-field" placeholder="Número de ticket" value={number} onChange={event => setNumber(event.target.value)} required />
      <button className="btn btn-primary" disabled={adding}>{adding ? 'Agregando...' : '+ Agregar'}</button>
    </form>
    {loading ? <p role="status">Cargando tickets extra...</p> : extras.length ? <TicketGrid tickets={extras} onPickUp={pickup}
      onUndoPickUp={(id, ticketNumber, movementId) => setUndo({ id, ticketNumber, movementId })} /> :
      <div className="empty-state"><Ticket size={48} /><h3>No hay tickets extra</h3></div>}
    <ConfirmModal isOpen={!!undo} title="Anular entrega" message={`¿Anular la entrega del ticket #${undo?.ticketNumber || ''}?`}
      confirmText="Anular" onConfirm={cancelPickup} onCancel={() => setUndo(null)} />
  </div>;
}
