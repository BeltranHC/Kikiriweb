'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Ticket, Users, UserPlus, Pencil, RefreshCw, Upload, CheckCircle, Search, History } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import Pagination from '@/components/Pagination';
import StudentEditor from '@/components/StudentEditor';
import FacultyImport from '@/components/FacultyImport';
import ConfirmModal from '@/components/ConfirmModal';
import { useSearchState } from '@/hooks/useSearchState';
import { useFacultyDirectory } from '@/hooks/useFacultyDirectory';
import { SEMESTERS, semesterLabel, parseTicketNumbers, PROMOTION_SEMESTER } from '@/lib/faculty.mjs';
import { requestJson, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import styles from './page.module.css';

export default function DistributionPage() {
  const { query, page, ready, setQuery, setPage } = useSearchState('distribution');
  const [semester, setSemester] = useState('all');
  const [selected, setSelected] = useState(null);
  const [editor, setEditor] = useState(null);
  const [importing, setImporting] = useState(false);
  const [numberText, setNumberText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const directory = useFacultyDirectory(query, page, semester, ready);
  const toast = useToast();
  const assignmentPanel = useRef(null);
  const parsed = useMemo(() => { try { return { numbers: parseTicketNumbers(numberText), error: '' }; } catch (error) { return { numbers: [], error: error.message }; } }, [numberText]);
  const counts = Object.fromEntries(directory.semesters.map(group => [group.semester ?? 0, group.count]));
  const choose = student => { if (saving || confirming) return; setSelected(student); setNumberText(''); setSaveError(''); setReceipt(null); if (window.matchMedia('(max-width: 1000px)').matches) assignmentPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const changeSemester = value => { setSemester(value); setPage(1); };
  const savedStudent = student => {
    setSelected(previous => !editor?.student || previous?.id === student.id ? { ...previous, ...student, tickets: previous?.id === student.id ? previous.tickets : [] } : previous);
    toast.success('Datos del estudiante guardados'); directory.refresh();
  };
  const assign = async () => {
    if (saving || !selected || !parsed.numbers.length) return;
    setSaving(true); setSaveError('');
    try {
      const result = await requestJson('/api/faculty/assignments', jsonBody('POST', { studentId: selected.id, ticketNumbers: parsed.numbers }));
      const recipient = selected;
      setSelected(previous => previous?.id === recipient.id ? { ...previous, tickets: [...(previous.tickets || []), ...result.tickets].sort((a, b) => a.ticket_number - b.ticket_number) } : previous);
      setReceipt({ name: recipient.name, numbers: result.tickets.map(ticket => ticket.ticket_number) });
      setNumberText(''); setConfirming(false); directory.refresh();
      toast.success(`${result.ticketsCreated} tickets asignados`);
    } catch (error) { setSaveError(error.message); setConfirming(false); }
    finally { setSaving(false); }
  };
  return <div className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>FACULTAD · PADRÓN Y ASIGNACIONES</span><h1>Reparto de tickets</h1><p>Busca al estudiante, confirma sus datos y registra los tickets que recibe.</p></div>
      <div className={styles.actions}><Link className="btn btn-secondary" href="/distribution/history"><History size={17} />Historial de asignaciones</Link><button type="button" className="btn btn-secondary" onClick={() => setImporting(value => !value)}><Upload size={17} />{importing ? 'Cerrar importación' : 'Importar padrón'}</button><button type="button" className="btn btn-primary" onClick={() => setEditor({ student: null })}><UserPlus size={17} />Nuevo estudiante</button></div>
    </header>
    <section className={styles.metrics} aria-label="Resumen del padrón">
      <div><Users size={21} /><span>Estudiantes en padrón<strong>{directory.summary.totalStudents ?? '—'}</strong></span></div>
      <div><Ticket size={21} /><span>Con tickets asignados<strong>{directory.summary.withTickets ?? '—'}</strong></span></div>
      <div><UserPlus size={21} /><span>Sin tickets asignados<strong>{directory.summary.withoutTickets ?? '—'}</strong></span></div>
    </section>
    {importing && <FacultyImport onImported={directory.refresh} />}
    <div className={styles.workspace}>
      <section className={styles.directory} aria-label="Padrón por semestre">
        <div className={styles.directoryHeading}><div><h2>Estudiantes de la facultad</h2><p>Usa Editar datos para corregir el nombre, código, semestre o escuela de un estudiante.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={directory.loading} onClick={directory.refresh} aria-label="Actualizar padrón"><RefreshCw size={16} /></button></div>
        <SearchBar value={query} onSearch={setQuery} placeholder="Buscar por código, nombres o apellidos" />
        <div className={styles.semesters} role="group" aria-label="Filtrar por semestre">
          <button type="button" aria-pressed={semester === 'all'} onClick={() => changeSemester('all')}>Todos <span>{directory.summary.totalStudents ?? 0}</span></button>
          {SEMESTERS.map((label, index) => <button type="button" key={label} aria-pressed={semester === String(index + 1)} onClick={() => changeSemester(String(index + 1))}>{label} <span>{counts[index + 1] || 0}</span></button>)}
          <button type="button" aria-pressed={semester === String(PROMOTION_SEMESTER)} onClick={() => changeSemester(String(PROMOTION_SEMESTER))}>Promoción <span>{counts[PROMOTION_SEMESTER] || 0}</span></button>
          <button type="button" aria-pressed={semester === '0'} onClick={() => changeSemester('0')}>Sin semestre <span>{counts[0] || 0}</span></button>
        </div>
        <p className={styles.resultCount} role="status">{directory.loading ? 'Buscando estudiantes...' : `${directory.total} estudiantes encontrados`}</p>
        {directory.error && <div role="alert" className={styles.error}><p>{directory.error}</p><button type="button" className="btn btn-secondary btn-sm" onClick={directory.refresh}>Reintentar</button></div>}
        {!directory.error && directory.students.length === 0 && !directory.loading && <div className="empty-state"><Search size={34} /><h3>No encontramos estudiantes</h3><p>Prueba otro nombre o código, cambia el semestre o agrega al estudiante.</p><button className="btn btn-primary" type="button" onClick={() => setEditor({ student: null })}>Agregar estudiante</button></div>}
        <div className={styles.students}>{directory.students.map((student, index) => {
          const previous = directory.students[index - 1];
          const groupStart = index === 0 || previous.semester !== student.semester;
          return <div key={student.id}>{groupStart && <h3 className={styles.groupHeading}>{semesterLabel(student.semester)}</h3>}
            <article className={`${styles.student} ${selected?.id === student.id ? styles.selected : ''}`} aria-label={`${student.name}, ${student.code || 'sin código'}`}>
              <div className={styles.studentInfo}><strong>{student.name}</strong><div><span className={styles.code}>{student.code || 'Sin código'}</span><span>{student.school || 'Escuela sin confirmar'}</span></div><p>{student.tickets?.length || 0} tickets asignados{student.tickets?.length > 0 && ` · ${student.tickets.slice(0, 5).map(ticket => `#${ticket.ticket_number}`).join(', ')}${student.tickets.length > 5 ? '…' : ''}`}</p></div>
              <div className={styles.studentActions}><button type="button" className="btn btn-secondary btn-sm" aria-label={`Editar a ${student.name}`} title="Editar nombre, código, semestre y escuela" onClick={() => setEditor({ student })} disabled={saving}><Pencil size={15} /><span>Editar datos</span></button><button type="button" className={`btn ${selected?.id === student.id ? 'btn-secondary' : 'btn-primary'} btn-sm`} onClick={() => choose(student)} disabled={saving || confirming}>{selected?.id === student.id ? 'Seleccionado' : 'Asignar tickets'}</button></div>
            </article>
          </div>;
        })}</div>
        <Pagination page={page} total={directory.total} hasMore={directory.hasMore} loading={directory.loading} onPageChange={setPage} />
      </section>
      <aside ref={assignmentPanel} className={styles.assignment} aria-label="Asignar tickets al estudiante">
        <div className={styles.assignmentTitle}><span><Ticket size={21} /></span><div><h2>Asignar tickets</h2><p>Registra la entrega del talonario</p></div></div>
        {!selected ? <div className={styles.selectHint}><Users size={38} /><h3>Selecciona un estudiante</h3><p>Busca su código o nombre en el padrón y elige “Asignar tickets”.</p></div> : <>
          <div className={styles.recipient}><span className={styles.eyebrow}>ESTUDIANTE SELECCIONADO</span><h3>{selected.name}</h3><p><strong>{selected.code || 'Sin código'}</strong> · {semesterLabel(selected.semester)}</p><button type="button" className={styles.editLink} onClick={() => setEditor({ student: selected })} disabled={saving}><Pencil size={13} />Editar datos del estudiante</button></div>
          {(selected.tickets?.length || 0) > 0 && <details className={styles.existing}><summary>{selected.tickets.length} tickets ya asignados</summary><p>{selected.tickets.map(ticket => `#${ticket.ticket_number}`).join(', ')}</p></details>}
          <form className={styles.assignmentForm} onSubmit={event => { event.preventDefault(); if (parsed.numbers.length && !parsed.error) setConfirming(true); }} data-mutation-pending={saving ? 'true' : 'false'}>
            <div className="input-group"><label htmlFor="assignment-numbers">Números de ticket</label><textarea id="assignment-numbers" className="input-field" rows={3} maxLength={24000} value={numberText} onChange={event => { setNumberText(event.target.value); setSaveError(''); }} disabled={saving} placeholder="Ej.: 1050, 1052, 1060-1065" aria-describedby="assignment-help" /></div>
            <p id="assignment-help" className={styles.help}>Separa números con comas o espacios. Para números consecutivos, usa un rango como 1060-1065.</p>
            {parsed.error && <p role="alert" className="text-danger">{parsed.error}</p>}
            {parsed.numbers.length > 0 && <div className={styles.numberPreview}><strong>{parsed.numbers.length} {parsed.numbers.length === 1 ? 'ticket por asignar' : 'tickets por asignar'}</strong><p>{parsed.numbers.slice(0, 12).map(number => `#${number}`).join(', ')}{parsed.numbers.length > 12 ? '…' : ''}</p>{parsed.numbers.length > 12 && <details><summary>Ver todos los números</summary><p>{parsed.numbers.join(', ')}</p></details>}</div>}
            {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
            <button className="btn btn-primary" disabled={!parsed.numbers.length || !!parsed.error || saving}><Ticket size={17} />{saving ? 'Asignando...' : `Asignar ${parsed.numbers.length || ''} ${parsed.numbers.length === 1 ? 'ticket' : 'tickets'}`}</button>
            <p className={styles.help}>El reparto registra quién recibe cada ticket. El módulo de entregas está temporalmente inhabilitado.</p>
          </form>
        </>}
        {receipt && <div role="status" className={styles.success}><CheckCircle size={21} /><div><strong>Asignación guardada</strong><p>{receipt.name}: {receipt.numbers.map(number => `#${number}`).join(', ')}</p></div></div>}
      </aside>
    </div>
    <StudentEditor open={!!editor} student={editor?.student} onClose={() => setEditor(null)} onSaved={savedStudent} />
    <ConfirmModal isOpen={confirming} title="Confirmar asignación" isDanger={false} confirmText="Confirmar y asignar" onConfirm={assign} onCancel={() => setConfirming(false)}
      message={`Asignar ${parsed.numbers.length} tickets a ${selected?.name || ''} (${selected?.code || 'sin código'}): ${parsed.numbers.slice(0, 20).join(', ')}${parsed.numbers.length > 20 ? '…' : ''}. Verifica que los números coincidan con los tickets físicos.`} />
  </div>;
}
