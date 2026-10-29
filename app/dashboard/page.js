'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useToast } from '@/components/Toast';
import {
  Search, RefreshCw, Download, CircleCheck, Pause, WifiOff,
  ScanBarcode, Banknote, Smartphone, CheckCircle2,
  Trash2, Volume2, VolumeX, AlertTriangle, X, Check,
  Clock, Sparkles, BarChart3
} from 'lucide-react';
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
import { localDate, TICKET_PRICE, PAYMENT_METHODS } from '@/lib/domain.mjs';
import { formatTicketNumber, percentage } from '@/lib/utils';
import styles from './page.module.css';

const money = value => new Intl.NumberFormat('es-PE', {
  style: 'currency', currency: 'PEN', maximumFractionDigits: 2, minimumFractionDigits: 0
}).format(value || 0);

// Sistema de síntesis de audio (Web Audio API) para confirmación inmediata
let audioCtx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playScannerSound(type = 'success', enabled = true) {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.07);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'pickup') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'warning') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(311.13, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.start(now);
      osc.stop(now + 0.32);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Audio context inicializado tras interacción
  }
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [showFullStats, setShowFullStats] = useState(false);
  const { query: searchQuery, page, ready, setQuery, setPage } = useSearchState('dashboard');
  const [confirmUndo, setConfirmUndo] = useState(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const searchInputRef = useRef(null);

  // Modo escáner y selección múltiple de tickets
  const [scannerMode, setScannerMode] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedTickets, setSelectedTickets] = useState([]);
  const [batchPaymentMethod, setBatchPaymentMethod] = useState('en_momento_efectivo');
  const [submittingPickup, setSubmittingPickup] = useState(false);
  const [expandedStudentIds, setExpandedStudentIds] = useState(new Set());
  const [pinnedStudents, setPinnedStudents] = useState([]);
  const [focusOnSelected, setFocusOnSelected] = useState(true);

  // Filtro rápido de estudiantes (todos | con pendientes | completados)
  const [filterStatus, setFilterStatus] = useState('all');

  // Alerta modal para tickets duplicados / ya entregados
  const [alreadyDeliveredAlert, setAlreadyDeliveredAlert] = useState(null);

  const { students, total, hasMore, loading, refreshing, lastUpdated, error, refresh } = useStudents(searchQuery, page, {
    enabled: ready,
    pageSize: 30,
    status: filterStatus,
  });

  // Si la página guardada en sesión excede el total, restablecer a 1
  useEffect(() => {
    if (page > 1 && total > 0 && (page - 1) * 30 >= total) {
      setPage(1);
    }
  }, [page, total, setPage]);

  const handleFilterChange = status => {
    setFilterStatus(status);
    setPage(1);
  };

  useEffect(() => {
    try {
      const savedMethod = localStorage.getItem('kikiri_batch_payment_method');
      if (savedMethod && PAYMENT_METHODS.includes(savedMethod)) setBatchPaymentMethod(savedMethod);
      const savedSound = localStorage.getItem('kikiri_sound_enabled');
      if (savedSound !== null) setSoundEnabled(savedSound === 'true');
    } catch {}
  }, []);

  const handlePaymentMethodChange = method => {
    setBatchPaymentMethod(method);
    try { localStorage.setItem('kikiri_batch_payment_method', method); } catch {}
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try { localStorage.setItem('kikiri_sound_enabled', String(next)); } catch {}
    if (next) playScannerSound('success', true);
  };

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

  // Escanear ticket: ubicarlo, seleccionarlo y mostrar al estudiante
  const handleScanTicket = async ticketNumber => {
    try {
      const res = await requestJson(`/api/tickets?number=${ticketNumber}`);

      if (res.is_picked_up) {
        const pickupDate = res.picked_up_at
          ? new Date(res.picked_up_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
          : '';
        playScannerSound('warning', soundEnabled);

        setAlreadyDeliveredAlert({
          ticketNumber,
          studentName: res.student?.name || 'Ticket Extra',
          pickedUpAt: pickupDate,
          movementId: res.movement_id,
        });

        if (res.student) {
          setPinnedStudents(prev => [res.student, ...prev.filter(s => s.id !== res.student.id)]);
          setExpandedStudentIds(prev => new Set([...prev, res.student.id]));
        }
        return;
      }

      // Marcar / alternar selección del ticket
      const alreadySelected = selectedTickets.some(t => t.id === res.id);
      if (alreadySelected) {
        setSelectedTickets(prev => prev.filter(t => t.id !== res.id));
        toast.info(`Ticket #${formatTicketNumber(ticketNumber)} deseleccionado`);
      } else {
        setSelectedTickets(prev => [...prev, res]);
        toast.success(`Ticket #${formatTicketNumber(ticketNumber)} marcado`);
        playScannerSound('success', soundEnabled);
      }

      if (res.student) {
        setPinnedStudents(prev => [res.student, ...prev.filter(s => s.id !== res.student.id)]);
        setExpandedStudentIds(prev => new Set([...prev, res.student.id]));
      }
    } catch (issue) {
      if (issue.status === 404) {
        toast.error(`❌ El ticket #${formatTicketNumber(ticketNumber)} no existe`);
        playScannerSound('error', soundEnabled);
      } else {
        toast.error(issue.message || 'Error al buscar el ticket');
      }
    } finally {
      setTimeout(() => { searchInputRef.current?.focus(); }, 40);
    }
  };

  const handleToggleTicket = (ticket, student) => {
    if (ticket.is_picked_up) return;
    setSelectedTickets(prev => {
      const exists = prev.some(t => t.id === ticket.id);
      if (exists) return prev.filter(t => t.id !== ticket.id);
      playScannerSound('success', soundEnabled);
      return [...prev, { ...ticket, student: student || ticket.student }];
    });
    if (student) {
      setPinnedStudents(prev => [student, ...prev.filter(s => s.id !== student.id)]);
      setExpandedStudentIds(prev => new Set([...prev, student.id]));
    }
  };

  const handleConfirmBatchPickup = useCallback(async () => {
    if (!selectedTickets.length || submittingPickup) return;
    setSubmittingPickup(true);
    try {
      const ticketIds = selectedTickets.map(t => t.id);
      await requestJson('/api/tickets', jsonBody('PATCH', {
        ticketIds,
        isPickedUp: true,
        paymentMethod: batchPaymentMethod,
      }));

      playScannerSound('pickup', soundEnabled);
      toast.success(`${ticketIds.length} pollada(s) entregada(s) exitosamente`);
      setSelectedTickets([]);
      setPinnedStudents([]);
      setFocusOnSelected(true);
      await Promise.all([refresh({ silent: true }), fetchStats()]);
    } catch (issue) {
      if (issue.status !== 401) toast.error(issue.message);
      if (issue.status === 409) refresh({ silent: true });
    } finally {
      setSubmittingPickup(false);
      setTimeout(() => { searchInputRef.current?.focus(); }, 50);
    }
  }, [selectedTickets, submittingPickup, batchPaymentMethod, soundEnabled, toast, refresh, fetchStats]);

  // Atajos de teclado para velocidad sin mouse
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((event.key === 'F2' || event.key === '/') && !isInput) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape') {
        if (alreadyDeliveredAlert) {
          event.preventDefault();
          setAlreadyDeliveredAlert(null);
          searchInputRef.current?.focus();
          return;
        }
        if (selectedTickets.length > 0) {
          event.preventDefault();
          setSelectedTickets([]);
          setFocusOnSelected(true);
          toast.info('Selección cancelada');
          searchInputRef.current?.focus();
          return;
        }
      }

      if (selectedTickets.length > 0 && !isInput) {
        if (event.key === '1') {
          event.preventDefault();
          handlePaymentMethodChange('en_momento_efectivo');
          return;
        }
        if (event.key === '2') {
          event.preventDefault();
          handlePaymentMethodChange('en_momento_yape');
          return;
        }
        if (event.key === '3') {
          event.preventDefault();
          handlePaymentMethodChange('previo');
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          handleConfirmBatchPickup();
          return;
        }
      }

      if (!isInput && /^[0-9]$/.test(event.key)) {
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTickets, alreadyDeliveredAlert, handleConfirmBatchPickup, toast]);

  const handlePickUpSingle = async (studentId, ticketIds, paymentMethod) => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', { ticketIds, isPickedUp: true, paymentMethod }));
      playScannerSound('pickup', soundEnabled);
      toast.success(`${ticketIds.length} ticket(s) recogido(s)`);
      setSelectedTickets(prev => prev.filter(t => !ticketIds.includes(t.id)));
      await Promise.all([refresh({ silent: true }), fetchStats()]);
    } catch (issue) {
      if (issue.status !== 401) toast.error(issue.message);
      if (issue.status === 409) refresh({ silent: true });
      throw issue;
    }
  };

  const executeUndo = async () => {
    try {
      await requestJson('/api/tickets', jsonBody('PATCH', {
        ticketIds: [confirmUndo.ticketId], isPickedUp: false, expectedMovementId: confirmUndo.movementId,
      }));
      toast.info('Entrega anulada y conservada en el historial');
      setConfirmUndo(null);
      await Promise.all([refresh({ silent: true }), fetchStats()]);
    } catch (issue) {
      if (issue.status !== 401) toast.error(issue.message);
      if (issue.status === 409) refresh({ silent: true });
    }
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

  const selectedTotalAmount = useMemo(() => {
    return Math.round(
      selectedTickets.reduce((sum, t) => sum + Number(t.unit_price ?? TICKET_PRICE), 0) * 100
    ) / 100;
  }, [selectedTickets]);

  const selectedTicketIds = useMemo(() => selectedTickets.map(t => t.id), [selectedTickets]);

  const displayStudents = useMemo(() => {
    const matchingPinned = pinnedStudents.filter(p => {
      if (filterStatus === 'all') return true;
      const ts = p.tickets || [];
      const hasPending = ts.some(t => !t.is_picked_up);
      return filterStatus === 'pending' ? hasPending : !hasPending;
    });
    return [...matchingPinned.filter(p => !students.some(s => s.id === p.id)), ...students];
  }, [pinnedStudents, students, filterStatus]);

  const allCount = stats?.totalStudents ?? (filterStatus === 'all' ? total : displayStudents.length);
  const pendingCount = stats?.pendingStudents ?? (filterStatus === 'pending' ? total : 0);
  const completedCount = stats?.completedStudents ?? Math.max(0, allCount - pendingCount);

  const selectedStudentsSummary = useMemo(() => {
    if (!selectedTickets.length) return [];
    const map = new Map();
    for (const ticket of selectedTickets) {
      const studentId = ticket.student_id || ticket.student?.id || (ticket.is_extra ? 'extra' : ticket.id);
      const studentObj =
        ticket.student ||
        pinnedStudents.find(s => s.id === studentId) ||
        students.find(s => s.id === studentId);
      const studentName = studentObj?.name || (ticket.is_extra ? 'Ticket Extra' : 'Estudiante');

      if (!map.has(studentId)) {
        map.set(studentId, {
          id: studentId,
          name: studentName,
          student: studentObj,
          tickets: [],
        });
      }
      map.get(studentId).tickets.push(ticket);
    }
    return Array.from(map.values());
  }, [selectedTickets, pinnedStudents, students]);

  const filteredStudents = useMemo(() => {
    if (selectedTickets.length > 0 && focusOnSelected) {
      const selectedStudents = selectedStudentsSummary
        .map(s => s.student)
        .filter(Boolean);
      if (selectedStudents.length > 0) return selectedStudents;
    }
    return displayStudents;
  }, [selectedTickets.length, focusOnSelected, selectedStudentsSummary, displayStudents]);

  return (
    <div className={styles.dashboard}>
      {/* 1. Cabecera compacta con KPIs clave en la misma línea */}
      <header className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <h1 className={styles.title}>Control de entregas</h1>
          {stats && (
            <div className={styles.headerStatsBadges}>
              <span className={styles.kpiBadge}>
                Entregados: <strong>{stats.pickedUp}</strong>/{stats.totalTickets} ({percentage(stats.pickedUp, stats.totalTickets)}%)
              </span>
              <span className={`${styles.kpiBadge} ${stats.pending > 0 ? styles.kpiBadgeWarning : ''}`}>
                <Clock size={13} />
                <strong>{stats.pending}</strong> pendientes
              </span>
              <span className={`${styles.kpiBadge} ${styles.kpiBadgeCash}`}>
                <Banknote size={13} />
                Cobrado hoy: <strong>{money(stats.collectedNow)}</strong>
              </span>
            </div>
          )}
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowFullStats(!showFullStats)}
            title="Ver resumen completo y gráficos"
          >
            <BarChart3 size={15} />
            <span>{showFullStats ? 'Ocultar panel' : 'Métricas completas'}</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={refreshing}
            onClick={async () => {
              const [ok, statsOk] = await Promise.all([refresh({ silent: true }), fetchStats()]);
              if (ok && statsOk) toast.info('Datos actualizados');
            }}
          >
            <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} />
            <span>Actualizar</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={exporting}
            onClick={handleExport}
          >
            <Download size={15} />
            <span>{exporting ? 'Generando...' : 'Cierre de caja'}</span>
          </button>
        </div>
      </header>

      {/* Panel completo desplegable (opcional) */}
      {showFullStats && stats && (
        <div className={styles.fullStatsWrapper}>
          <StatsPanel stats={stats} />
        </div>
      )}

      {/* 2. Barra de búsqueda y escáner PRINCIPAL (ARRIBA, ENFOCADA Y COMPACTA) */}
      <section className={styles.searchSection} aria-label="Buscador y lector de tickets">
        <div className={styles.searchBarWrapper}>
          <SearchBar
            inputRef={searchInputRef}
            value={searchQuery}
            onSearch={setQuery}
            onScan={scannerMode ? handleScanTicket : undefined}
            placeholder="Escanea el ticket con la lectora o busca por estudiante... (F2)"
            autoFocus
          />
        </div>

        <div className={styles.searchControlsRow}>
          <div className={styles.toolbarLeft}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${scannerMode ? styles.toggleBtnActive : ''}`}
              onClick={() => setScannerMode(!scannerMode)}
              title={scannerMode ? 'Lector activo: ubica y selecciona automáticamente' : 'Modo de búsqueda manual'}
            >
              <ScanBarcode size={15} />
              <span>Lector: <strong>{scannerMode ? 'Activo' : 'Pausado'}</strong></span>
            </button>

            <button
              type="button"
              className={`${styles.soundBtn} ${soundEnabled ? styles.soundBtnActive : ''}`}
              onClick={handleToggleSound}
              title={soundEnabled ? 'Sonidos activos' : 'Sonidos desactivados'}
            >
              {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>{soundEnabled ? 'Sonido activo' : 'Silencio'}</span>
            </button>

            <span className={`${styles.syncStatus} ${error ? styles.syncError : ''}`}>
              {error ? <WifiOff size={13} /> : paused ? <Pause size={12} /> : <CircleCheck size={13} />}
              {error ? 'Sin conexión' : paused ? 'En pausa' : 'En vivo'}
            </span>
          </div>

          {/* Filtros rápidos: Todos, Solo pendientes, Completados */}
          <div className={styles.filterPills} role="tablist" aria-label="Filtrar estudiantes">
            <button
              type="button"
              role="tab"
              aria-selected={filterStatus === 'all'}
              className={`${styles.filterPill} ${filterStatus === 'all' ? styles.filterPillActive : ''}`}
              onClick={() => handleFilterChange('all')}
            >
              Todos ({allCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterStatus === 'pending'}
              className={`${styles.filterPill} ${filterStatus === 'pending' ? styles.filterPillActive : ''}`}
              onClick={() => handleFilterChange('pending')}
            >
              ⏳ Con pendientes ({pendingCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterStatus === 'completed'}
              className={`${styles.filterPill} ${filterStatus === 'completed' ? styles.filterPillActive : ''}`}
              onClick={() => handleFilterChange('completed')}
            >
              ✓ Completados ({completedCount})
            </button>
          </div>

          <div className={styles.hotkeyHint} aria-hidden="true">
            <kbd>F2</kbd> Lector
            <kbd>1</kbd> Efectivo
            <kbd>2</kbd> Yape
            <kbd>Enter</kbd> Confirmar
          </div>
        </div>
      </section>

      {/* 3. Nombres de estudiantes DIRECTAMENTE DEBAJO (acceso visual inmediato) */}
      <section className={styles.results} aria-busy={loading} aria-label="Lista de estudiantes">
        <div className={styles.resultsHeader}>
          <span>
            {searchQuery
              ? `Resultados para “${searchQuery}”`
              : filterStatus === 'pending'
              ? 'Estudiantes con entregas pendientes'
              : filterStatus === 'completed'
              ? 'Estudiantes con entregas completadas'
              : 'Todos los estudiantes'}
          </span>
          <span className={styles.studentCountBadge}>{total} {total === 1 ? 'estudiante' : 'estudiantes'}</span>
        </div>

        {loading && <p className={styles.loadingStatus} role="status">Buscando estudiantes...</p>}

        {selectedStudentsSummary.length > 0 && (
          <div className={styles.selectionFocusBanner}>
            <div className={styles.selectionFocusText}>
              <Sparkles size={16} className={styles.selectionFocusIcon} />
              <span>
                Entrega multialumno ({selectedTickets.length} tickets de {selectedStudentsSummary.length} {selectedStudentsSummary.length === 1 ? 'alumno' : 'alumnos'}):
              </span>
              <div className={styles.selectionFocusChips}>
                {selectedStudentsSummary.map((s, idx) => (
                  <span key={s.id || idx} className={styles.selectionFocusChip}>
                    <strong>{s.name}</strong> ({s.tickets.length} {s.tickets.length === 1 ? 'pollada' : 'polladas'}: {s.tickets.map(t => `#${formatTicketNumber(t.ticket_number)}`).join(', ')})
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              className={styles.selectionFocusToggle}
              onClick={() => setFocusOnSelected(prev => !prev)}
            >
              {focusOnSelected ? 'Mostrar todos los alumnos' : 'Ver solo estos alumnos'}
            </button>
          </div>
        )}

        {filteredStudents.length > 0 ? (
          <div className={styles.studentList}>
            {filteredStudents.map(student => {
              const isExpanded = expandedStudentIds.has(student.id);
              return (
                <StudentCard
                  key={student.id}
                  student={student}
                  expanded={isExpanded}
                  onToggleExpand={nextState => {
                    setExpandedStudentIds(prev => {
                      const copy = new Set(prev);
                      if (nextState) copy.add(student.id);
                      else copy.delete(student.id);
                      return copy;
                    });
                  }}
                  selectedTicketIds={selectedTicketIds}
                  onToggleTicket={ticket => handleToggleTicket(ticket, student)}
                  onPickUp={handlePickUpSingle}
                  onUndoPickUp={(studentId, ticketId, ticketNumber, movementId) =>
                    setConfirmUndo({ ticketId, ticketNumber, movementId })
                  }
                />
              );
            })}
          </div>
        ) : !loading && (
          <div className="empty-state">
            <span className="empty-state-icon"><Search size={28} /></span>
            <h3>No se encontraron estudiantes</h3>
            <p>
              {filterStatus === 'pending'
                ? '¡Genial! No hay estudiantes con tickets pendientes en toda la base de datos.'
                : filterStatus === 'completed'
                ? 'Aún no hay estudiantes que hayan completado sus tickets.'
                : searchQuery
                ? `No hay coincidencias para “${searchQuery}”`
                : 'No hay estudiantes registrados.'}
            </p>
          </div>
        )}
      </section>

      <Pagination page={page} total={total} hasMore={hasMore} loading={loading} onPageChange={setPage} />

      {/* Barra de entrega flotante inferior (Checkout Dock) */}
      {selectedTickets.length > 0 && (
        <aside className={styles.floatingDock} role="dialog" aria-label="Confirmación flotante de entrega">
          <div className={styles.dockLeft}>
            <div className={styles.dockCountBadge}>
              <Sparkles size={16} />
              <span><strong>{selectedTickets.length}</strong> pollada(s)</span>
            </div>
            {selectedStudentsSummary.length > 0 && (
              <div className={styles.dockStudentsBreakdown}>
                {selectedStudentsSummary.map((item, idx) => (
                  <span
                    key={item.id || idx}
                    className={styles.dockStudentPill}
                    title={`${item.name}: ${item.tickets.map(t => `#${formatTicketNumber(t.ticket_number)}`).join(', ')}`}
                  >
                    {item.name}: <strong>{item.tickets.length}</strong>
                  </span>
                ))}
              </div>
            )}
            <div className={styles.dockTotal}>
              Total: <strong>S/ {batchPaymentMethod === 'previo' ? 0 : selectedTotalAmount}</strong>
            </div>
          </div>

          <div className={styles.dockCenter}>
            <div className={styles.paymentPills}>
              <button
                type="button"
                className={`${styles.pill} ${batchPaymentMethod === 'en_momento_efectivo' ? styles.pillActive : ''}`}
                onClick={() => handlePaymentMethodChange('en_momento_efectivo')}
                title="Presiona 1 en el teclado"
              >
                <Banknote size={14} /> 1. Efectivo
              </button>
              <button
                type="button"
                className={`${styles.pill} ${batchPaymentMethod === 'en_momento_yape' ? styles.pillActive : ''}`}
                onClick={() => handlePaymentMethodChange('en_momento_yape')}
                title="Presiona 2 en el teclado"
              >
                <Smartphone size={14} /> 2. Yape
              </button>
              <button
                type="button"
                className={`${styles.pill} ${batchPaymentMethod === 'previo' ? styles.pillActive : ''}`}
                onClick={() => handlePaymentMethodChange('previo')}
                title="Presiona 3 en el teclado"
              >
                <Check size={14} /> 3. Prepagado
              </button>
            </div>
          </div>

          <div className={styles.dockRight}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={submittingPickup}
              onClick={() => {
                setSelectedTickets([]);
                setFocusOnSelected(true);
              }}
              title="Cancelar selección (Escape)"
            >
              <X size={14} /> Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submittingPickup}
              onClick={handleConfirmBatchPickup}
            >
              {submittingPickup ? (
                <>
                  <span className="spinner spinner-sm" />
                  <span>Entregando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={17} />
                  <span>Entregar ({selectedTickets.length})</span>
                </>
              )}
            </button>
          </div>
        </aside>
      )}

      {/* Modal de alerta de ticket ya entregado */}
      {alreadyDeliveredAlert && (
        <div className={styles.alertOverlay} role="dialog" aria-modal="true" aria-labelledby="alert-title">
          <div className={styles.alertCard}>
            <div className={styles.alertHeader}>
              <div className={styles.alertIcon}>
                <AlertTriangle size={32} />
              </div>
              <h3 id="alert-title">¡Ticket Ya Entregado!</h3>
              <p>Este ticket ya figura como recogido en el sistema.</p>
            </div>

            <div className={styles.alertInfoBox}>
              <div className={styles.alertInfoRow}>
                <span>Número de ticket:</span>
                <strong>#{formatTicketNumber(alreadyDeliveredAlert.ticketNumber)}</strong>
              </div>
              <div className={styles.alertInfoRow}>
                <span>Estudiante:</span>
                <strong>{alreadyDeliveredAlert.studentName}</strong>
              </div>
              {alreadyDeliveredAlert.pickedUpAt && (
                <div className={styles.alertInfoRow}>
                  <span>Hora de entrega:</span>
                  <strong>{alreadyDeliveredAlert.pickedUpAt}</strong>
                </div>
              )}
            </div>

            <div className={styles.alertActions}>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                onClick={() => {
                  setAlreadyDeliveredAlert(null);
                  setTimeout(() => searchInputRef.current?.focus(), 40);
                }}
                autoFocus
              >
                Entendido (Continuar)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para anular entrega */}
      <ConfirmModal
        isOpen={!!confirmUndo}
        title="Anular entrega"
        message={`¿Anular la entrega del ticket #${confirmUndo?.ticketNumber || ''}? La anulación quedará registrada en el historial de movimientos.`}
        confirmText="Sí, anular"
        onConfirm={executeUndo}
        onCancel={() => setConfirmUndo(null)}
      />
    </div>
  );
}
