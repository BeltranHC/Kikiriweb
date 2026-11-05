'use client';

import { X } from 'lucide-react';
import { SEMESTERS, PROMOTION_SEMESTER, RECIPIENT_TYPES } from '@/lib/faculty.mjs';
import styles from './DirectoryFilters.module.css';

const percentage = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
function coverage(group = {}) {
  const total = group.count ?? 0;
  const assigned = group.withTickets;
  const available = Number.isSafeInteger(assigned) && assigned >= 0 && assigned <= total;
  const value = available && total > 0 ? assigned / total * 100 : null;
  return { total, assigned, value, label: value === null ? '\u2014' : `${percentage.format(value)}%` };
}
function groupDescription(label, progress) {
  if (!progress.total) return `${label}: sin participantes`;
  return progress.value === null ? `${label}: avance no disponible` : `${label}: ${progress.assigned} de ${progress.total} con al menos un ticket (${progress.label})`;
}

export default function DirectoryFilters({ directory, semester, type, ticketStatus, hasFilters, onSemesterChange, onTypeChange, onTicketStatusChange, onClear }) {
  const semesters = new Map(directory.semesters.map(group => [group.semester ?? 0, group]));
  const otherGroups = [
    { label: 'Promoci\u00f3n', value: String(PROMOTION_SEMESTER), data: semesters.get(PROMOTION_SEMESTER) },
    ...['external', 'teacher'].map(value => ({ label: RECIPIENT_TYPES[value], type: value, data: directory.categories?.find(group => group.type === value) })),
    { label: 'Sin semestre', value: '0', data: semesters.get(0) },
  ];
  const groupValue = ['0', String(PROMOTION_SEMESTER)].includes(semester) ? `semester:${semester}` : type;
  const selectGroup = value => {
    if (value.startsWith('semester:')) onSemesterChange(value.slice(9));
    else if (value === 'all') onSemesterChange('all');
    else onTypeChange(value);
  };
  return <div className={styles.panel}>
    <div className={styles.panelHeader}><p className={styles.label}>Filtrar padrón</p>{hasFilters && <button type="button" className={styles.clear} onClick={onClear}><X size={14} aria-hidden="true" />Limpiar filtros</button>}</div>
    <div role="group" aria-label="Filtrar por semestre">
      <div className={styles.mobileGroups}>
        <label htmlFor="directory-group" className={styles.label}>Grupo</label>
        <select id="directory-group" className="input-field" aria-label="Grupo de participantes" value={groupValue} onChange={event => selectGroup(event.target.value)}>
          <option value="all">Todos los participantes ({directory.summary.totalStudents ?? 0})</option>
          <option value="student">Estudiantes ({directory.categories?.find(group => group.type === 'student')?.count ?? 0})</option>
          {otherGroups.map(group => <option key={group.type || group.value} value={group.type || `semester:${group.value}`}>{group.label} ({group.data?.count ?? 0}){coverage(group.data).value !== null ? ` - ${coverage(group.data).label}` : ''}</option>)}
        </select>
      </div>
      <div className={styles.groups}>
        <button type="button" className={styles.groupButton} aria-pressed={semester === 'all' && type === 'all'} onClick={() => onSemesterChange('all')}>Todos <span className={styles.count}>{directory.summary.totalStudents ?? '\u2014'}</span></button>
        {otherGroups.map(group => {
          const progress = coverage(group.data);
          return <button key={group.type || group.value} type="button" className={styles.groupButton}
            aria-pressed={group.type ? type === group.type : semester === group.value}
            title={groupDescription(group.label, progress)} onClick={() => group.type ? onTypeChange(group.type) : onSemesterChange(group.value)}>
            {group.label}<span className={styles.count}>{progress.total}</span>{progress.value !== null && <span className={styles.groupPercentage}>{progress.label}</span>}
          </button>;
        })}
      </div>
      <div className={styles.semesterHeading}><p className={styles.label}>Semestres y avance</p><p>Alumnos con al menos un ticket asignado</p></div>
      <div className={styles.semesters}>
        {SEMESTERS.map((label, index) => {
          const progress = coverage(semesters.get(index + 1));
          const description = groupDescription(`${label} semestre`, progress);
          return <button key={label} type="button" className={styles.semester} aria-pressed={semester === String(index + 1)}
            aria-label={`${label} ${progress.total} alumnos. ${description}`} title={description}
            data-complete={progress.value === 100 ? 'true' : undefined} onClick={() => onSemesterChange(String(index + 1))}>
            <span className={styles.semesterTop}><strong>{label}</strong><span className={styles.count}>{progress.total}</span></span>
            <span className={styles.percentage}>{progress.label}</span>
            <span className={styles.track} aria-hidden="true"><span style={{ width: `${progress.value ?? 0}%` }} /></span>
          </button>;
        })}
      </div>
    </div>
    <div className={styles.assignmentFilters}>
      <p className={styles.label}>Estado de asignación</p>
      <div role="group" aria-label="Filtrar por tickets asignados">
        {[['all', 'Todos'], ['without', 'Sin tickets'], ['with', 'Con tickets']].map(([value, label]) => <button type="button" key={value} aria-pressed={ticketStatus === value} onClick={() => onTicketStatusChange(value)}>{label}</button>)}
      </div>
    </div>
  </div>;
}
