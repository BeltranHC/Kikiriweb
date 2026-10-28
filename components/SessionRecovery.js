'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, LogIn } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';

export default function SessionRecovery() {
  const [expired, setExpired] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const router = useRouter();
  useEffect(() => {
    const handleExpired = () => { setExpired(true); setError(''); };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, []);
  useEffect(() => {
    if (expired && !dialog.current.open) dialog.current.showModal();
    if (!expired && dialog.current.open) dialog.current.close();
  }, [expired]);
  const signIn = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: authError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.user || data.user.is_anonymous) throw new Error('No pudimos iniciar sesión. Revisa tu correo y contraseña.');
      setPassword(''); setExpired(false);
      window.dispatchEvent(new CustomEvent(SESSION_RESTORED_EVENT));
    } catch (issue) { setError(issue.message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="modal-content session-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => event.preventDefault()}>
    <span className="session-icon"><LockKeyhole size={24} /></span>
    <h2 id={titleId}>Continúa donde estabas</h2>
    <p id={descriptionId}>Tu sesión terminó. Inicia sesión de nuevo para continuar; conservamos tu búsqueda y tu selección en esta pantalla.</p>
    <form onSubmit={signIn} className="session-form">
      <div className="input-group"><label htmlFor="resume-email">Correo electrónico</label><input id="resume-email" className="input-field" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></div>
      <div className="input-group"><label htmlFor="resume-password">Contraseña</label><input id="resume-password" className="input-field" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></div>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button className="btn btn-primary" disabled={busy}><LogIn size={16} /> {busy ? 'Verificando...' : 'Continuar en esta pantalla'}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPassword(''); setExpired(false); router.replace('/'); }}>Ir al inicio de sesión</button>
    </form>
  </dialog>;
}
