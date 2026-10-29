'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Bird, XCircle, Mail, Lock, LogIn, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async e => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: authError } = await createClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError('Credenciales incorrectas. Revisa tu correo y contraseña.');
        return;
      }

      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('Error al conectar con el servidor. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      {/* Fondos decorativos en tonos suaves azul y blanco */}
      <div className={styles.ambientGlowTop} />
      <div className={styles.ambientGlowBottom} />
      <div className={styles.ambientGrid} />

      <main className={styles.loginContainer}>
        <div className={styles.loginCard}>
          {/* Cabecera de la marca */}
          <div className={styles.logoSection}>
            <div className={styles.logoIcon} aria-hidden="true">
              <Bird size={32} strokeWidth={2.2} />
            </div>
            <h1 className={styles.logoTitle}>
              Kikiri<span className={styles.logoAccent}>Web</span>
            </h1>
            <p className={styles.logoSubtitle}>Sistema de Gestión de Tickets</p>
          </div>

          {/* Formulario de inicio de sesión */}
          <form className={styles.loginForm} onSubmit={handleLogin} noValidate={false}>
            {error && (
              <div className={styles.errorMessage} role="alert">
                <XCircle size={18} className={styles.errorIcon} />
                <span>{error}</span>
              </div>
            )}

            <div className={styles.inputGroup}>
              <label htmlFor="email" className={styles.label}>
                <Mail size={15} className={styles.labelIcon} /> Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="ejemplo@correo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="password" className={styles.label}>
                <Lock size={15} className={styles.labelIcon} /> Contraseña
              </label>
              <div className={styles.passwordWrapper}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className={styles.input}
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={styles.loginBtn}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  <span>Iniciando sesión...</span>
                </>
              ) : (
                <>
                  <span>Iniciar sesión</span>
                  <LogIn size={18} />
                </>
              )}
            </button>
          </form>

          {/* Pie informativo */}
          <div className={styles.footer}>
            <div className={styles.trustBadge}>
              <ShieldCheck size={14} />
              <span>Acceso Seguro · Pollada Estudiantil</span>
            </div>
            <p className={styles.copyright}>© KikiriWeb · Panel de Control</p>
          </div>
        </div>
      </main>
    </div>
  );
}
