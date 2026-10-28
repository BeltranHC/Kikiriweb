'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Bird, Mail, LockKeyhole, LogIn, CheckCircle2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const login = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw new Error('Revisa tu correo y contraseña e inténtalo de nuevo.');
      router.replace('/dashboard'); router.refresh();
    } catch (issue) { setError(issue.message); }
    finally { setLoading(false); }
  };
  return <main className={styles.loginPage}>
    <div className={styles.loginContainer}>
      <section className={styles.intro} aria-label="KikiriWeb">
        <div className={styles.brand}><span><Bird size={25} /></span><strong>KikiriWeb</strong></div>
        <p className={styles.eyebrow}>GESTIÓN DE POLLADA ESTUDIANTIL</p>
        <h1>Cada entrega,<br /><span>bajo control.</span></h1>
        <p className={styles.lead}>Encuentra estudiantes, registra sus tickets y lleva la caja al día, desde un solo lugar.</p>
        <ul className={styles.features}><li><CheckCircle2 size={17} /> Entregas claras y ordenadas</li><li><CheckCircle2 size={17} /> Efectivo y Yape en una misma vista</li><li><CheckCircle2 size={17} /> Historial de cada movimiento</li></ul>
        <p className={styles.introFooter}>Más organización. Mejor atención.</p>
      </section>
      <section className={styles.loginCard} aria-labelledby="login-title">
        <span className={styles.cardIcon}><LockKeyhole size={23} /></span>
        <h2 id="login-title">Bienvenido de nuevo</h2><p className={styles.cardSubtitle}>Ingresa a tu cuenta para continuar.</p>
        <form className={styles.loginForm} onSubmit={login}>
          {error && <div className={styles.errorMessage} role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
          <div className={styles.inputGroup}><label htmlFor="email">Correo electrónico</label><div className={styles.inputWrap}><Mail size={17} /><input id="email" type="email" placeholder="tu@correo.com" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="username" /></div></div>
          <div className={styles.inputGroup}><label htmlFor="password">Contraseña</label><div className={styles.inputWrap}><LockKeyhole size={17} /><input id="password" type={showPassword ? 'text' : 'password'} placeholder="Tu contraseña" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" /><button type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
          <button className="btn btn-primary" disabled={loading} type="submit">{loading ? <span className="spinner spinner-sm" /> : <LogIn size={17} />}{loading ? 'Ingresando...' : 'Iniciar sesión'}</button>
        </form>
        <p className={styles.cardFooter}>Acceso para el equipo de entrega</p>
      </section>
    </div>
  </main>;
}
