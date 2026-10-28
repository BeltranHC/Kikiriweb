'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Aceptar', cancelText = 'Cancelar', isDanger = true }) {
  const dialog = useRef(null);
  const titleId = useId();
  const messageId = useId();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isOpen) { dialog.current?.close(); return; }
    dialog.current.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [isOpen]);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="modal-content confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="confirm-header">
      <AlertTriangle size={28} aria-hidden="true" />
      <button type="button" onClick={onCancel} disabled={busy} aria-label="Cerrar diálogo"><X size={20} /></button>
    </div>
    <h2 id={titleId}>{title}</h2><p id={messageId}>{message}</p>
    <div className="confirm-actions">
      <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{cancelText}</button>
      <button type="button" className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} disabled={busy}>{busy ? 'Procesando...' : confirmText}</button>
    </div>
  </dialog>;
}
