'use client';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Aceptar', cancelText = 'Cancelar', isDanger = true }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div style={{
            background: isDanger ? 'var(--danger-bg)' : 'var(--info-bg)',
            color: isDanger ? 'var(--danger-light)' : 'var(--info)',
            padding: '12px',
            borderRadius: '50%',
            display: 'flex',
            border: `1px solid ${isDanger ? 'var(--danger-border)' : 'var(--info-border)'}`
          }}>
            <AlertTriangle size={28} />
          </div>
          <button onClick={onCancel} style={{ color: 'var(--text-tertiary)', padding: '4px', cursor: 'pointer', background: 'none', border: 'none' }}>
            <X size={20} />
          </button>
        </div>
        
        <h3 style={{ fontSize: '1.35rem', marginBottom: '12px', color: 'var(--text-primary)', fontFamily: 'var(--font-heading)', fontWeight: '700' }}>{title}</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '28px', lineHeight: '1.5' }}>{message}</p>
        
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={onCancel} style={{ flex: '1', minWidth: '120px' }}>{cancelText}</button>
          <button className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} style={{ flex: '1', minWidth: '120px' }}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
