'use client';

import { useState } from 'react';
import TicketBadge from './TicketBadge';
import { Check, Clock, CheckCircle, Banknote } from 'lucide-react';
import CustomSelect from './CustomSelect';
import styles from './TicketGrid.module.css';

export default function TicketGrid({ tickets, onPickUp, onUndoPickUp }) {
  const [selectedTickets, setSelectedTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('en_momento_efectivo');

  const pendingTickets = tickets.filter((t) => !t.is_picked_up);
  const pickedUpCount = tickets.filter((t) => t.is_picked_up).length;

  const toggleTicket = (ticket) => {
    setShowPayment(false);
    setSelectedTickets((prev) => {
      const isSelected = prev.some((t) => t.id === ticket.id);
      if (isSelected) {
        return prev.filter((t) => t.id !== ticket.id);
      }
      return [...prev, ticket];
    });
  };

  const handleSelectAll = () => {
    setShowPayment(false);
    if (selectedTickets.length === pendingTickets.length) {
      setSelectedTickets([]);
    } else {
      setSelectedTickets([...pendingTickets]);
    }
  };

  const handlePickUp = async (method) => {
    if (selectedTickets.length === 0) return;
    setLoading(true);
    try {
      await onPickUp(selectedTickets.map((t) => t.id), method);
      setSelectedTickets([]);
      setShowPayment(false);
    } catch (err) {
      console.error('Error picking up tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.gridContainer}>
      {/* Header with stats */}
      <div className={styles.gridHeader}>
        <div className={styles.gridStats}>
          <span className={`badge badge-success`}><Check size={14} className="inline-icon"/> {pickedUpCount} recogidos</span>
          <span className={`badge badge-warning`}><Clock size={14} className="inline-icon"/> {pendingTickets.length} pendientes</span>
        </div>

        {pendingTickets.length > 0 && (
          <div className={styles.gridActions}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleSelectAll}
            >
              {selectedTickets.length === pendingTickets.length
                ? 'Deseleccionar todo'
                : 'Seleccionar todo'}
            </button>
          </div>
        )}
      </div>

      {/* Ticket Grid */}
      <div className={styles.grid}>
        {tickets
          .sort((a, b) => a.ticket_number - b.ticket_number)
          .map((ticket) => (
            <TicketBadge
              key={ticket.id}
              ticket={ticket}
              selected={selectedTickets.some((t) => t.id === ticket.id)}
              onToggle={toggleTicket}
              onUndo={onUndoPickUp}
            />
          ))}
      </div>

      {/* Pickup Action */}
      {selectedTickets.length > 0 && (
        <div className={styles.pickupBar}>
          {showPayment ? (
            <div className={styles.paymentSection}>
              <div className={styles.paymentHeader}>
                <span className={styles.paymentTotal}>
                  Total a cobrar: <strong>S/ {selectedTickets.length * 15}</strong>
                </span>
                
                <div className={styles.paymentOptions}>
                  <div 
                    className={`${styles.paymentPill} ${paymentMethod === 'en_momento_efectivo' ? styles.active : ''}`}
                    onClick={() => setPaymentMethod('en_momento_efectivo')}
                  >
                    <span><Banknote size={14} className="inline-icon"/> Efectivo</span>
                    <strong>S/ {selectedTickets.length * 15}</strong>
                  </div>
                  <div 
                    className={`${styles.paymentPill} ${paymentMethod === 'en_momento_yape' ? styles.active : ''}`}
                    onClick={() => setPaymentMethod('en_momento_yape')}
                  >
                    <span><Banknote size={14} className="inline-icon"/> Yape</span>
                    <strong>S/ {selectedTickets.length * 15}</strong>
                  </div>
                  <div 
                    className={`${styles.paymentPill} ${paymentMethod === 'previo' ? styles.active : ''}`}
                    onClick={() => setPaymentMethod('previo')}
                  >
                    <span><CheckCircle size={14} className="inline-icon"/> Ya pagado</span>
                    <strong>Pre-venta</strong>
                  </div>
                </div>
              </div>
              <div className={styles.paymentActions}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowPayment(false)}
                  disabled={loading}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => handlePickUp(paymentMethod)}
                  disabled={loading}
                >
                  {loading ? (
                    <><span className="spinner spinner-sm" /> Registrando...</>
                  ) : (
                    <><CheckCircle size={16} className="inline-icon" /> Confirmar Recojo</>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className={styles.pickupCount}>
                {selectedTickets.length} ticket{selectedTickets.length > 1 ? 's' : ''} seleccionado{selectedTickets.length > 1 ? 's' : ''}
              </span>
              <button
                className="btn btn-success"
                onClick={() => setShowPayment(true)}
              >
                Siguiente <CheckCircle size={16} className="inline-icon" style={{ marginLeft: '4px' }} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
