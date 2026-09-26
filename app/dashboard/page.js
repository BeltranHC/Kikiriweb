'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { useToast } from '@/components/Toast';
import { Search, RefreshCw, Download } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import StatsPanel from '@/components/StatsPanel';
import StudentCard from '@/components/StudentCard';
import ConfirmModal from '@/components/ConfirmModal';
import styles from './page.module.css';

export default function DashboardPage() {
  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmUndo, setConfirmUndo] = useState({ isOpen: false, studentId: null, ticketId: null, ticketNumber: null });
  const toast = useToast();
  const supabase = createClient();

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, []);

  // Search students
  const searchStudents = useCallback(async (query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      const res = await fetch(`/api/students?${params}`);
      if (res.ok) {
        const data = await res.json();
        setStudents(data);
      }
    } catch (err) {
      console.error('Error searching students:', err);
      toast.error('Error al buscar estudiantes');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    fetchStats();
    searchStudents('');
  }, [fetchStats, searchStudents]);

  // Handle search
  const handleSearch = (query) => {
    setSearchQuery(query);
    searchStudents(query);
  };

  // Handle ticket pickup
  const handlePickUp = async (studentId, ticketIds, paymentMethod) => {
    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds, isPickedUp: true, paymentMethod }),
      });

      if (res.ok) {
        toast.success(`${ticketIds.length} ticket(s) marcado(s) como recogidos`);
        // Refresh data
        searchStudents(searchQuery);
        fetchStats();
      } else {
        toast.error('Error al actualizar tickets');
      }
    } catch (err) {
      toast.error('Error de conexión');
    }
  };

  const handleUndoPickUpClick = (studentId, ticketId, ticketNumber) => {
    setConfirmUndo({ isOpen: true, studentId, ticketId, ticketNumber });
  };

  const executeUndoPickUp = async () => {
    const { ticketId } = confirmUndo;
    if (!ticketId) return;

    try {
      const res = await fetch('/api/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: [ticketId], isPickedUp: false }),
      });

      if (res.ok) {
        toast.info('Recojo del ticket deshecho');
        searchStudents(searchQuery);
        fetchStats();
      } else {
        toast.error('Error al actualizar ticket');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setConfirmUndo({ isOpen: false, studentId: null, ticketId: null, ticketNumber: null });
    }
  };

  // Handle Export
  const handleExport = async () => {
    try {
      toast.info('Generando reporte...');
      const res = await fetch('/api/export');
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cierre_caja_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        toast.success('Reporte descargado exitosamente');
      } else {
        toast.error('Error al generar el reporte');
      }
    } catch (err) {
      toast.error('Error de conexión al exportar');
    }
  };

  return (
    <div className={styles.dashboard}>
      {/* Page Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Gestión de tickets de pollada</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => { 
              fetchStats(); 
              searchStudents(searchQuery); 
              toast.info('Datos sincronizados con la base de datos'); 
            }}
          >
            <RefreshCw size={16} /> Actualizar
          </button>
          <button className="btn btn-primary" onClick={handleExport}>
            <Download size={16} /> Cierre de Caja
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && <StatsPanel stats={stats} />}

      {/* Search */}
      <div className={styles.searchSection}>
        <SearchBar onSearch={handleSearch} />
      </div>

      {/* Results */}
      <div className={styles.results}>
        {loading ? (
          <div className={styles.loadingState}>
            <div className="spinner" />
            <p>Buscando estudiantes...</p>
          </div>
        ) : students.length > 0 ? (
          <div className={styles.studentList}>
            {students.map((student, index) => (
              <div
                key={student.id}
                style={{ animationDelay: `${index * 50}ms` }}
                className="animate-fade-in-up"
              >
                <StudentCard
                  student={student}
                  onPickUp={handlePickUp}
                  onUndoPickUp={handleUndoPickUpClick}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-state-icon"><Search size={48} /></span>
            <h3>No se encontraron estudiantes</h3>
            <p className="text-muted">
              {searchQuery
                ? `No hay resultados para "${searchQuery}"`
                : 'Importa estudiantes desde la sección de importación'}
            </p>
          </div>
        )}
      </div>

      <ConfirmModal 
        isOpen={confirmUndo.isOpen}
        title="Deshacer Recojo"
        message={`¿Seguro que deseas DESHACER el recojo del ticket #${confirmUndo.ticketNumber}?`}
        confirmText="Sí, deshacer"
        cancelText="Cancelar"
        isDanger={true}
        onConfirm={executeUndoPickUp}
        onCancel={() => setConfirmUndo({ isOpen: false, studentId: null, ticketId: null, ticketNumber: null })}
      />
    </div>
  );
}
