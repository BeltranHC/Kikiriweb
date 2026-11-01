'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X, Save } from 'lucide-react';
import { facultyStudentInput, SEMESTERS, PROMOTION_SEMESTER } from '@/lib/faculty.mjs';
import { requestJson, jsonBody } from '@/lib/client';
import styles from './StudentEditor.module.css';

export default function StudentEditor({ open, student, onClose, onSaved }) {
  const dialog = useRef(null);
  const title = useId();
  const [form, setForm] = useState({ name: '', code: '', semester: '', school: 'FINESI' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    setForm({ name: student?.name || '', code: student?.code || '', semester: String(student?.semester ?? ''), school: student?.school ?? 'FINESI' });
    setError(''); dialog.current.showModal();
  }, [open, student]);
  const submit = async event => {
    event.preventDefault(); if (busy) return;
    setError('');
    try {
      const input = facultyStudentInput(form);
      setBusy(true);
      const result = await requestJson('/api/faculty', jsonBody(student ? 'PATCH' : 'POST', {
        ...input, ...(student ? { id: student.id, expectedUpdatedAt: student.roster_updated_at } : {}),
      }));
      onSaved(result); onClose();
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  };
  const change = event => setForm(value => ({ ...value, [event.target.name]: event.target.value }));
  return <dialog ref={dialog} className={`modal-content confirm-dialog ${styles.dialog}`} aria-labelledby={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={`confirm-header ${styles.header}`}><h2 id={title}>{student ? 'Editar estudiante' : 'Nuevo estudiante'}</h2><button type="button" className={`btn btn-secondary btn-sm ${styles.closeButton}`} aria-label="Cerrar editor" onClick={onClose} disabled={busy}><X size={17} aria-hidden="true" />Cerrar</button></div>
    <form onSubmit={submit} className={styles.form}>
      <div className="input-group"><label htmlFor="faculty-name">Nombre completo</label><input autoFocus id="faculty-name" name="name" className="input-field" required maxLength={200} value={form.name} onChange={change} disabled={busy} /></div>
      <div className="input-group"><label htmlFor="faculty-code">Código de estudiante</label><input id="faculty-code" name="code" className="input-field" required maxLength={50} value={form.code} onChange={change} disabled={busy} autoComplete="off" /></div>
      <div className="input-group"><label htmlFor="faculty-semester">Semestre</label><select id="faculty-semester" name="semester" className="input-field" value={form.semester} onChange={change} disabled={busy}><option value="">Sin semestre confirmado</option>{SEMESTERS.map((label, index) => <option key={label} value={index + 1}>{label} semestre</option>)}<option value={PROMOTION_SEMESTER}>Promoción</option></select></div>
      <div className="input-group"><label htmlFor="faculty-school">Escuela profesional</label><input id="faculty-school" name="school" className="input-field" maxLength={120} value={form.school} onChange={change} disabled={busy} /></div>
      <p className="text-muted">Puedes corregir los datos y el semestre actual. Sus tickets permanecen asociados al guardar.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="confirm-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" disabled={busy}><Save size={16} />{busy ? 'Guardando...' : 'Guardar estudiante'}</button></div>
    </form>
  </dialog>;
}
