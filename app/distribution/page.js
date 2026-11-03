'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Ticket, Users, UserPlus, Pencil, RefreshCw, Upload, CheckCircle, Search, History, X, Download } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import Pagination from '@/components/Pagination';
import StudentEditor from '@/components/StudentEditor';
import TicketEditor from '@/components/TicketEditor';
import FacultyImport from '@/components/FacultyImport';
import ConfirmModal from '@/components/ConfirmModal';
import { useSearchState } from '@/hooks/useSearchState';
import { useFacultyDirectory } from '@/hooks/useFacultyDirectory';
import { SEMESTERS, parseTicketNumbers, PROMOTION_SEMESTER, RECIPIENT_TYPES, recipientLabel } from '@/lib/faculty.mjs';
import { request, requestJson, jsonBody } from '@/lib/client';
import { useToast } from '@/components/Toast';
import styles from './page.module.css';

export default function DistributionPage() {
  const { query, page, ready, setQuery, setPage } = useSearchState('distribution');
  const [semester, setSemester] = useState('all');
  const [type, setType] = useState('all');
  const [ticketEditor, setTicketEditor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [assignmentClosed, setAssignmentClosed] = useState(false);
  const [editor, setEditor] = useState(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [numberText, setNumberText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const directory = useFacultyDirectory(query, page, semester, ready, type);
  const toast = useToast();
  const assignmentPanel = useRef(null);
  const directoryPanel = useRef(null);
  const parsed = useMemo(() => { try { return { numbers: parseTicketNumbers(numberText), error: '' }; } catch (error) { return { numbers: [], error: error.message }; } }, [numberText]);
  const counts = Object.fromEntries(directory.semesters.map(group => [group.semester ?? 0, group.count]));
  const scrollToPanel = panel => {
    if (window.matchMedia('(max-width: 1000px)').matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const choose = student => {
    if (saving || confirming) return;
    if (selected?.id !== student.id) { setNumberText(''); setSaveError(''); setReceipt(null); }
    setSelected(student); setAssignmentClosed(false); scrollToPanel(assignmentPanel);
  };
  const closeAssignment = () => {
    if (saving || confirming) return;
    setAssignmentClosed(true); scrollToPanel(directoryPanel);
  };
  const changeSemester = value => { setSemester(value); setType(value === 'all' ? 'all' : 'student'); setPage(1); };
  const changeType = value => { setType(value); setSemester('all'); setPage(1); };
  const savedTicket = result => {
    setSelected(previous => previous?.id === result.previousStudentId ? {...previous,tickets:previous.tickets.filter(ticket => ticket.id !== result.ticket.id).concat(result.ticket.student_id === previous.id ? [result.ticket] : []).sort((a,b)=>a.ticket_number-b.ticket_number)} : previous);
    setReceipt(null); directory.refresh(); toast.success('Cambio de ticket registrado con tu usuario');
  };
  const savedStudent = student => {
    setSelected(previous => !editor?.student || previous?.id === student.id ? { ...previous, ...student, tickets: previous?.id === student.id ? previous.tickets : [] } : previous);
    if (!editor?.student) { setNumberText(''); setSaveError(''); setReceipt(null); setAssignmentClosed(false); scrollToPanel(assignmentPanel); }
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
  const exportParticipants = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await request('/api/faculty/export');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'participantes_tickets.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast.error(error.message); }
    finally { setExporting(false); }
  };
  return <div className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>FACULTAD · PADRÓN Y ASIGNACIONES</span><h1>Reparto de tickets</h1><p>Busca al estudiante, confirma sus datos y registra los tickets que recibe.</p></div>
      <div className={styles.actions} role="group" aria-label="Acciones del padrón">
        <Link className={`btn btn-secondary ${styles.actionButton}`} href="/distribution/history" aria-label="Historial de asignaciones" title="Historial de asignaciones"><History size={20} aria-hidden="true" /><span className={styles.actionLabel}>Historial de asignaciones</span></Link>
        <button type="button" className={`btn btn-secondary ${styles.actionButton}`} onClick={() => setImporting(true)} aria-label="Importar padrón" title="Importar padrón" aria-expanded={importing} aria-controls="faculty-import-panel"><Upload size={20} aria-hidden="true" /><span className={styles.actionLabel}>Importar padrón</span></button>
        <button type="button" className={`btn btn-secondary ${styles.actionButton}`} onClick={exportParticipants} disabled={exporting} aria-busy={exporting} aria-label="Exportar participantes CSV" title="Descargar todos los participantes y sus tickets asignados"><Download size={20} aria-hidden="true" /><span className={styles.actionLabel}>{exporting ? 'Exportando...' : 'Exportar CSV'}</span></button>
        <button type="button" className={`btn btn-primary ${styles.actionButton}`} onClick={() => setEditor({ student: null })} aria-label="Nuevo estudiante" title="Nuevo estudiante"><UserPlus size={20} aria-hidden="true" /><span className={styles.actionLabel}>Nuevo estudiante</span></button>
      </div>
    </header>
    <section ref={directoryPanel} className={styles.directorySearch} aria-label="Buscar en el padrón">
        <div className={styles.directoryHeading}><div><h2>Buscar en el padrón</h2><p>Usa Editar datos para corregir el nombre, código, semestre o escuela de un estudiante.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={directory.loading} onClick={directory.refresh} aria-label="Actualizar padrón"><RefreshCw size={16} /></button></div>
        <SearchBar value={query} onSearch={setQuery} placeholder="Buscar por código, nombres o apellidos" />
        <div className={styles.semesters} role="group" aria-label="Filtrar por semestre">
          <button type="button" aria-pressed={semester === 'all' && type === 'all'} onClick={() => changeSemester('all')}>Todos <span>{directory.summary.totalStudents ?? 0}</span></button>
          {SEMESTERS.map((label, index) => <button type="button" key={label} aria-pressed={semester === String(index + 1)} onClick={() => changeSemester(String(index + 1))}>{label} <span>{counts[index + 1] || 0}</span></button>)}
          <button type="button" aria-pressed={semester === String(PROMOTION_SEMESTER)} onClick={() => changeSemester(String(PROMOTION_SEMESTER))}>Promoción <span>{counts[PROMOTION_SEMESTER] || 0}</span></button>
          {['external','teacher'].map(value => <button type="button" key={value} aria-pressed={type === value} onClick={() => changeType(value)}>{RECIPIENT_TYPES[value]} <span>{directory.categories?.find(category => category.type === value)?.count || 0}</span></button>)}
          <button type="button" aria-pressed={semester === '0'} onClick={() => changeSemester('0')}>Sin semestre <span>{counts[0] || 0}</span></button>
        </div>
    </section>
    <section className={styles.metrics} aria-label="Resumen del padrón">
      <div><Users size={21} /><span>Personas en padrón<strong>{directory.summary.totalStudents ?? '—'}</strong></span></div>
      <div><Ticket size={21} /><span>Con tickets asignados<strong>{directory.summary.withTickets ?? '—'}</strong></span></div>
      <div><UserPlus size={21} /><span>Sin tickets asignados<strong>{directory.summary.withoutTickets ?? '—'}</strong></span></div>
    </section>
    {importing && <FacultyImport onImported={directory.refresh} onClose={() => setImporting(false)} />}
    <div className={`${styles.workspace} ${assignmentClosed ? styles.workspaceClosed : ''}`}>
      <section className={styles.directory} aria-label="Padrón por semestre">
        <p className={styles.resultCount} role="status">{directory.loading ? 'Buscando estudiantes...' : `${directory.total} estudiantes encontrados`}</p>
        {directory.error && <div role="alert" className={styles.error}><p>{directory.error}</p><button type="button" className="btn btn-secondary btn-sm" onClick={directory.refresh}>Reintentar</button></div>}
        {!directory.error && directory.students.length === 0 && !directory.loading && <div className="empty-state"><Search size={34} /><h3>No encontramos estudiantes</h3><p>Prueba otro nombre o código, cambia el semestre o agrega al estudiante.</p><button className="btn btn-primary" type="button" onClick={() => setEditor({ student: null })}>Agregar estudiante</button></div>}
        <div className={styles.students}>{directory.students.map((student, index) => {
          const previous = directory.students[index - 1];
          const groupStart = index === 0 || previous.semester !== student.semester || previous.recipient_type !== student.recipient_type;
          return <div key={student.id}>{groupStart && <h3 className={styles.groupHeading}>{recipientLabel(student)}</h3>}
            <article className={`${styles.student} ${selected?.id === student.id ? styles.selected : ''}`} aria-label={`${student.name}, ${student.code || 'sin código'}`}>
              <div className={styles.studentInfo}><strong>{student.name}</strong><div><span className={styles.code}>{student.code || 'Sin código'}</span><span>{student.school || 'Escuela sin confirmar'}</span></div><p>{student.tickets?.length || 0} tickets asignados{student.tickets?.length > 0 && ` · ${student.tickets.slice(0, 5).map(ticket => `#${ticket.ticket_number}`).join(', ')}${student.tickets.length > 5 ? '…' : ''}`}</p></div>
              <div className={styles.studentActions}><button type="button" className="btn btn-secondary btn-sm" aria-label={`Editar a ${student.name}`} title="Editar nombre, código, semestre y escuela" onClick={() => setEditor({ student })} disabled={saving}><Pencil size={15} /><span>Editar datos</span></button><button type="button" className={`btn ${selected?.id === student.id ? 'btn-secondary' : 'btn-primary'} btn-sm`} onClick={() => choose(student)} disabled={saving || confirming}>{selected?.id === student.id ? (assignmentClosed ? 'Continuar asignación' : 'Seleccionado') : 'Asignar tickets'}</button></div>
            </article>
          </div>;
        })}</div>
        <Pagination page={page} total={directory.total} hasMore={directory.hasMore} loading={directory.loading} onPageChange={setPage} />
      </section>
      <aside ref={assignmentPanel} hidden={assignmentClosed} className={styles.assignment} aria-label="Asignar tickets al estudiante">
        <div className={styles.assignmentTitle}><span><Ticket size={21} aria-hidden="true" /></span><div><h2>Asignar tickets</h2><p>Registra la entrega del talonario</p></div><button type="button" className={`btn btn-secondary btn-sm ${styles.panelClose}`} onClick={closeAssignment} disabled={saving || confirming} aria-label="Cerrar asignación"><X size={17} aria-hidden="true" />Cerrar</button></div>
        {!selected ? <div className={styles.selectHint}><Users size={38} /><h3>Selecciona un estudiante</h3><p>Busca su código o nombre en el padrón y elige “Asignar tickets”.</p></div> : <>
          <div className={styles.recipient}><span className={styles.eyebrow}>PERSONA SELECCIONADA</span><h3>{selected.name}</h3><p><strong>{selected.code || 'Sin código'}</strong> · {recipientLabel(selected)}</p><button type="button" className={styles.editLink} onClick={() => setEditor({ student: selected })} disabled={saving}><Pencil size={13} />Editar datos del estudiante</button></div>
          {(selected.tickets?.length || 0) > 0 && <details className={styles.existing}><summary>{selected.tickets.length} tickets asignados · Ver y editar</summary><ul className={styles.assignedTickets}>{selected.tickets.map(ticket => <li key={ticket.id}><span>#{ticket.ticket_number}</span><button type="button" className="btn btn-secondary btn-sm" aria-label={`Editar ticket ${ticket.ticket_number}`} disabled={!ticket.can_edit || saving} onClick={() => setTicketEditor({ticket,student:selected})}><Pencil size={14} aria-hidden="true" />Editar</button>{!ticket.can_edit && <small>{ticket.can_edit === false ? 'Protegido por pago o entrega' : 'Edición pendiente de activación'}</small>}</li>)}</ul></details>}
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
    <TicketEditor value={ticketEditor} onClose={() => setTicketEditor(null)} onSaved={savedTicket} />
    <StudentEditor open={!!editor} student={editor?.student} onClose={() => setEditor(null)} onSaved={savedStudent} />
    <ConfirmModal isOpen={confirming} title="Confirmar asignación" isDanger={false} confirmText="Confirmar y asignar" onConfirm={assign} onCancel={() => setConfirming(false)}
      message={`Asignar ${parsed.numbers.length} tickets a ${selected?.name || ''} (${selected?.code || 'sin código'}): ${parsed.numbers.slice(0, 20).join(', ')}${parsed.numbers.length > 20 ? '…' : ''}. Verifica que los números coincidan con los tickets físicos.`} />
  </div>;
}
