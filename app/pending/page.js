'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, HandCoins, Users, Ticket, Banknote, Search, X, Save } from 'lucide-react';
import { pendingCSV } from '@/lib/pending.mjs';
import { APP_TIME_ZONE, localDate, TICKET_PRICE } from '@/lib/domain.mjs';
import { writeSearchState } from '@/lib/view-state.mjs';
import { requestJson, jsonBody } from '@/lib/client';
import { formatTicketNumber } from '@/lib/utils';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useSearchState } from '@/hooks/useSearchState';
import PaymentOptions from '@/components/PaymentOptions';
import styles from './page.module.css';

const PAGE_SIZE = 15;
const number = value => new Intl.NumberFormat('es-PE').format(value || 0);
const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
const stamp = value => value ? new Date(value).toLocaleString('es-PE', { timeZone: APP_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }) : 'Sin fecha registrada';
const fold = value => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function PendingPage() {
  const [group, setGroup] = useState('all'), [status, setStatus] = useState('all'), [data, setData] = useState(null), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const controller = useRef(null);
  const { query, page, setQuery, setPage } = useSearchState('pending');
  // --- Payment Modal state ---
  const [paymentTarget, setPaymentTarget] = useState(null); // { row, tickets } | null
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const paymentDialog = useRef(null);
  const paymentTitleId = useId();

  const refresh = useCallback(async () => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setRefreshing(true); setError('');
    try { const result = await requestJson('/api/pending?' + new URLSearchParams({ group }), { signal: current.signal }); if (!current.signal.aborted) setData(result); }
    catch (issue) { if (!current.signal.aborted) setError(issue.message); }
    finally { if (!current.signal.aborted) setRefreshing(false); }
  }, [group]);
  useEffect(() => { refresh(); return () => controller.current?.abort(); }, [refresh]);
  useAutoRefresh(refresh, { enabled: !refreshing });

  const rows = useMemo(() => {
    const term = fold(query.trim().replace(/^#/, ''));
    return (data?.rows || []).filter(row => (status === 'all' || row.tickets.some(ticket => ticket.status === status)) && (!term || fold(`${row.name} ${row.code} ${row.deliveredBy.join(' ')} ${row.tickets.map(ticket => `${ticket.number} ${formatTicketNumber(ticket.number)}`).join(' ')}`).includes(term)));
  }, [data, query, status]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages), visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([pendingCSV(data, value => value ? stamp(value) : '')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `recogieron_sin_pagar_${localDate()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openPerson = (row, target) => { try { writeSearchState(sessionStorage, target, { query: row.code || row.name, page: 1 }); } catch { /* Storage may be blocked. */ } };

  // --- Payment Modal logic ---
  const openPaymentModal = useCallback(async (row) => {
    setPaymentLoading(true); setPaymentError(''); setPaymentTarget(null);
    setSelectedIds([]); setPaymentMethod('cash'); setConfirming(false); setSaving(false);
    try {
      const result = await requestJson('/api/pending/tickets?' + new URLSearchParams({ studentId: row.id }));
      if (!result.tickets.length) { setPaymentError('No se encontraron tickets pendientes de pago para este participante.'); setPaymentLoading(false); return; }
      setPaymentTarget({ row, tickets: result.tickets });
      setSelectedIds(result.tickets.filter(t => !t.is_paid).map(t => t.id));
    } catch (issue) { setPaymentError(issue.message); }
    finally { setPaymentLoading(false); }
  }, []);

  useEffect(() => {
    if (paymentTarget) paymentDialog.current?.showModal();
    else paymentDialog.current?.close();
  }, [paymentTarget]);

  const closePaymentModal = () => {
    if (saving) return;
    setPaymentTarget(null); setPaymentError(''); setConfirming(false);
  };

  const toggleTicket = (id) => {
    setConfirming(false); setPaymentError('');
    setSelectedIds(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id]);
  };
  const selectAll = () => { setConfirming(false); setPaymentError(''); setSelectedIds(paymentTarget?.tickets.filter(t => !t.is_paid).map(t => t.id) || []); };
  const clearSelection = () => { setConfirming(false); setPaymentError(''); setSelectedIds([]); };

  const paymentSummary = useMemo(() => {
    if (!paymentTarget) return { selected: 0, changing: 0, total: 0 };
    const selected = paymentTarget.tickets.filter(t => selectedIds.includes(t.id));
    const changing = selected.filter(t => !t.is_paid);
    const total = changing.reduce((sum, t) => sum + Math.round(Number(t.unit_price ?? TICKET_PRICE) * 100), 0) / 100;
    return { selected: selected.length, changing: changing.length, total, unchanged: selected.length - changing.length };
  }, [paymentTarget, selectedIds]);

  const submitPayment = async (event) => {
    event.preventDefault();
    if (saving || !paymentSummary.changing) return;
    if (!confirming) { setConfirming(true); return; }
    setSaving(true); setPaymentError('');
    try {
      const tickets = paymentTarget.tickets
        .filter(t => selectedIds.includes(t.id))
        .map(t => ({ id: t.id, updated_at: t.assignment_updated_at }));
      const body = {
        studentId: paymentTarget.row.id,
        tickets,
        condition: paymentMethod,
        expectedTotal: paymentSummary.total,
      };
      await requestJson('/api/faculty/payments', jsonBody('PATCH', body));
      setPaymentTarget(null);
      refresh();
    } catch (issue) { setPaymentError(issue.message); setConfirming(false); }
    finally { setSaving(false); }
  };

  const s = data?.summary;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>ENTREGAS · PAGOS PENDIENTES</p><h1>Recogieron sin pagar</h1><p>Participantes que ya se llevaron su pollada y todavía tienen el pago pendiente.</p></div>
      <div className={styles.actions}>
        <button className="btn btn-secondary btn-sm" disabled={refreshing} onClick={refresh}><RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />Actualizar</button>
        <button className="btn btn-primary btn-sm" disabled={!data?.rows.length || refreshing} onClick={exportReport}><Download size={16} />Exportar lista</button>
      </div>
    </header>
    {error && <div role="alert" className={styles.error}><strong>{error}</strong>{data && <p>Se muestran los datos de la consulta anterior.</p>}<button className="btn btn-secondary btn-sm" onClick={refresh}>Reintentar</button></div>}
    {!data && !error && <div role="status" className={styles.loading}><HandCoins size={32} />Buscando pagos pendientes...</div>}
    {data && <div className={styles.content} aria-busy={refreshing}>
      <section className={styles.metrics} aria-label="Resumen de pagos pendientes">
        <article className={styles.metric} aria-label="Participantes que deben"><span><Users size={18} aria-hidden="true" />Participantes que deben</span><strong>{number(s.people)}</strong></article>
        <article className={styles.metric} aria-label="Polladas recogidas sin pagar"><span><Ticket size={18} aria-hidden="true" />Polladas recogidas sin pagar</span><strong>{number(s.tickets)}</strong><small>{number(s.prepaid)} como Prepagado · {number(s.tickets - s.prepaid)} sin pago registrado</small></article>
        <article className={styles.metric} aria-label="Monto por cobrar"><span><Banknote size={18} aria-hidden="true" />Monto por cobrar</span><strong>{money(s.due)}</strong><small>Según el precio de cada ticket</small></article>
      </section>
      <section className={styles.panel} aria-label="Lista de participantes con pago pendiente">
        <div className={styles.filters}>
          <div className="input-group"><label htmlFor="pending-search">Buscar participante, código o ticket</label><div className={styles.search}><Search size={18} /><input id="pending-search" type="search" className="input-field" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, código o número" /></div></div>
          <div className="input-group"><label htmlFor="pending-group">Grupo</label><select id="pending-group" className="input-field" value={group} onChange={event => { setGroup(event.target.value); setPage(1); }}><option value="all">Todos los grupos</option>{data.options.groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="input-group"><label htmlFor="pending-status">Situación</label><select id="pending-status" className="input-field" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">Todas</option><option value="prepaid">Entregado como Prepagado</option><option value="unpaid">Sin pago registrado</option></select></div>
        </div>
        <p className={styles.updated}>{refreshing ? 'Actualizando...' : `${number(rows.length)} de ${number(data.rows.length)} participantes · Actualizado: ${stamp(data.generatedAt)}`}</p>
        {rows.length ? <div className={styles.tableScroll}><table>
          <thead><tr><th>Participante</th><th>Tickets recogidos sin pagar</th><th>Debe</th><th>Última entrega</th><th>Acciones</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.id}>
            <td><strong>{row.name}</strong><small>{row.code || 'Sin código'} · {row.groupLabel}</small></td>
            <td><div className={styles.tickets}>{row.tickets.map(ticket => <span className={`badge ${ticket.status === 'prepaid' ? 'badge-info' : 'badge-warning'}`} key={ticket.id} title={ticket.status === 'prepaid' ? 'Entregado como Prepagado' : 'Sin pago registrado'}>#{formatTicketNumber(ticket.number)}</span>)}</div><small>{[row.prepaid && `${row.prepaid} como Prepagado`, row.count - row.prepaid && `${row.count - row.prepaid} sin pago registrado`].filter(Boolean).join(' · ')} · {row.assigned} {row.assigned === 1 ? 'ticket asignado' : 'tickets asignados'}</small></td>
            <td><strong className={styles.due}>{money(row.due)}</strong></td>
            <td>{stamp(row.pickedAt)}<small>{row.deliveredBy.length ? `Entregó: ${row.deliveredBy.join(', ')}` : 'Encargado no registrado'}</small></td>
            <td><div className={styles.rowLinks}>{row.id === 'extras' ? <span>Usa el lector de Entregas para consultarlos.</span> : <>
              <button type="button" className={styles.payButton} onClick={() => openPaymentModal(row)} disabled={paymentLoading}>Registrar pago</button>
              <Link href="/dashboard" onClick={() => openPerson(row, 'dashboard')}>Ver entrega</Link>
            </>}</div></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{data.rows.length ? 'Ningún participante coincide con la búsqueda o los filtros.' : 'Nadie ha recogido su pollada con el pago pendiente.'}</p>}
        {pages > 1 && <div className={styles.pagination}><span>Página {currentPage} de {pages}</span><button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn btn-secondary btn-sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
      </section>
      <p className={styles.note}>Se incluyen los tickets activos ya recogidos que se entregaron como Prepagado (sin cobro en caja) o que no tienen pago registrado.</p>
    </div>}

    {/* Payment Modal */}
    <dialog ref={paymentDialog} className={`modal-content confirm-dialog ${styles.paymentDialog}`} aria-labelledby={paymentTitleId} onCancel={event => { event.preventDefault(); if (!saving) closePaymentModal(); }}>
      {paymentTarget && <div className={styles.paymentContent}>
        <div className={styles.paymentHeader}>
          <div>
            <h2 id={paymentTitleId}>Registrar pago</h2>
            <p className={styles.paymentName}>{paymentTarget.row.name}</p>
            <small>{paymentTarget.row.code || 'Sin código'} · {paymentTarget.row.groupLabel}</small>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Cerrar" disabled={saving} onClick={closePaymentModal}><X size={17} />Cerrar</button>
        </div>
        <form onSubmit={submitPayment} className={styles.paymentForm}>
          <div className={styles.paymentActions}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={selectAll}>Pagar todo</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={clearSelection}>Limpiar selección</button>
          </div>
          <fieldset className={styles.paymentTickets} disabled={saving}>
            <legend>Tickets recogidos sin pagar</legend>
            {paymentTarget.tickets.map(ticket => <label key={ticket.id}>
              <input type="checkbox" checked={selectedIds.includes(ticket.id)} onChange={() => toggleTicket(ticket.id)} aria-label={`Seleccionar ticket ${ticket.ticket_number}`} />
              <span>
                <strong>#{formatTicketNumber(ticket.ticket_number)}</strong>
                <small>{ticket.is_paid ? 'Entregado como Prepagado' : 'Sin pago registrado'} · S/ {Number(ticket.unit_price ?? TICKET_PRICE).toFixed(2)}</small>
              </span>
            </label>)}
          </fieldset>
          <PaymentOptions label="Método de pago" value={paymentMethod} onChange={method => { setConfirming(false); setPaymentError(''); setPaymentMethod(method); }} disabled={saving} />
          <div role="status" className={styles.paymentTotal}>
            <strong>{paymentSummary.selected} tickets seleccionados</strong>
            <span>{paymentSummary.changing} {paymentSummary.changing === 1 ? 'ticket por pagar' : 'tickets por pagar'}</span>
            <b>Total a pagar: S/ {paymentSummary.total.toFixed(2)}</b>
            {paymentSummary.unchanged > 0 && <small>{paymentSummary.unchanged} sin cambios: ya estaban pagados.</small>}
          </div>
          {confirming && <p className={styles.paymentWarning} role="alert">Confirma el pago de {paymentSummary.changing} tickets por S/ {paymentSummary.total.toFixed(2)} {paymentMethod === 'cash' ? 'en efectivo' : 'con Yape'}. Se guardará tu usuario.</p>}
          {paymentError && <p role="alert" className="text-danger">{paymentError}</p>}
          <div className="confirm-actions">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => confirming ? setConfirming(false) : closePaymentModal()}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving || !paymentSummary.changing}><Save size={16} />{saving ? 'Guardando...' : confirming ? 'Confirmar pago' : 'Revisar pago'}</button>
          </div>
        </form>
      </div>}
      {paymentLoading && <div className={styles.paymentLoading}><HandCoins size={32} />Cargando tickets del participante...</div>}
    </dialog>
  </div>;
}
