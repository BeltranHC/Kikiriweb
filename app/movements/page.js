'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';
import { History, Search, Undo2, RefreshCw } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import styles from './page.module.css';

export default function MovementsPage() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, tickets: null });
  const toast = useToast();
  const supabase = createClient();

  const fetchMovements = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id,
          ticket_number,
          payment_method,
          picked_up_at,
          picked_up_by,
          is_extra,
          students (
            name,
            code
          )
        `)
        .eq('is_picked_up', true)
        .order('picked_up_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setMovements(data || []);
    } catch (err) {
      console.error('Error fetching movements:', err);
      toast.error('Error al cargar historial');
    } finally {
      setLoading(false);
    }
  }, [toast, supabase]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  const executeUndo = async (ticketsToUndo) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: ticketsToUndo.map(t => t.id), isPickedUp: false }),
      });

      if (res.ok) {
        toast.info(`Movimiento deshecho exitosamente`);
        fetchMovements();
      } else {
        toast.error('Error al actualizar tickets');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setConfirmModal({ isOpen: false, tickets: null });
    }
  };

  const handleUndoClick = (ticketsToUndo) => {
    setConfirmModal({ isOpen: true, tickets: ticketsToUndo });
  };

  const filteredMovements = movements.filter(m => {
    const [, email] = (m.payment_method || '').split('|');
    const searchEmail = email || 'Desconocido';
    return String(m.ticket_number).includes(searchQuery) ||
    m.students?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    searchEmail.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const groupedMovements = Object.values(
    filteredMovements.reduce((acc, m) => {
      const key = m.picked_up_at;
      if (!acc[key]) acc[key] = { ...m, tickets: [] };
      acc[key].tickets.push(m);
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.picked_up_at) - new Date(a.picked_up_at));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Historial de Movimientos</h1>
          <p className={styles.subtitle}>Auditoría de los últimos 100 tickets entregados</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchMovements}>
          <RefreshCw size={16} style={{marginRight: 6}} /> Actualizar
        </button>
      </div>

      <div className={styles.searchSection}>
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} size={20} />
          <input
            type="text"
            className="input-field"
            style={{ paddingLeft: 40, width: '100%', maxWidth: '400px' }}
            placeholder="Buscar por N° Ticket, estudiante o cajero..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.tableContainer}>
        {loading ? (
          <div className={styles.loadingState}>
            <div className="spinner" />
            <p>Cargando movimientos...</p>
          </div>
        ) : filteredMovements.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>N° Mov.</th>
                <th>Tickets Incluidos</th>
                <th>Estudiante</th>
                <th>Fecha y Hora</th>
                <th>Pago</th>
                <th>Cajero Responsable</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {groupedMovements.map((group) => {
                const [method, email] = (group.payment_method || '').split('|');
                const actualMethod = method || 'en_momento_efectivo';
                const cashierEmail = email || 'Desconocido';
                const isCaja = actualMethod.startsWith('en_momento');
                const totalMonto = isCaja ? group.tickets.length * 15 : 0;
                
                let paymentLabel = 'Pre-venta';
                if (actualMethod === 'en_momento_efectivo') paymentLabel = `Efectivo (S/${totalMonto})`;
                else if (actualMethod === 'en_momento_yape') paymentLabel = `Yape (S/${totalMonto})`;
                else if (actualMethod === 'en_momento') paymentLabel = `Caja (S/${totalMonto})`;

                // Generar un Nro Movimiento corto basado en el timestamp (últimos 6 dígitos de ms)
                const movNumber = new Date(group.picked_up_at).getTime().toString().slice(-6);

                return (
                <tr key={group.picked_up_at}>
                  <td>
                    <strong>MOV-{movNumber}</strong>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {group.tickets.map(t => (
                        <span key={t.id} className="badge badge-info" style={{background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)'}}>
                          #{String(t.ticket_number).padStart(4, '0')} {t.is_extra ? '(Extra)' : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{group.students?.name || 'Desconocido'}</td>
                  <td>{new Date(group.picked_up_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}</td>
                  <td>
                    <span className={`badge ${isCaja ? 'badge-success' : 'badge-primary'}`}>
                      {paymentLabel}
                    </span>
                  </td>
                  <td>
                    <div className={styles.cashier}>
                      <span className={styles.cashierIcon}>{cashierEmail[0]?.toUpperCase() || '?'}</span>
                      <span className={styles.cashierEmail}>{cashierEmail}</span>
                    </div>
                  </td>
                  <td>
                    <button 
                      className="btn btn-danger btn-sm"
                      onClick={() => handleUndoClick(group.tickets)}
                      title="Deshacer todo el movimiento"
                    >
                      <Undo2 size={14} style={{marginRight: 4}} /> Deshacer Todo
                    </button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-state-icon"><History size={48} /></span>
            <h3>No hay movimientos</h3>
            <p className="text-muted">No se han registrado entregas o la búsqueda no coincide.</p>
          </div>
        )}
      </div>

      <ConfirmModal 
        isOpen={confirmModal.isOpen}
        title="Deshacer Movimiento"
        message={`¿Estás seguro que deseas DESHACER este movimiento? Se revertirán ${confirmModal.tickets?.length || 0} ticket(s).`}
        confirmText="Sí, deshacer"
        cancelText="Cancelar"
        isDanger={true}
        onConfirm={() => executeUndo(confirmModal.tickets)}
        onCancel={() => setConfirmModal({ isOpen: false, tickets: null })}
      />
    </div>
  );
}
