'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchState } from '@/hooks/useSearchState';
import { useAssignmentHistory } from '@/hooks/useAssignmentHistory';
import Pagination from '@/components/Pagination';
import { APP_TIME_ZONE, parsePayment } from '@/lib/domain.mjs';
import { RECIPIENT_TYPES,semesterLabel } from '@/lib/faculty.mjs';
import styles from '../history/page.module.css';
const time=new Intl.DateTimeFormat('es-PE',{timeZone:APP_TIME_ZONE,dateStyle:'short',timeStyle:'short'});
const fields={name:'Nombre',code:'Código',recipient_type:'Categoría',semester:'Semestre',school:'Escuela',ticket_number:'Ticket',student_name:'Asignado a',is_available:'Disponibilidad',is_paid:'Pagado',payment_method:'Medio de pago',paid_amount:'Importe pagado',paid_at:'Fecha de pago',deleted_at:'Eliminado',is_picked_up:'Entregado'};
const display=(field,value)=>value==null?'—':field==='recipient_type'?RECIPIENT_TYPES[value]:field==='semester'?semesterLabel(value):field==='is_available'?(value?'Disponible':'Asignado'):field==='payment_method'?parsePayment(value).label:['paid_at','deleted_at'].includes(field)?time.format(new Date(value)):typeof value==='boolean'?(value?'Sí':'No'):String(value);
const operationLabel=item=>item.entity_type==='ticket'&&item.operation==='update'&&item.before_data?.is_paid!==item.after_data?.is_paid?(item.after_data?.is_paid?'Pago registrado':'Pago anulado'):({create:'Creación',update:'Modificación',delete:'Eliminación'}[item.operation]);
function values(item,side) { const before=item.before_data||{},after=item.after_data||{};return Object.entries(fields).filter(([key])=>before[key]!==after[key]).map(([key,label])=><p key={key}><strong>{label}:</strong> {display(key,(side==='before'?before:after)[key])}</p>); }
export default function ChangesPage() {
  const {query,page,ready,setQuery,setPage}=useSearchState('faculty-changes');const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const history=useAssignmentHistory(query,page,'all',from,to,ready,'changes');
  return <div className={styles.page}>
    <header className={styles.header}><div><Link className={styles.back} href="/distribution">Volver a Reparto</Link><h1>Historial de cambios</h1><p>Fichas, pagos, anulaciones, eliminaciones y reasignaciones con el usuario responsable.</p></div><button className="btn btn-secondary" type="button" disabled={history.refreshing} onClick={()=>history.refresh()}>Actualizar historial</button></header>
    <nav className={styles.tabs} aria-label="Tipo de historial"><Link href="/distribution/history">Asignaciones</Link><Link href="/distribution/changes" aria-current="page">Cambios de fichas y tickets</Link></nav>
    <section className={styles.filters} aria-label="Filtros de cambios"><div className={styles.search}><label htmlFor="changes-search">Buscar cambios por persona, ticket o usuario</label><div><Search size={18} aria-hidden="true" /><input id="changes-search" type="search" placeholder="Nombre, número o correo" value={query} onChange={event=>setQuery(event.target.value)} maxLength={200} /></div></div>
      <div className="input-group"><label htmlFor="changes-from">Desde</label><input id="changes-from" className="input-field" type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1);}} /></div>
      <div className="input-group"><label htmlFor="changes-to">Hasta</label><input id="changes-to" className="input-field" type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1);}} /></div></section>
    <p role="status">{history.loading?'Buscando cambios...':`${history.total} cambios registrados`}</p>
    {history.error&&<p role="alert" className={styles.error}>{history.error}</p>}
    {history.changes.length>0?<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Cambio</th><th>Persona</th><th>Antes</th><th>Después</th><th>Fecha y usuario</th></tr></thead><tbody>{history.changes.map(item=><tr key={item.id}>
      <td data-label="Cambio">{item.entity_type==='student'?'Ficha':'Ticket'} · {operationLabel(item)}{item.entity_type==='ticket'&&<p>#{item.after_data?.ticket_number??item.before_data?.ticket_number}</p>}</td><td data-label="Persona">{item.student_name||'Sin asignar'}</td>
      <td data-label="Antes"><div className={styles.changeValues}>{values(item,'before')}</div></td><td data-label="Después"><div className={styles.changeValues}>{values(item,'after')}</div></td>
      <td data-label="Fecha y usuario"><time dateTime={item.created_at}>{time.format(new Date(item.created_at))}</time><p className={styles.actor}>{item.actor_email||(item.actor_id?`Cuenta ${item.actor_id.slice(0,8)}`:'Sistema / SQL')}</p></td>
    </tr>)}</tbody></table></div>:!history.loading&&!history.error&&<p>No hay cambios para estos filtros. Los cambios anteriores a la activación de este registro no se reconstruyen.</p>}
    <Pagination itemName="cambios" singularName="cambio" ariaLabel="Paginación de cambios" page={page} total={history.total} hasMore={history.hasMore} loading={history.loading} onPageChange={setPage} />
  </div>;
}
