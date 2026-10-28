'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { Save, Trash2, GraduationCap } from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import Pagination from '@/components/Pagination';
import ConfirmModal from '@/components/ConfirmModal';
import { useStudents } from '@/hooks/useStudents';
import { useSearchState } from '@/hooks/useSearchState';
import { requestJson, jsonBody } from '@/lib/client';
import styles from './page.module.css';

const emptyForm = { name: '', code: '', dni: '', ticketStart: '', ticketEnd: '' };
export default function StudentsPage() {
  const { query, page, ready, setQuery, setPage } = useSearchState('students');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const { students, total, hasMore, loading, refresh } = useStudents(query, page, { enabled: ready });
  const toast = useToast();
  const submit = async event => {
    event.preventDefault(); setSaving(true);
    try {
      await requestJson('/api/students', jsonBody('POST', { ...form,
        ticketStart: form.ticketStart === '' ? null : Number(form.ticketStart),
        ticketEnd: form.ticketEnd === '' ? null : Number(form.ticketEnd),
      }));
      toast.success(`Estudiante "${form.name}" agregado con sus tickets`);
      setForm(emptyForm); setShowForm(false); await refresh(true);
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    try {
      await requestJson(`/api/students?id=${deleting.id}`, { method: 'DELETE' });
      toast.success('Estudiante eliminado'); setDeleting(null);
      if (students.length === 1 && page > 1) setPage(page - 1); else await refresh(true);
    } catch (error) { toast.error(error.message); }
  };
  const fields = [
    ['name', 'Nombre completo *', 'text'], ['code', 'Código', 'text'], ['dni', 'DNI', 'text'],
    ['ticketStart', 'Ticket inicio', 'number'], ['ticketEnd', 'Ticket fin', 'number'],
  ];
  return <div className={styles.page}>
    <div className={styles.header}><div><h1 className={styles.title}>Estudiantes</h1><p className={styles.subtitle}>Gestiona los estudiantes y sus tickets</p></div>
      <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancelar' : '+ Agregar estudiante'}</button>
    </div>
    {showForm && <form className={styles.form} onSubmit={submit}>
      <div className={styles.formGrid}>{fields.map(([key, label, type]) => <div className="input-group" key={key}>
        <label htmlFor={`student-${key}`}>{label}</label>
        <input id={`student-${key}`} type={type} className="input-field" value={form[key]} required={key === 'name'}
          min={type === 'number' ? 1 : undefined} step={type === 'number' ? 1 : undefined}
          maxLength={key === 'name' ? 200 : key === 'dni' ? 8 : key === 'code' ? 50 : undefined}
          pattern={key === 'dni' ? '[0-9]{8}' : undefined} inputMode={key === 'dni' ? 'numeric' : undefined}
          onChange={event => setForm({ ...form, [key]: event.target.value })} />
      </div>)}</div>
      <button className="btn btn-success" disabled={saving}><Save size={16} /> {saving ? 'Guardando...' : 'Guardar'}</button>
    </form>}
    <SearchBar value={query} onSearch={setQuery} />
    {loading && <p role="status" className="text-muted">Actualizando estudiantes...</p>}
    {students.length > 0 ? <div className={styles.tableWrapper}><table className={styles.table}>
      <thead><tr><th>Nombre</th><th>Código</th><th>DNI</th><th>Tickets</th><th>Recogidos</th><th>Acciones</th></tr></thead>
      <tbody>{students.map(student => <tr key={student.id}>
        <td>{student.name}</td><td>{student.code || '-'}</td><td>{student.dni || '-'}</td>
        <td>{student.tickets?.length || 0}</td><td>{student.tickets?.filter(ticket => ticket.is_picked_up).length || 0}/{student.tickets?.length || 0}</td>
        <td><button className="btn btn-danger btn-sm" aria-label={`Eliminar a ${student.name}`} onClick={() => setDeleting(student)}><Trash2 size={16} /></button></td>
      </tr>)}</tbody>
    </table></div> : !loading && <div className="empty-state"><GraduationCap size={48} /><h3>No hay estudiantes</h3></div>}
    <Pagination page={page} total={total} hasMore={hasMore} loading={loading} onPageChange={setPage} />
    <ConfirmModal isOpen={!!deleting} title="Eliminar estudiante" message={`¿Eliminar a ${deleting?.name || ''} y sus tickets? Los estudiantes con movimientos registrados deben conservarse.`}
      confirmText="Eliminar" onConfirm={remove} onCancel={() => setDeleting(null)} />
  </div>;
}
