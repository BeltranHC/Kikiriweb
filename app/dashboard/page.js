'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { Search, RefreshCw, Download, CircleCheck, Pause, WifiOff } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import StatsPanel from '@/components/StatsPanel';
import StudentCard from '@/components/StudentCard';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import { useStudents } from '@/hooks/useStudents';
import { useSearchState } from '@/hooks/useSearchState';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { request, requestJson, jsonBody } from '@/lib/client';
import { SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';
import { localDate } from '@/lib/domain.mjs';
import styles from './page.module.css';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const { query: searchQuery, page, ready, setQuery, setPage } = useSearchState('dashboard');
  const [confirmUndo, setConfirmUndo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const { students, total, hasMore, loading, refreshing, lastUpdated, error, refresh } = useStudents(searchQuery, page, { enabled: ready });
  const fetchStats = useCallback(async ({ background = false, signal } = {}) => {
    try { setStats(await requestJson('/api/stats', { signal })); return true; }
    catch (issue) { if (!signal?.aborted && issue.status !== 401 && !background) toast.error(issue.message); return false; }
  }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    fetchStats({ signal: controller.signal });
    const resume = () => fetchStats();
    window.addEventListener(SESSION_RESTORED_EVENT, resume);
    return () => { controller.abort(); window.removeEventListener(SESSION_RESTORED_EVENT, resume); };
  }, [fetchStats]);
  const paused = useAutoRefresh(() => {
    fetchStats({ background: true }); refresh({ silent: true, background: true });
  }, { enabled: ready });
  const handlePickUp = async (studentId, ticketIds, paymentMethod) => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', { ticketIds, isPickedUp: true, paymentMethod }));
      toast.success(`${ticketIds.length} ticket(s) marcado(s) como recogidos`);
      await Promise.all([refresh({ silent: true }), fetchStats()]);
    } catch (issue) { if (issue.status !== 401) toast.error(issue.message); if (issue.status === 409) refresh({ silent: true }); throw issue; }
  };
  const executeUndo = async () => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', {
        ticketIds: [confirmUndo.ticketId], isPickedUp: false, expectedMovementId: confirmUndo.movementId,
      }));
      toast.info('Entrega anulada y conservada en el historial'); setConfirmUndo(null);
      await Promise.all([refresh({ silent: true }), fetchStats()]);
    } catch (issue) { if (issue.status !== 401) toast.error(issue.message); if (issue.status === 409) refresh({ silent: true }); }
  };
  const handleExport = async () => {
    setExporting(true);
    try {
      const day = localDate();
      const response = await request(`/api/export?date=${day}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `cierre_caja_${day}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Cierre de caja del día descargado');
    } catch (issue) { if (issue.status !== 401) toast.error(issue.message); }
    finally { setExporting(false); }
  };
  return <div className={styles.dashboard}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>POLLADA ESTUDIANTIL</p><h1 className={styles.title}>Control de entregas</h1><p className={styles.subtitle}>Todo listo para una atención ordenada.</p></div>
      <div className={styles.headerActions}>
        <button className="btn btn-secondary" disabled={refreshing} onClick={async () => { const [ok, statsOk] = await Promise.all([refresh({ silent: true }), fetchStats()]); if (ok && statsOk) toast.info('Datos actualizados'); }}><RefreshCw size={16} className={refreshing ? 'is-spinning' : ''} /> Actualizar</button>
        <button className="btn btn-primary" disabled={exporting} onClick={handleExport}><Download size={16} /> {exporting ? 'Generando...' : 'Cierre de caja'}</button>
      </div>
    </header>
    {stats && <StatsPanel stats={stats} />}
    <section className={styles.searchSection} aria-labelledby="student-search-title">
      <div className={styles.searchHeader}><div><h2 id="student-search-title">Encuentra un estudiante</h2><p>Busca, selecciona sus tickets y registra la entrega.</p></div>
        <span className={`${styles.syncStatus} ${error ? styles.syncError : ''}`} title={lastUpdated ? `Última actualización: ${new Date(lastUpdated).toLocaleTimeString('es-PE')}` : undefined}>
          {error ? <WifiOff size={14} /> : paused ? <Pause size={13} /> : <CircleCheck size={14} />}
          {error ? 'Esperando conexión' : paused ? 'Actualización en pausa' : refreshing ? 'Actualizando datos' : 'Actualización automática'}
        </span>
      </div>
      <SearchBar value={searchQuery} onSearch={setQuery} />
    </section>
    <section className={styles.results} aria-busy={loading} aria-label="Resultados de estudiantes">
      <div className={styles.resultsHeader}><span>{searchQuery ? 'Resultados de búsqueda' : 'Estudiantes registrados'}</span><span>{total} estudiantes</span></div>
      {loading && <p className={styles.loadingStatus} role="status">Buscando estudiantes...</p>}
      {students.length > 0 ? <div className={styles.studentList}>
        {students.map(student => <StudentCard key={student.id} student={student} onPickUp={handlePickUp}
          onUndoPickUp={(studentId, ticketId, ticketNumber, movementId) => setConfirmUndo({ ticketId, ticketNumber, movementId })} />)}
      </div> : !loading && <div className="empty-state"><span className="empty-state-icon"><Search size={30} /></span><h3>No se encontraron estudiantes</h3><p>{searchQuery ? `No hay resultados para “${searchQuery}”` : 'Agrega estudiantes o importa un CSV para comenzar.'}</p></div>}
    </section>
    <Pagination page={page} total={total} hasMore={hasMore} loading={loading} onPageChange={setPage} />
    <ConfirmModal isOpen={!!confirmUndo} title="Anular entrega" message={`¿Anular la entrega del ticket #${confirmUndo?.ticketNumber || ''}? La anulación quedará en el historial.`}
      confirmText="Sí, anular" onConfirm={executeUndo} onCancel={() => setConfirmUndo(null)} />
  </div>;
}
