'use client';

import { Pencil, Search, Trash2 } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { recipientLabel } from '@/lib/faculty.mjs';
import styles from '@/app/distribution/page.module.css';

export default function DirectoryResults({ directory, page, onPageChange, selected, assignmentClosed, saving, confirming, onEdit, onChoose, onDelete, className = '' }) {
  return (
      <section className={`${styles.directory} ${className}`} aria-busy={directory.loading} aria-label="Padrón por semestre">
        <p className={styles.resultCount} role="status">{directory.loading ? 'Buscando estudiantes...' : `${directory.total} estudiantes encontrados`}</p>
        {directory.error && <div role="alert" className={styles.error}><p>{directory.error}</p><button type="button" className="btn btn-secondary btn-sm" onClick={directory.refresh}>Reintentar</button></div>}
        {!directory.error && directory.students.length === 0 && !directory.loading && <div className="empty-state"><Search size={34} /><h3>No encontramos estudiantes</h3><p>Prueba otro nombre o código, cambia los filtros o agrega al estudiante.</p><button className="btn btn-primary" type="button" onClick={() => onEdit(null)}>Agregar estudiante</button></div>}
        <div className={styles.students}>{directory.students.map((student, index) => {
          const previous = directory.students[index - 1];
          const groupStart = index === 0 || previous.semester !== student.semester || previous.recipient_type !== student.recipient_type;
          return <div key={student.id}>{groupStart && <h3 className={styles.groupHeading}>{recipientLabel(student)}</h3>}
            <article className={`${styles.student} ${selected?.id === student.id ? styles.selected : ''}`} aria-label={`${student.name}, ${student.code || 'sin código'}`}>
              <div className={styles.studentInfo}><strong>{student.name}</strong><div><span className={styles.code}>{student.code || 'Sin código'}</span><span>{student.school || 'Escuela sin confirmar'}</span></div><p>{student.tickets?.length || 0} tickets asignados{student.tickets?.length > 0 && ` · ${student.tickets.slice(0, 5).map(ticket => `#${ticket.ticket_number}`).join(', ')}${student.tickets.length > 5 ? '…' : ''}`}</p>{student.tickets?.some(ticket => ticket.is_paid) && <span className={styles.paymentSummary}>{student.tickets.filter(ticket => ticket.is_paid).length} pagados</span>}</div>
              <div className={styles.studentActions}><button type="button" className="btn btn-secondary btn-sm" aria-label={`Editar a ${student.name}`} title="Editar nombre, código, semestre y escuela" onClick={() => onEdit(student)} disabled={saving}><Pencil size={15} /><span>Editar datos</span></button><button type="button" className={`btn btn-secondary btn-sm ${styles.deleteStudent}`} aria-label={`Eliminar a ${student.name}`} title="Eliminar participante" onClick={() => onDelete(student)} disabled={saving || confirming}><Trash2 size={16} aria-hidden="true" /></button><button type="button" className={`btn ${selected?.id === student.id ? 'btn-secondary' : 'btn-primary'} btn-sm`} onClick={() => onChoose(student)} disabled={saving || confirming}>{selected?.id === student.id ? (assignmentClosed ? 'Continuar asignación' : 'Seleccionado') : 'Asignar tickets'}</button></div>
            </article>
          </div>;
        })}</div>
        <Pagination page={page} total={directory.total} hasMore={directory.hasMore} loading={directory.loading} onPageChange={onPageChange} />
      </section>
  );
}
