'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, HandCoins, Users, Ticket, Banknote, Search } from 'lucide-react';
import { pendingCSV } from '@/lib/pending.mjs';
import { APP_TIME_ZONE, localDate } from '@/lib/domain.mjs';
import { writeSearchState } from '@/lib/view-state.mjs';
import { requestJson } from '@/lib/client';
import { formatTicketNumber } from '@/lib/utils';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useSearchState } from '@/hooks/useSearchState';
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
            <td><div className={styles.rowLinks}>{row.id === 'extras' ? <span>Usa el lector de Entregas para consultarlos.</span> : <><Link href="/distribution" onClick={() => openPerson(row, 'distribution')}>Registrar pago</Link><Link href="/dashboard" onClick={() => openPerson(row, 'dashboard')}>Ver entrega</Link></>}</div></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{data.rows.length ? 'Ningún participante coincide con la búsqueda o los filtros.' : 'Nadie ha recogido su pollada con el pago pendiente.'}</p>}
        {pages > 1 && <div className={styles.pagination}><span>Página {currentPage} de {pages}</span><button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn btn-secondary btn-sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
      </section>
      <p className={styles.note}>Se incluyen los tickets activos ya recogidos que se entregaron como Prepagado (sin cobro en caja) o que no tienen pago registrado. Para cobrar, abre la ficha del participante en Reparto: anula el Prepagado y registra el pago en efectivo o Yape; al hacerlo sale de esta lista.</p>
    </div>}
  </div>;
}
