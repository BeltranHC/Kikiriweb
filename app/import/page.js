'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { parseCSV } from '@/lib/utils';
import { ClipboardList, FileText, Upload, Eye, Rocket, CheckCircle } from 'lucide-react';
import styles from './page.module.css';

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState(null);
  const toast = useToast();

  const handleFile = (selectedFile) => {
    if (!selectedFile || !selectedFile.name.endsWith('.csv')) {
      toast.error('Por favor selecciona un archivo CSV');
      return;
    }

    setFile(selectedFile);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const data = parseCSV(e.target.result);
      setPreview(data.slice(0, 10)); // Preview first 10 rows
    };
    reader.readAsText(selectedFile);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    handleFile(droppedFile);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setResult(data);
        if (data.studentsCreated === 0 && data.errors?.length > 0) {
          toast.error(`Error en importación: ${data.errors[0]}`);
        } else {
          toast.success(`${data.studentsCreated} estudiantes y ${data.ticketsCreated} tickets importados`);
          if (data.errors?.length > 0) {
            toast.warning(`Hubo ${data.errors.length} errores menores. Revisa la consola.`);
            console.warn("Import errors:", data.errors);
          }
        }
        setFile(null);
        setPreview([]);
      } else {
        toast.error(data.error || 'Error al importar');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Importar Datos</h1>
          <p className={styles.subtitle}>Carga estudiantes y tickets desde un archivo CSV</p>
        </div>
      </div>

      {/* Format Instructions */}
      <div className={styles.instructions}>
        <h3><ClipboardList size={20} className="inline-icon" /> Formato del CSV</h3>
        <p>El archivo CSV debe tener las siguientes columnas:</p>
        <div className={styles.codeBlock}>
          <code>nombre,codigo,dni,ticket_inicio,ticket_fin</code>
        </div>
        <p className="text-muted">
          Ejemplo: <code>Juan Pérez,2021-001,12345678,1,15</code>
        </p>
        <p className="text-muted" style={{ marginTop: '8px' }}>
          También se acepta: <code>nombre,codigo,dni,tickets</code> donde tickets es una lista separada por comas como <code>1;2;3;4;5</code>
        </p>
      </div>

      {/* Drop Zone */}
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".csv"
          className={styles.fileInput}
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {file ? (
          <>
            <span className={styles.dropIcon}><FileText size={48} /></span>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>
              {(file.size / 1024).toFixed(1)} KB
            </span>
          </>
        ) : (
          <>
            <span className={styles.dropIcon}><Upload size={48} /></span>
            <span className={styles.dropText}>
              Arrastra tu archivo CSV aquí o haz clic para seleccionar
            </span>
          </>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className={styles.previewSection}>
          <h3><Eye size={20} className="inline-icon" /> Vista previa ({preview.length} filas)</h3>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {Object.keys(preview[0]).map((key) => (
                    <th key={key}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((val, j) => (
                      <td key={j}>{val}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="btn btn-primary btn-lg w-full"
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? (
              <>
                <span className="spinner spinner-sm" />
                Importando...
              </>
            ) : (
              <>
                <Rocket size={16} className="inline-icon" /> Importar {preview.length}+ Estudiantes
              </>
            )}
          </button>
        </div>
      )}

      {/* Import Result */}
      {result && (
        <div className={styles.resultCard}>
          <h3><CheckCircle size={20} className="inline-icon" /> Importación Exitosa</h3>
          <div className={styles.resultStats}>
            <div className={styles.resultStat}>
              <span className={styles.resultValue}>{result.studentsCreated}</span>
              <span className={styles.resultLabel}>Estudiantes</span>
            </div>
            <div className={styles.resultStat}>
              <span className={styles.resultValue}>{result.ticketsCreated}</span>
              <span className={styles.resultLabel}>Tickets</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
