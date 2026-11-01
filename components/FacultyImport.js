'use client';

import { useRef, useState } from 'react';
import { Upload, CheckCircle, X } from 'lucide-react';
import { MAX_CSV_BYTES } from '@/lib/csv.mjs';
import { decodeFacultyCSV, parseFacultyCSV, semesterLabel } from '@/lib/faculty.mjs';
import { requestJson } from '@/lib/client';
import styles from '@/app/distribution/page.module.css';

export default function FacultyImport({ onImported, onClose }) {
  const [file, setFile] = useState(null);
  const [students, setStudents] = useState([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const revision = useRef(0);
  const select = async event => {
    const selected = event.target.files?.[0]; event.target.value = '';
    if (!selected) return;
    const current = ++revision.current;
    setFile(null); setStudents([]); setResult(null); setError(''); setReading(true);
    try {
      if (!/\.csv$/i.test(selected.name) || selected.size > MAX_CSV_BYTES) throw new Error('Selecciona un CSV de hasta 2 MB');
      const rows = parseFacultyCSV(decodeFacultyCSV(await selected.arrayBuffer()));
      if (revision.current !== current) return;
      setStudents(rows); setFile(selected);
    } catch (issue) { if (revision.current === current) setError(issue.message); }
    finally { if (revision.current === current) setReading(false); }
  };
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('file', file);
      const data = await requestJson('/api/faculty/import', { method: 'POST', body });
      setResult(data); setFile(null); setStudents([]); onImported();
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  };
  const schools = [...new Set(students.map(student => student.school).filter(Boolean))];
  const groups = [...new Set(students.map(student => student.semester))];
  return <section id="faculty-import-panel" className={styles.importPanel} aria-label="Importar padrón de la facultad">
    <div className={styles.panelHeading}><h2>Importar padrón</h2><button type="button" className={`btn btn-secondary btn-sm ${styles.panelClose}`} onClick={onClose} disabled={busy} aria-label="Cerrar importación"><X size={17} aria-hidden="true" />Cerrar</button></div>
    <p>Columnas: Código, Nombres, Apellidos, Escuela Profesional y Semestre. También admite Nombre completo y semestres del I al X.</p>
    <label className={styles.filePicker}><Upload size={20} /><span>{reading ? 'Leyendo padrón...' : 'Seleccionar CSV de la facultad'}<input type="file" accept=".csv,text/csv" onChange={select} disabled={busy || reading} aria-label="CSV del padrón" /></span></label>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {file && <>
      <p><strong>{students.length} estudiantes</strong> en {groups.length} grupos · {file.name}</p>
      <div className={styles.semesterSummary}>{groups.map(semester => <span key={semester ?? 0}>{semesterLabel(semester)}: <strong>{students.filter(student => student.semester === semester).length}</strong></span>)}</div>
      {schools.length > 1 && <p className={styles.notice}>El archivo contiene estas escuelas: {schools.join(', ')}. Se conservarán como están; puedes corregirlas al editar al estudiante.</p>}
      <div className={styles.preview}><table><thead><tr><th>Código</th><th>Estudiante</th><th>Semestre</th></tr></thead><tbody>{students.slice(0, 8).map(student => <tr key={student.code}><td>{student.code}</td><td>{student.name}</td><td>{semesterLabel(student.semester)}</td></tr>)}</tbody></table></div>
      <p className="text-muted">Los códigos existentes se conservan sin reemplazar sus datos. Si un alumno antiguo no tiene código, completa su código antes de importar para vincularlo. Esta importación no crea tickets.</p>
      <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || reading}>{busy ? 'Importando...' : `Importar ${students.length} estudiantes`}</button>
    </>}
    {result && <div role="status" className={styles.success}><CheckCircle size={20} />{result.studentsCreated} estudiantes nuevos y {result.studentsExisting} ya registrados. Padrón actualizado.</div>}
  </section>;
}
