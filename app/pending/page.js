'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, HandCoins, Users, Ticket, Banknote, Search, X, Save, UserX } from 'lucide-react';
import { pendingCSV, DEBT_STATUSES } from '@/lib/pending.mjs';
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
// Vistas del filtro Situación: qué estados de ticket muestra cada una.
const VIEWS = {
  debt: { label: 'Recogieron sin pagar', statuses: DEBT_STATUSES },
  prepaid: { label: 'Entregado como Prepagado', statuses: ['prepaid'] },
  unpaid: { label: 'Recogido sin pago registrado', statuses: ['unpaid'] },
  unpicked: { label: 'Asignados sin recoger', statuses: ['unpicked'] },
  no_show: { label: 'No recogió (no se cobra)', statuses: ['no_show'] },
};
const STATUS_TEXT = { prepaid: 'Entregado como Prepagado', unpaid: 'Recogido sin pago registrado', unpicked: 'Asignado, sin recoger ni pagar', no_show: 'No recogió · no se cobra' };
const STATUS_BADGE = { prepaid: 'badge-info', unpaid: 'badge-warning', unpicked: 'badge-primary', no_show: 'badge-danger' };
// Tickets que ofrece cada acción del modal.
const MODES = {
  pay: { title: 'Registrar pago', statuses: [...DEBT_STATUSES, 'unpicked'] },
  no_show: { title: 'Marcar como No recogió', statuses: [...DEBT_STATUSES, 'unpicked'] },
  restore: { title: 'Deshacer No recogió', statuses: ['no_show'] },
};
const fold = value => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function PendingPage() {
  const [group, setGroup] = useState('all'), [status, setStatus] = useState('debt'), [data, setData] = useState(null), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const controller = useRef(null);
  const { query, page, setQuery, setPage } = useSearchState('pending');
  // --- Payment Modal state ---
  const [paymentTarget, setPaymentTarget] = useState(null); // { row, tickets, mode } | null
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
    const statuses = VIEWS[status].statuses;
    return (data?.rows || []).filter(row => row.tickets.some(ticket => statuses.includes(ticket.status)) && (!term || fold(`${row.name} ${row.code} ${row.deliveredBy.join(' ')} ${row.tickets.map(ticket => `${ticket.number} ${formatTicketNumber(ticket.number)}`).join(' ')}`).includes(term)));
  }, [data, query, status]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages), visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const exportReport = () => {
    const url = URL.createObjectURL(new Blob([pendingCSV(data, value => value ? stamp(value) : '')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `recogieron_sin_pagar_${localDate()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openPerson = (row, target) => { try { writeSearchState(sessionStorage, target, { query: row.code || row.name, page: 1 }); } catch { /* Storage may be blocked. */ } };

  // --- Payment Modal logic ---
  const openPaymentModal = useCallback(async (row, mode = 'pay') => {
    setPaymentLoading(true); setPaymentError(''); setPaymentTarget(null);
    setSelectedIds([]); setPaymentMethod('cash'); setConfirming(false); setSaving(false);
    try {
      const result = await requestJson('/api/pending/tickets?' + new URLSearchParams({ studentId: row.id }));
      const tickets = result.tickets.filter(t => MODES[mode].statuses.includes(t.status));
      if (!tickets.length) { setPaymentError('No se encontraron tickets para esta acción. Actualiza la lista.'); setPaymentLoading(false); return; }
      setPaymentTarget({ row, tickets, mode });
      // Preselecciona los tickets de la vista actual (o todos si ninguno coincide).
      const preferred = tickets.filter(t => VIEWS[status].statuses.includes(t.status));
      setSelectedIds((mode === 'pay' && !preferred.length ? tickets.filter(t => DEBT_STATUSES.includes(t.status)) : preferred).map(t => t.id));
    } catch (issue) { setPaymentError(issue.message); }
    finally { setPaymentLoading(false); }
  }, [status]);

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
  const selectAll = () => { setConfirming(false); setPaymentError(''); setSelectedIds(paymentTarget?.tickets.map(t => t.id) || []); };
  const clearSelection = () => { setConfirming(false); setPaymentError(''); setSelectedIds([]); };

  const paymentSummary = useMemo(() => {
    if (!paymentTarget) return { selected: 0, changing: 0, total: 0 };
    const selected = paymentTarget.tickets.filter(t => selectedIds.includes(t.id));
    const total = selected.reduce((sum, t) => sum + Math.round(Number(t.unit_price ?? TICKET_PRICE) * 100), 0) / 100;
    return { selected: selected.length, changing: selected.length, total };
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
      if (paymentTarget.mode === 'pay') {
        await requestJson('/api/pending/tickets', jsonBody('PATCH', { studentId: paymentTarget.row.id, tickets, paymentMethod, expectedTotal: paymentSummary.total }));
      } else {
        await requestJson('/api/pending/tickets', jsonBody('POST', { studentId: paymentTarget.row.id, tickets, noShow: paymentTarget.mode === 'no_show' }));
      }
      setPaymentTarget(null);
      refresh();
    } catch (issue) { setPaymentError(issue.message); setConfirming(false); }
    finally { setSaving(false); }
  };

  const s = data?.summary;
  const mode = paymentTarget?.mode || 'pay';
  const view = VIEWS[status];

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
        <article className={styles.metric} aria-label="Monto por cobrar"><span><Banknote size={18} aria-hidden="true" />Monto por cobrar</span><strong>{money(s.due)}</strong><small>Según el precio de cada ticket recogido</small></article>
        <article className={styles.metric} aria-label="Sin recoger"><span><UserX size={18} aria-hidden="true" />Sin recoger</span><strong>{number(s.unpicked ?? 0)}</strong><small>{money(s.unpickedDue)} si los recogen · {number(s.noShow ?? 0)} marcados No recogió (no se cobran)</small></article>
      </section>
      <section className={styles.panel} aria-label="Lista de participantes con pago pendiente">
        <div className={styles.filters}>
          <div className="input-group"><label htmlFor="pending-search">Buscar participante, código o ticket</label><div className={styles.search}><Search size={18} /><input id="pending-search" type="search" className="input-field" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, código o número" /></div></div>
          <div className="input-group"><label htmlFor="pending-group">Grupo</label><select id="pending-group" className="input-field" value={group} onChange={event => { setGroup(event.target.value); setPage(1); }}><option value="all">Todos los grupos</option>{data.options.groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="input-group"><label htmlFor="pending-status">Situación</label><select id="pending-status" className="input-field" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>{Object.entries(VIEWS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></div>
        </div>
        <p className={styles.updated}>{refreshing ? 'Actualizando...' : `${number(rows.length)} de ${number(data.rows.length)} participantes · Actualizado: ${stamp(data.generatedAt)}`}</p>
        {rows.length ? <div className={styles.tableScroll}><table>
          <thead><tr><th>Participante</th><th>Tickets · {view.label.toLowerCase()}</th><th>{status === 'no_show' ? 'Marcado' : status === 'unpicked' ? 'Pendiente' : 'Debe'}</th><th>{status === 'no_show' ? 'Por' : 'Última entrega'}</th><th>Acciones</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.id}>
            <td><strong>{row.name}</strong><small>{row.code || 'Sin código'} · {row.groupLabel}</small></td>
            <td><div className={styles.tickets}>{row.tickets.filter(ticket => view.statuses.includes(ticket.status)).map(ticket => <span className={`badge ${STATUS_BADGE[ticket.status]}`} key={ticket.id} title={STATUS_TEXT[ticket.status]}>#{formatTicketNumber(ticket.number)}</span>)}</div><small>{[row.prepaid && `${row.prepaid} como Prepagado`, row.count - row.prepaid && `${row.count - row.prepaid} sin pago registrado`, row.unpicked && `${row.unpicked} sin recoger`, row.noShow && `${row.noShow} no recogió`].filter(Boolean).join(' · ')} · {row.assigned} {row.assigned === 1 ? 'ticket asignado' : 'tickets asignados'}</small></td>
            <td>{status === 'no_show' ? <span>No se cobra</span> : <strong className={styles.due}>{money(status === 'unpicked' ? row.unpickedDue : row.due)}</strong>}</td>
            {status === 'no_show' ? <td>{stamp(row.tickets.find(ticket => ticket.status === 'no_show')?.noShowAt)}<small>{[...new Set(row.tickets.map(ticket => ticket.noShowBy).filter(Boolean))].join(', ') || 'Encargado no registrado'}</small></td>
              : <td>{row.pickedAt ? stamp(row.pickedAt) : 'Aún no recoge'}<small>{row.deliveredBy.length ? `Entregó: ${row.deliveredBy.join(', ')}` : status === 'unpicked' ? 'Sin entrega registrada' : 'Encargado no registrado'}</small></td>}
            <td><div className={styles.rowLinks}>{row.id === 'extras' ? <span>Usa el lector de Entregas para consultarlos.</span> : status === 'no_show' ? <>
              <button type="button" className={styles.payButton} onClick={() => openPaymentModal(row, 'restore')} disabled={paymentLoading}>Deshacer No recogió</button>
            </> : <>
              <button type="button" className={styles.payButton} onClick={() => openPaymentModal(row, 'pay')} disabled={paymentLoading}>Registrar pago</button>
              <button type="button" className={styles.payButton} onClick={() => openPaymentModal(row, 'no_show')} disabled={paymentLoading}>No recogió</button>
              <Link href="/dashboard" onClick={() => openPerson(row, 'dashboard')}>Ver entrega</Link>
            </>}</div></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{data.rows.some(row => row.tickets.some(ticket => view.statuses.includes(ticket.status))) ? 'Ningún participante coincide con la búsqueda o los filtros.' : (status === 'no_show' ? 'Nadie figura como No recogió.' : status === 'unpicked' ? 'No hay tickets asignados sin recoger.' : 'Nadie ha recogido su pollada con el pago pendiente.')}</p>}
        {pages > 1 && <div className={styles.pagination}><span>Página {currentPage} de {pages}</span><button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn btn-secondary btn-sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
      </section>
      <p className={styles.note}>La deuda incluye los tickets activos ya recogidos que se entregaron como Prepagado (sin cobro en caja) o que no tienen pago registrado. Usa «No recogió» para quien tenía tickets asignados y no se presentó: se anula su entrega o Prepagado, deja de figurar como deuda (aquí y en Estadísticas) y puede deshacerse desde la situación «No recogió».</p>
    </div>}

    {/* Payment Modal */}
    <dialog ref={paymentDialog} className={`modal-content confirm-dialog ${styles.paymentDialog}`} aria-labelledby={paymentTitleId} onCancel={event => { event.preventDefault(); if (!saving) closePaymentModal(); }}>
      {paymentTarget && <div className={styles.paymentContent}>
        <div className={styles.paymentHeader}>
          <div>
            <h2 id={paymentTitleId}>{MODES[mode].title}</h2>
            <p className={styles.paymentName}>{paymentTarget.row.name}</p>
            <small>{paymentTarget.row.code || 'Sin código'} · {paymentTarget.row.groupLabel}</small>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Cerrar" disabled={saving} onClick={closePaymentModal}><X size={17} />Cerrar</button>
        </div>
        <form onSubmit={submitPayment} className={styles.paymentForm}>
          <div className={styles.paymentActions}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={selectAll}>{mode === 'pay' ? 'Pagar todo' : 'Seleccionar todo'}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={clearSelection}>Limpiar selección</button>
          </div>
          <fieldset className={styles.paymentTickets} disabled={saving}>
            <legend>{mode === 'restore' ? 'Tickets marcados como No recogió' : 'Tickets pendientes'}</legend>
            {paymentTarget.tickets.map(ticket => <label key={ticket.id}>
              <input type="checkbox" checked={selectedIds.includes(ticket.id)} onChange={() => toggleTicket(ticket.id)} aria-label={`Seleccionar ticket ${ticket.ticket_number}`} />
              <span>
                <strong>#{formatTicketNumber(ticket.ticket_number)}</strong>
                <small>{STATUS_TEXT[ticket.status]} · S/ {Number(ticket.unit_price ?? TICKET_PRICE).toFixed(2)}</small>
              </span>
            </label>)}
          </fieldset>
          {mode === 'pay' && <PaymentOptions label="Método de pago" value={paymentMethod} onChange={method => { setConfirming(false); setPaymentError(''); setPaymentMethod(method); }} disabled={saving} />}
          <div role="status" className={styles.paymentTotal}>
            <strong>{paymentSummary.selected} {paymentSummary.selected === 1 ? 'ticket seleccionado' : 'tickets seleccionados'}</strong>
            {mode === 'pay' ? <><span>{paymentSummary.changing} {paymentSummary.changing === 1 ? 'ticket por pagar' : 'tickets por pagar'}</span><b>Total a pagar: S/ {paymentSummary.total.toFixed(2)}</b></>
              : mode === 'no_show' ? <><b>Deja de cobrarse: S/ {paymentSummary.total.toFixed(2)}</b><small>Se anula la entrega y el Prepagado (S/ 0) de estos tickets. Siguen asignados a la persona.</small></>
              : <><b>Vuelve a cobrarse: S/ {paymentSummary.total.toFixed(2)}</b><small>Los tickets vuelven a figurar como asignados sin recoger.</small></>}
          </div>
          {confirming && <p className={styles.paymentWarning} role="alert">{mode === 'pay' ? `Confirma el pago de ${paymentSummary.changing} tickets por S/ ${paymentSummary.total.toFixed(2)} ${paymentMethod === 'cash' ? 'en efectivo' : 'con Yape'}. Se guardará tu usuario.`
            : mode === 'no_show' ? `Confirma que ${paymentTarget.row.name} no recogió ${paymentSummary.changing} ${paymentSummary.changing === 1 ? 'ticket' : 'tickets'}. Ya no se le cobrarán. Se guardará tu usuario.`
            : `Confirma que ${paymentSummary.changing} ${paymentSummary.changing === 1 ? 'ticket vuelve' : 'tickets vuelven'} a cobrarse. Se guardará tu usuario.`}</p>}
          {paymentError && <p role="alert" className="text-danger">{paymentError}</p>}
          <div className="confirm-actions">
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => confirming ? setConfirming(false) : closePaymentModal()}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving || !paymentSummary.changing}><Save size={16} />{saving ? 'Guardando...' : mode === 'pay' ? (confirming ? 'Confirmar pago' : 'Revisar pago') : mode === 'no_show' ? (confirming ? 'Confirmar No recogió' : 'Revisar No recogió') : (confirming ? 'Confirmar' : 'Revisar')}</button>
          </div>
        </form>
      </div>}
      {paymentLoading && <div className={styles.paymentLoading}><HandCoins size={32} />Cargando tickets del participante...</div>}
    </dialog>
  </div>;
}
