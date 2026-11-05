'use client';

import Link from 'next/link';
import { useState } from 'react';
import { History,RefreshCw,Ticket,Users,ArrowLeft,Search,Clock,Pencil } from 'lucide-react';
import AssignmentTickets from '@/components/AssignmentTickets';
import Pagination from '@/components/Pagination';
import { useSearchState } from '@/hooks/useSearchState';
import { useAssignmentHistory } from '@/hooks/useAssignmentHistory';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { SEMESTERS,PROMOTION_SEMESTER,recipientLabel } from '@/lib/faculty.mjs';
import { APP_TIME_ZONE } from '@/lib/domain.mjs';
import { formatTicketNumber } from '@/lib/utils';
import styles from './page.module.css';

const dateTime=new Intl.DateTimeFormat('es-PE',{timeZone:APP_TIME_ZONE,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
export default function AssignmentHistoryPage() {
  const {query,page,ready,setQuery,setPage}=useSearchState('assignment-history');
  const [managing,setManaging]=useState(null);
  const [semester,setSemester]=useState('all');const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const history=useAssignmentHistory(query,page,semester,from,to,ready);
  useAutoRefresh(()=>history.refresh({silent:true,background:true}),{enabled:ready});
  const filter=(setter,value)=>{setter(value);setPage(1);};
  const clear=()=>{setQuery('');setSemester('all');setFrom('');setTo('');setPage(1);};
  return <div className={styles.page}>
    <header className={styles.header}><div><Link className={styles.back} href="/distribution"><ArrowLeft size={15} />Volver a Reparto</Link><h1>Historial de asignaciones</h1><p>Quién recibió cada lote de tickets y qué encargado lo registró.</p></div>
      <button type="button" className="btn btn-secondary" onClick={()=>history.refresh()} disabled={history.refreshing}><RefreshCw size={16} />{history.refreshing?'Actualizando...':'Actualizar historial'}</button></header>
    <nav className={styles.tabs} aria-label="Tipo de historial"><Link href="/distribution/history" aria-current="page">Asignaciones</Link><Link href="/distribution/changes">Cambios de fichas y tickets</Link></nav>
    <section className={styles.summary} aria-label="Resumen de asignaciones">
      {[['Asignaciones',history.summary.assignments,History],['Tickets registrados',history.summary.tickets,Ticket],['Estudiantes',history.summary.students,Users]].map(([label,value,Icon])=><div key={label}><Icon size={21} /><span>{label}<strong>{value??'—'}</strong></span></div>)}
    </section>
    <section className={styles.filters} aria-label="Filtros del historial">
      <div className={styles.search}><label htmlFor="assignment-history-search">Buscar por ticket, estudiante, código o encargado</label><div><Search size={18} /><input id="assignment-history-search" type="search" maxLength={200} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Ej.: 1050, Pérez, código o correo" /></div></div>
      <div className="input-group"><label htmlFor="history-from">Desde</label><input id="history-from" className="input-field" type="date" value={from} onChange={event=>filter(setFrom,event.target.value)} /></div>
      <div className="input-group"><label htmlFor="history-to">Hasta</label><input id="history-to" className="input-field" type="date" value={to} onChange={event=>filter(setTo,event.target.value)} /></div>
      <div className="input-group"><label htmlFor="history-semester">Grupo al asignar</label><select id="history-semester" className="input-field" value={semester} onChange={event=>filter(setSemester,event.target.value)}><option value="all">Todos los grupos</option>{SEMESTERS.map((label,index)=><option key={label} value={index+1}>{label} semestre</option>)}<option value={PROMOTION_SEMESTER}>Promoción</option><option value="0">Sin semestre</option></select></div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={clear}>Limpiar filtros</button>
    </section>
    <div className={styles.meta}><p role="status">{history.loading?'Buscando asignaciones...':`${history.total} ${history.total===1?'asignación encontrada':'asignaciones encontradas'}`}</p><span><Clock size={13} />Fechas y horas de Lima, Perú</span></div>
    {history.error&&<div role="alert" className={styles.error}>{history.error}<button type="button" className="btn btn-secondary btn-sm" onClick={()=>history.refresh()}>Reintentar</button></div>}
    {history.assignments.length>0?<div className={styles.tableWrap} aria-busy={history.loading}><table className={styles.table}><thead><tr><th>Asignación</th><th>Estudiante</th><th>Tickets asignados</th><th>Fecha y hora</th><th>Encargado</th><th>Acciones</th></tr></thead><tbody>{history.assignments.map(item=><tr key={item.id}>
      <td data-label="Asignación"><strong className={styles.reference} title={item.id}>ASG-{item.id.slice(0,8)}</strong><span className={styles.badge}>{item.ticket_numbers.length} {item.ticket_numbers.length===1?'ticket':'tickets'}</span></td>
      <td data-label="Estudiante"><strong>{item.student_name}</strong><p className={styles.code}>{item.student_code||'Sin código registrado'}</p><span className={styles.group}>{recipientLabel(item)}</span>{item.current_student_name&&item.current_student_name!==item.student_name&&<p className={styles.current}>Perfil actual: {item.current_student_name}</p>}</td>
      <td data-label="Tickets asignados"><div className={styles.tickets}>{item.ticket_numbers.slice(0,12).map(number=><span key={number}>#{formatTicketNumber(number)}</span>)}</div>{item.ticket_numbers.length>12&&<details className={styles.allTickets}><summary>Ver los {item.ticket_numbers.length} tickets</summary><p>{item.ticket_numbers.map(number=>`#${formatTicketNumber(number)}`).join(', ')}</p></details>}</td>
      <td data-label="Fecha y hora"><time dateTime={item.created_at}>{dateTime.format(new Date(item.created_at))}</time></td>
      <td data-label="Encargado"><span className={styles.actor}>{item.actor_email||`Cuenta ${item.actor_id?.slice(0,8)||'sin correo'}`}</span><span className={styles.recorded}>Asignación registrada</span></td>
      <td data-label="Acciones"><button type="button" className={`btn btn-secondary btn-sm ${styles.manage}`} onClick={()=>setManaging(item)} aria-label={`Editar tickets de ${item.student_name}, ASG-${item.id.slice(0,8)}`}><Pencil size={15} aria-hidden="true" />Editar / pagos</button></td>
    </tr>)}</tbody></table></div>:!history.loading&&!history.error&&<div className="empty-state"><History size={42} /><h2>{query||from||to||semester!=='all'?'No hay coincidencias':'Todavía no hay asignaciones'}</h2><p>{query||from||to||semester!=='all'?'Prueba otro nombre, ticket o rango de fechas.':'Los lotes que registres en Reparto aparecerán aquí con sus tickets y encargado.'}</p><Link className="btn btn-primary" href="/distribution">Ir a Reparto</Link></div>}
    <Pagination itemName="asignaciones" singularName="asignación" ariaLabel="Paginación de asignaciones" page={page} total={history.total} hasMore={history.hasMore} loading={history.loading} onPageChange={setPage} />
    <AssignmentTickets value={managing} onClose={()=>setManaging(null)} onChanged={()=>history.refresh({silent:true})} />
    <p className={styles.footnote}>Los datos de cada registro corresponden al momento de la asignación.</p>
  </div>;
}
