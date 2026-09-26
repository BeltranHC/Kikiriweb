'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { Bird, XCircle, Mail, Lock, Rocket } from 'lucide-react';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError('Credenciales incorrectas. Verifica tu email y contraseña.');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError('Error al conectar con el servidor. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      {/* Background decorative elements */}
      <div className={styles.bgOrb1} />
      <div className={styles.bgOrb2} />
      <div className={styles.bgOrb3} />

      <div className={styles.loginContainer}>
        <div className={styles.loginCard}>
          {/* Logo / Brand */}
          <div className={styles.logoSection}>
            <div className={styles.logoIcon}><Bird size={48} /></div>
            <h1 className={styles.logoTitle}>KikiriWeb</h1>
            <p className={styles.logoSubtitle}>Sistema de Gestión de Tickets</p>
          </div>

          {/* Login Form */}
          <form className={styles.loginForm} onSubmit={handleLogin}>
            {error && (
              <div className={styles.errorMessage}>
                <span><XCircle size={16} /></span>
                <span>{error}</span>
              </div>
            )}

            <div className={styles.inputGroup}>
              <label htmlFor="email" className={styles.label}>
                <Mail size={16} className="inline-icon" /> Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="password" className={styles.label}>
                <Lock size={16} className="inline-icon" /> Contraseña
              </label>
              <input
                id="password"
                type="password"
                className={styles.input}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className={styles.loginBtn}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner spinner-sm" />
                  <span>Ingresando...</span>
                </>
              ) : (
                <>
                  <span><Rocket size={20} /></span>
                  <span>Ingresar</span>
                </>
              )}
            </button>
          </form>

          <div className={styles.footer}>
            <p>Pollada Estudiantil</p>
          </div>
        </div>
      </div>
    </div>
  );
}
