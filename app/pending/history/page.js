'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, History, Banknote, Smartphone, Search, Ticket } from 'lucide-react';
import { APP_TIME_ZONE, localDate } from '@/lib/domain.mjs';
import { requestJson } from '@/lib/client';
import { formatTicketNumber } from '@/lib/utils';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import styles from '../page.module.css';

const PAGE_SIZE = 20;
const number = value => new Intl.NumberFormat('es-PE').format(value || 0);
const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value || 0);
const stamp = value => value ? new Date(value).toLocaleString('es-PE', { timeZone: APP_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }) : '—';
const METHOD = { cash: 'Efectivo', yape: 'Yape' };
const ORIGIN = { pending: 'Deudores', other: 'Entregas / Reparto' };
const fold = value => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

export default function PaymentHistoryPage() {
  const [from, setFrom] = useState(() => localDate(Date.now() - 29 * 86400000)), [to, setTo] = useState(() => localDate());
  const [scope, setScope] = useState('all'), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [data, setData] = useState(null), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const controller = useRef(null);

  const refresh = useCallback(async () => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setRefreshing(true); setError('');
    try { const result = await requestJson('/api/pending/payments?' + new URLSearchParams({ from, to, scope }), { signal: current.signal }); if (!current.signal.aborted) setData(result); }
    catch (issue) { if (!current.signal.aborted) setError(issue.message); }
    finally { if (!current.signal.aborted) setRefreshing(false); }
  }, [from, to, scope]);
  useEffect(() => { refresh(); return () => controller.current?.abort(); }, [refresh]);
  useAutoRefresh(refresh, { enabled: !refreshing });

  const rows = useMemo(() => {
    const term = fold(query.trim().replace(/^#/, ''));
    return (data?.rows || []).filter(row => !term || fold(`${row.studentName} ${row.studentCode || ''} ${row.actor || ''} ${row.tickets.map(n => `${n} ${formatTicketNumber(n)}`).join(' ')}`).includes(term));
  }, [data, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), currentPage = Math.min(page, pages), visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filter = setter => event => { setter(event.target.value); setPage(1); };

  const exportReport = () => {
    const lines = [['Fecha', 'Tipo', 'Origen', 'Participante', 'Código', 'Tickets', 'Cantidad', 'Medio', 'Monto', 'Registrado por'].map(csvCell).join(',')]
      .concat(rows.map(row => [stamp(row.createdAt), row.kind === 'void' ? 'Anulación' : 'Pago', ORIGIN[row.origin], row.studentName, row.studentCode, row.tickets.map(formatTicketNumber).join(' '), row.tickets.length, METHOD[row.method], row.amount.toFixed(2), row.actor].map(csvCell).join(',')));
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `historial_pagos_${from}_${to}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const s = data?.summary;
  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}><Link href="/pending">DEUDORES</Link> · HISTORIAL</p><h1>Historial de pagos</h1><p>Pagos en efectivo o Yape registrados, con sus tickets, monto y el usuario que los registró.</p></div>
      <div className={styles.actions}>
        <Link className="btn btn-secondary btn-sm" href="/pending">Volver a Deudores</Link>
        <button className="btn btn-secondary btn-sm" disabled={refreshing} onClick={refresh}><RefreshCw size={16} className={refreshing ? styles.spinning : undefined} />Actualizar</button>
        <button className="btn btn-primary btn-sm" disabled={!rows.length || refreshing} onClick={exportReport}><Download size={16} />Exportar</button>
      </div>
    </header>
    {error && <div role="alert" className={styles.error}><strong>{error}</strong>{data && <p>Se muestran los datos de la consulta anterior.</p>}<button className="btn btn-secondary btn-sm" onClick={refresh}>Reintentar</button></div>}
    {!data && !error && <div role="status" className={styles.loading}><History size={32} />Buscando pagos...</div>}
    {data && <div className={styles.content} aria-busy={refreshing}>
      <section className={styles.metrics} aria-label="Resumen del historial de pagos">
        <article className={styles.metric}><span><History size={18} aria-hidden="true" />Pagos registrados</span><strong>{number(s.operations)}</strong><small>{number(s.voids)} {s.voids === 1 ? 'anulación' : 'anulaciones'} en el periodo</small></article>
        <article className={styles.metric}><span><Ticket size={18} aria-hidden="true" />Tickets pagados</span><strong>{number(s.tickets)}</strong></article>
        <article className={styles.metric}><span><Banknote size={18} aria-hidden="true" />Efectivo</span><strong>{money(s.cash)}</strong></article>
        <article className={styles.metric}><span><Smartphone size={18} aria-hidden="true" />Yape</span><strong>{money(s.yape)}</strong><small>Total neto: {money(s.net)}</small></article>
      </section>
      <section className={styles.panel} aria-label="Lista de pagos">
        <div className={styles.historyFilters}>
          <div className="input-group"><label htmlFor="history-search">Buscar participante, ticket o usuario</label><div className={styles.search}><Search size={18} /><input id="history-search" type="search" className="input-field" value={query} onChange={filter(setQuery)} placeholder="Nombre, código, número o correo" /></div></div>
          <div className="input-group"><label htmlFor="history-from">Desde</label><input id="history-from" type="date" className="input-field" value={from} max={to} onChange={filter(setFrom)} /></div>
          <div className="input-group"><label htmlFor="history-to">Hasta</label><input id="history-to" type="date" className="input-field" value={to} min={from} onChange={filter(setTo)} /></div>
          <div className="input-group"><label htmlFor="history-scope">Origen</label><select id="history-scope" className="input-field" value={scope} onChange={filter(setScope)}><option value="all">Todos los pagos</option><option value="pending">Solo cobros en Deudores</option></select></div>
        </div>
        <p className={styles.updated}>{refreshing ? 'Actualizando...' : `${number(rows.length)} ${rows.length === 1 ? 'registro' : 'registros'} · Fechas y horas de Lima · Actualizado: ${stamp(data.generatedAt)}`}</p>
        {rows.length ? <div className={styles.tableScroll}><table>
          <thead><tr><th>Fecha</th><th>Participante</th><th>Tickets</th><th>Medio</th><th>Monto</th><th>Registrado por</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.id}>
            <td>{stamp(row.createdAt)}<small>{row.kind === 'void' ? 'Anulación de pago' : 'Pago'} · {ORIGIN[row.origin]}</small></td>
            <td><strong>{row.studentName}</strong><small>{row.studentCode || 'Sin código'}</small></td>
            <td><div className={styles.tickets}>{row.tickets.map(n => <span className={`badge ${row.kind === 'void' ? 'badge-danger' : 'badge-success'}`} key={n}>#{formatTicketNumber(n)}</span>)}</div><small>{row.tickets.length} {row.tickets.length === 1 ? 'ticket' : 'tickets'}</small></td>
            <td>{METHOD[row.method]}</td>
            <td><strong className={row.kind === 'void' ? 'text-danger' : undefined}>{money(row.amount)}</strong></td>
            <td>{row.actor || 'Usuario no registrado'}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{data.rows.length ? 'Ningún pago coincide con la búsqueda.' : 'No hay pagos registrados en este periodo.'}</p>}
        {pages > 1 && <div className={styles.pagination}><span>Página {currentPage} de {pages}</span><button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn btn-secondary btn-sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
      </section>
      <p className={styles.note}>Cada cobro hecho en Deudores aparece como una sola fila con todos sus tickets. Los pagos y anulaciones registrados en Entregas o Reparto aparecen ticket por ticket. Las anulaciones de Prepagado (S/ 0) no se muestran.</p>
    </div>}
  </div>;
}
