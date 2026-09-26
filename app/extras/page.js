'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';
import { Clock, Check, CheckCircle, Undo, Ticket } from 'lucide-react';
import styles from './page.module.css';

export default function ExtrasPage() {
  const [extras, setExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTicketNumber, setNewTicketNumber] = useState('');
  const [addingTicket, setAddingTicket] = useState(false);
  const toast = useToast();

  const fetchExtras = useCallback(async () => {
    try {
      const res = await fetch('/api/tickets?type=extra');
      if (res.ok) {
        const data = await res.json();
        setExtras(data);
      }
    } catch (err) {
      console.error('Error fetching extras:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExtras();
  }, [fetchExtras]);

  const handleAddExtra = async (e) => {
    e.preventDefault();
    if (!newTicketNumber) return;
    setAddingTicket(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketNumber: parseInt(newTicketNumber),
          isExtra: true,
        }),
      });

      if (res.ok) {
        toast.success(`Ticket extra #${newTicketNumber} agregado`);
        setNewTicketNumber('');
        fetchExtras();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Error al agregar ticket');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setAddingTicket(false);
    }
  };

  const handlePickUp = async (ticketId) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: [ticketId], isPickedUp: true, paymentMethod: 'en_momento' }),
      });

      if (res.ok) {
        toast.success('Ticket marcado como recogido');
        fetchExtras();
      }
    } catch (err) {
      toast.error('Error al actualizar');
    }
  };

  const handleUndoPickUp = async (ticketId) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: [ticketId], isPickedUp: false }),
      });

      if (res.ok) {
        toast.info('Ticket marcado como pendiente');
        fetchExtras();
      }
    } catch (err) {
      toast.error('Error al actualizar');
    }
  };

  const pendingExtras = extras.filter((t) => !t.is_picked_up);
  const pickedUpExtras = extras.filter((t) => t.is_picked_up);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Tickets Extra</h1>
          <p className={styles.subtitle}>Gestiona los tickets sin estudiante asignado</p>
        </div>
      </div>

      {/* Add Extra Ticket */}
      <form className={styles.addForm} onSubmit={handleAddExtra}>
        <input
          type="number"
          className="input-field"
          placeholder="Número de ticket"
          value={newTicketNumber}
          onChange={(e) => setNewTicketNumber(e.target.value)}
          min="1"
          required
        />
        <button type="submit" className="btn btn-primary" disabled={addingTicket}>
          {addingTicket ? (
            <span className="spinner spinner-sm" />
          ) : (
            '+ Agregar'
          )}
        </button>
      </form>

      {loading ? (
        <div className={styles.loadingState}>
          <div className="spinner" />
          <p>Cargando tickets extra...</p>
        </div>
      ) : (
        <>
          {/* Pending */}
          {pendingExtras.length > 0 && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <Clock size={20} className="inline-icon" /> Pendientes ({pendingExtras.length})
              </h2>
              <div className={styles.ticketList}>
                {pendingExtras.map((ticket) => (
                  <div key={ticket.id} className={`${styles.ticketItem} ${styles.pending}`}>
                    <span className={styles.ticketNumber}>#{ticket.ticket_number}</span>
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => handlePickUp(ticket.id)}
                    >
                      <Check size={16} className="inline-icon" /> Recoger
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Picked Up */}
          {pickedUpExtras.length > 0 && (
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <CheckCircle size={20} className="inline-icon" /> Recogidos ({pickedUpExtras.length})
              </h2>
              <div className={styles.ticketList}>
                {pickedUpExtras.map((ticket) => (
                  <div key={ticket.id} className={`${styles.ticketItem} ${styles.pickedUp}`}>
                    <span className={styles.ticketNumber}>#{ticket.ticket_number}</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleUndoPickUp(ticket.id)}
                    >
                      <Undo size={16} className="inline-icon" /> Deshacer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {extras.length === 0 && (
            <div className="empty-state">
              <span className="empty-state-icon"><Ticket size={48} /></span>
              <h3>No hay tickets extra</h3>
              <p className="text-muted">Agrega tickets extra usando el formulario de arriba</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
