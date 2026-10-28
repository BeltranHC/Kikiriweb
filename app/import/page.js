'use client';

import { useState, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { parseCSV, MAX_CSV_BYTES } from '@/lib/csv.mjs';
import { importRows } from '@/lib/validation.mjs';
import { requestJson } from '@/lib/client';
import { Upload, CheckCircle } from 'lucide-react';
import styles from './page.module.css';

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const revision = useRef(0);
  const toast = useToast();
  const selectFile = async selected => {
    if (busy) return;
    const current = ++revision.current;
    setFile(null); setPreview([]); setRowCount(0); setResult(null); setError(''); setReading(true);
    try {
      if (!selected || !/\.csv$/i.test(selected.name)) throw new Error('Selecciona un archivo CSV');
      if (selected.size > MAX_CSV_BYTES) throw new Error('El archivo supera 2 MB');
      const rows = parseCSV(await selected.text());
      importRows(rows);
      if (current !== revision.current) return;
      setFile(selected); setPreview(rows.slice(0, 10)); setRowCount(rows.length);
    } catch (issue) { if (current === revision.current) setError(issue.message); }
    finally { if (current === revision.current) setReading(false); }
  };
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('file', file);
      const data = await requestJson('/api/import', { method: 'POST', body });
      setResult(data); setFile(null); setPreview([]); setRowCount(0); input.current.value = '';
      toast.success(`${data.studentsCreated} estudiantes y ${data.ticketsCreated} tickets importados`);
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  };
  return <div className={styles.page}>
    <div className={styles.header}><h1 className={styles.title}>Importar datos</h1><p className={styles.subtitle}>Carga estudiantes y tickets desde CSV</p></div>
    <div className={styles.instructions}>
      <h2>Formato del CSV</h2><p><code>nombre,ticket_inicio,ticket_fin</code></p><p>Ejemplo: <code>Juan Pérez,1,15</code></p>
      <p>También puedes usar <code>nombre,tickets</code> con una lista como <code>1;2;3</code>. Se aceptan archivos separados por comas o punto y coma, y las columnas opcionales código y DNI.</p>
      <p>Máximo 2 MB, 1000 estudiantes y 10 000 tickets. Si una fila falla, se cancela toda la importación.</p>
    </div>
    <input ref={input} type="file" accept=".csv" hidden disabled={busy} onChange={event => { const selected = event.target.files[0]; event.target.value = ''; if (selected) selectFile(selected); }} />
    <button type="button" className={`${styles.dropZone} ${file ? styles.hasFile : ''}`} disabled={busy}
      onClick={() => input.current.click()} onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); if (!busy) selectFile(event.dataTransfer.files[0]); }}>
      <Upload size={40} /><span>{reading ? 'Validando archivo...' : file ? `${file.name} · ${rowCount} estudiantes` : 'Arrastra un CSV o haz clic para seleccionarlo'}</span>
    </button>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {preview.length > 0 && <div className={styles.previewSection}>
      <h2>Vista previa: {preview.length} de {rowCount} filas</h2>
      <div className={styles.tableWrapper}><table className={styles.table}>
        <thead><tr>{Object.keys(preview[0]).map(key => <th key={key}>{key}</th>)}</tr></thead>
        <tbody>{preview.map((row, index) => <tr key={index}>{Object.entries(row).map(([key, value]) => <td key={key}>{value}</td>)}</tr>)}</tbody>
      </table></div>
      <button type="button" className="btn btn-primary" disabled={busy || reading} onClick={upload}>{busy ? 'Importando...' : `Importar ${rowCount} estudiantes`}</button>
    </div>}
    {result && <div className={styles.resultCard}><CheckCircle size={24} /><h2>Importación completada</h2><p>{result.studentsCreated} estudiantes y {result.ticketsCreated} tickets creados</p></div>}
  </div>;
}
