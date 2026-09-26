'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { Save, Trash2, GraduationCap } from 'lucide-react';
import styles from './page.module.css';

export default function StudentsPage() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', code: '', dni: '', ticketStart: '', ticketEnd: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchStudents = useCallback(async () => {
    try {
      const res = await fetch('/api/students');
      if (res.ok) {
        const data = await res.json();
        setStudents(data);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          code: formData.code,
          dni: formData.dni,
          ticketStart: parseInt(formData.ticketStart) || null,
          ticketEnd: parseInt(formData.ticketEnd) || null,
        }),
      });

      if (res.ok) {
        toast.success(`Estudiante "${formData.name}" agregado`);
        setFormData({ name: '', code: '', dni: '', ticketStart: '', ticketEnd: '' });
        setShowForm(false);
        fetchStudents();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Error al guardar');
      }
    } catch (err) {
      toast.error('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`¿Eliminar a "${name}" y todos sus tickets?`)) return;

    try {
      const res = await fetch(`/api/students?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Estudiante "${name}" eliminado`);
        fetchStudents();
      }
    } catch (err) {
      toast.error('Error al eliminar');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Estudiantes</h1>
          <p className={styles.subtitle}>Gestiona los estudiantes y sus tickets</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕ Cancelar' : '+ Agregar Estudiante'}
        </button>
      </div>

      {/* Add Student Form */}
      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formGrid}>
            <div className="input-group">
              <label>Nombre completo *</label>
              <input
                className="input-field"
                placeholder="Juan Pérez"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="input-group">
              <label>Código</label>
              <input
                className="input-field"
                placeholder="2021-001"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label>DNI</label>
              <input
                className="input-field"
                placeholder="12345678"
                value={formData.dni}
                onChange={(e) => setFormData({ ...formData, dni: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label>Ticket inicio</label>
              <input
                type="number"
                className="input-field"
                placeholder="1"
                value={formData.ticketStart}
                onChange={(e) => setFormData({ ...formData, ticketStart: e.target.value })}
                min="1"
              />
            </div>
            <div className="input-group">
              <label>Ticket fin</label>
              <input
                type="number"
                className="input-field"
                placeholder="15"
                value={formData.ticketEnd}
                onChange={(e) => setFormData({ ...formData, ticketEnd: e.target.value })}
                min="1"
              />
            </div>
          </div>
          <button type="submit" className="btn btn-success" disabled={saving}>
            {saving ? <span className="spinner spinner-sm" /> : <><Save size={16} className="inline-icon" /> Guardar</>}
          </button>
        </form>
      )}

      {/* Student List */}
      {loading ? (
        <div className={styles.loadingState}>
          <div className="spinner" />
          <p>Cargando estudiantes...</p>
        </div>
      ) : students.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Código</th>
                <th>DNI</th>
                <th>Tickets</th>
                <th>Recogidos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const total = student.tickets?.length || 0;
                const picked = student.tickets?.filter((t) => t.is_picked_up).length || 0;
                return (
                  <tr key={student.id}>
                    <td className={styles.nameCell}>
                      <div className={styles.miniAvatar}>
                        {student.name?.charAt(0)?.toUpperCase()}
                      </div>
                      {student.name}
                    </td>
                    <td>{student.code || '—'}</td>
                    <td>{student.dni || '—'}</td>
                    <td>
                      <span className="badge badge-primary">{total}</span>
                    </td>
                    <td>
                      <span className={`badge ${picked === total && total > 0 ? 'badge-success' : 'badge-warning'}`}>
                        {picked}/{total}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDelete(student.id, student.name)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-state-icon"><GraduationCap size={48} /></span>
          <h3>No hay estudiantes registrados</h3>
          <p className="text-muted">Agrega estudiantes manualmente o importa un CSV</p>
        </div>
      )}
    </div>
  );
}
