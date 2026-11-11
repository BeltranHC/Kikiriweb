'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, History, X, CheckCircle, ScanBarcode } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import StudentCard from '@/components/StudentCard';
import StatsPanel from '@/components/StatsPanel';
import Pagination from '@/components/Pagination';
import ConfirmModal from '@/components/ConfirmModal';
import { useStudents } from '@/hooks/useStudents';
import { useSearchState } from '@/hooks/useSearchState';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useToast } from '@/components/Toast';
import { request,requestJson,jsonBody } from '@/lib/client';
import { deliverySelection } from '@/lib/delivery.mjs';
import { localDate } from '@/lib/domain.mjs';
import styles from './delivery.module.css';
const money=value=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(value||0);
export default function DashboardPage(){
 const {query,page,ready,setQuery,setPage}=useSearchState('dashboard');const [status,setStatus]=useState('all');
 const directory=useStudents(query,page,{enabled:ready,status});const [stats,setStats]=useState(null);const [selected,setSelected]=useState([]);const [pinned,setPinned]=useState([]);const [collapsed,setCollapsed]=useState([]);
 const [scanner,setScanner]=useState(false);const [confirming,setConfirming]=useState(false);const [method,setMethod]=useState('cash');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [undo,setUndo]=useState(null);const [undoError,setUndoError]=useState('');const [exporting,setExporting]=useState(false);const dialog=useRef(null);const searchInput=useRef(null);const toast=useToast();
 const summary=useMemo(()=>deliverySelection(selected),[selected]);
 const fetchStats=useCallback(async(signal)=>{try{setStats(await requestJson('/api/stats',{signal}));}catch(issue){if(!signal?.aborted&&issue.status!==401)toast.error(issue.message);}},[toast]);
 useEffect(()=>{const controller=new AbortController();fetchStats(controller.signal);return()=>controller.abort();},[fetchStats]);
 useAutoRefresh(()=>{directory.refresh({silent:true,background:true});fetchStats();},{enabled:ready&&!selected.length&&!confirming});
 useEffect(()=>{if(confirming)dialog.current.showModal();else dialog.current?.close();},[confirming]);
 const people=useMemo(()=>[...new Map([...directory.students,...pinned].map(person=>[person.id,person])).values()],[directory.students,pinned]);
 const toggle=(ticket,student)=>{if(busy||ticket.is_picked_up)return;setSelected(current=>current.some(item=>item.id===ticket.id)?current.filter(item=>item.id!==ticket.id):[...current,{...ticket,student}]);};
 const scan=async number=>{try{const ticket=await requestJson(`/api/tickets?number=${number}`);if(ticket.is_picked_up){toast.info('Este ticket ya fue entregado');return;}toggle(ticket,ticket.student);if(ticket.student)setPinned(current=>[ticket.student,...current.filter(person=>person.id!==ticket.student.id)]);}catch(issue){toast.error(issue.message);}};
 const deliver=async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{
  await requestJson('/api/tickets',jsonBody('PATCH',{ticketIds:selected.map(ticket=>ticket.id),isPickedUp:true,paymentMethod:summary.unpaid?method:null,expectedTickets:selected.map(ticket=>({id:ticket.id,updated_at:ticket.assignment_updated_at}))}));
  setConfirming(false);setSelected([]);setPinned([]);toast.success('Entrega registrada. Los pagos previos se conservaron.');directory.refresh({silent:true});fetchStats();
 }catch(issue){setError(issue.message);}finally{setBusy(false);}};
 const cancelDelivery=async()=>{try{await requestJson('/api/tickets',jsonBody('PATCH',{ticketIds:undo.ticketIds,isPickedUp:false,expectedMovementId:undo.movementId}));setUndo(null);setPinned([]);directory.refresh({silent:true});fetchStats();toast.info('Entrega anulada. El pago se conserva.');}catch(issue){setUndoError(issue.message);}};
 const exportCash=async()=>{setExporting(true);try{const response=await request(`/api/export?date=${localDate()}`);const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`cierre_caja_${localDate()}.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(issue){toast.error(issue.message);}finally{setExporting(false);}};
 return <div className={styles.page}>
  <header className={styles.header}><div><h1>Control de entregas</h1><p>Busca al participante o escanea su ticket. Los pagos previos se respetan.</p></div><div className={styles.actions}>
   <button className="btn btn-secondary btn-sm" onClick={()=>{directory.refresh({silent:true});fetchStats();}} disabled={directory.refreshing}><RefreshCw size={16}/>Actualizar</button>
   <Link className="btn btn-secondary btn-sm" href="/movements"><History size={16}/>Movimientos</Link><button className="btn btn-secondary btn-sm" onClick={exportCash} disabled={exporting}><Download size={16}/>Exportar caja de hoy</button>
  </div></header>
  <section className={styles.cash} aria-label="Caja de entregas"><article><span>Acumulado registrado</span><strong>{stats?money(stats.collectedTotal):'...'}</strong><small>Efectivo {money(stats?.collectedCashTotal)} / Yape {money(stats?.collectedYapeTotal)}</small>{Number(stats?.collectedOtherTotal)!==0&&stats&&<small>Otros medios previos: {money(stats.collectedOtherTotal)}</small>}</article>
   <article><span>Neto de hoy</span><strong>{stats?money(stats.collectedNow):'...'}</strong><small>Incluye Reparto y Entregas; descuenta anulaciones de pago.</small></article></section>
  {stats?.legacyWithoutDate>0&&<p className={styles.help}>{stats.legacyWithoutDate} pagos antiguos no tienen fecha registrada: se incluyen en el acumulado.</p>}
  <section aria-label="Buscar para entregar"><SearchBar value={query} onSearch={setQuery} inputRef={searchInput} onScan={scanner?scan:undefined} placeholder="Nombre, codigo o numero de ticket" />
   <div className={styles.filters}><div className="input-group"><label htmlFor="delivery-status">Estado de entregas</label><select id="delivery-status" className="input-field" value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">Todos</option><option value="pending">Con entregas pendientes</option><option value="completed">Completados</option></select></div>
   <button className="btn btn-secondary btn-sm" aria-pressed={scanner} onClick={()=>setScanner(!scanner)}><ScanBarcode size={16}/>{scanner?'Lector activado':'Activar lector'}</button></div>
  </section>
  {directory.error&&<p role="alert" className="text-danger">{directory.error}</p>}
  <p role="status" className={styles.help}>{directory.loading?'Buscando participantes...':`${directory.total} participantes con tickets`}</p>
  <div className={styles.people}>{people.map(person=><article key={person.id} aria-label={person.name}><StudentCard student={person} expanded={!collapsed.includes(person.id)} onToggleExpand={expanded=>setCollapsed(current=>expanded?current.filter(id=>id!==person.id):[...current,person.id])} hidePickupBar selectedTicketIds={selected.map(ticket=>ticket.id)} onToggleTicket={ticket=>toggle(ticket,person)} onUndoPickUp={(_,ticketId,ticketNumber,movementId)=>{setUndoError('');setUndo({ticketIds:[ticketId],movementId,ticketNumber});}} />
   <p className={styles.help}>{person.tickets.filter(ticket=>ticket.is_paid).length} tickets pagados / {person.tickets.filter(ticket=>!ticket.is_paid).length} pendientes de pago</p></article>)}</div>
  {!directory.loading&&!people.length&&<p>No hay participantes con tickets que coincidan con la busqueda.</p>}
  <Pagination itemName="participantes" singularName="participante" page={page} total={directory.total} hasMore={directory.hasMore} loading={directory.loading} onPageChange={setPage}/>
  <details><summary>Resumen completo de entregas y caja</summary><StatsPanel stats={stats}/></details>
  {selected.length>0&&<section className={styles.dock} aria-label="Seleccion de entrega"><span><strong>{selected.length} tickets seleccionados</strong><small>{summary.prepaid} pagados previamente / A cobrar: {money(summary.total)}</small></span><button className="btn btn-secondary btn-sm" onClick={()=>{setSelected([]);setPinned([]);}}>Limpiar</button><button className="btn btn-primary" onClick={()=>{setMethod('cash');setError('');setConfirming(true);}}>Entregar seleccionados</button></section>}
  <dialog ref={dialog} className={`modal-content confirm-dialog ${styles.dialog}`} aria-labelledby="delivery-confirm-title" onCancel={event=>{event.preventDefault();if(!busy)setConfirming(false);}}>
   <header className={styles.header}><h2 id="delivery-confirm-title">Confirmar entrega</h2><button className="btn btn-secondary btn-sm" aria-label="Cerrar confirmacion de entrega" disabled={busy} onClick={()=>setConfirming(false)}><X size={16}/>Cerrar</button></header>
   <form onSubmit={deliver}><ul className={styles.selectedList}>{selected.map(ticket=><li key={ticket.id}>#{ticket.ticket_number} - {ticket.student?.name||'Ticket extra'}: {ticket.is_paid?'pagado previamente':'pendiente de pago'}</li>)}</ul><p>{summary.prepaid} ya pagados. No se cobraran otra vez.</p><strong className={styles.total}>Total a cobrar ahora: {money(summary.total)}</strong>
    {summary.unpaid>0?<div className="input-group"><label htmlFor="delivery-payment">Medio del nuevo cobro</label><select id="delivery-payment" className="input-field" value={method} onChange={event=>setMethod(event.target.value)} disabled={busy}><option value="cash">Efectivo</option><option value="yape">Yape</option></select></div>:<p>Todos los tickets ya estan pagados. Solo se registrara la entrega.</p>}
    {error&&<p role="alert" className="text-danger">{error}</p>}<div className="confirm-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setConfirming(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy||!selected.length}><CheckCircle size={16}/>{busy?'Registrando...':'Confirmar y entregar'}</button></div>
   </form>
  </dialog>
  <ConfirmModal isOpen={!!undo} title="Anular entrega" message="Se anula solamente la entrega. El pago y su historial se conservan." error={undoError} onCancel={()=>setUndo(null)} onConfirm={cancelDelivery} confirmText="Confirmar anulacion"/>
 </div>;
}
