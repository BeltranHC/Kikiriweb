'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { LayoutDashboard, GraduationCap, Ticket, Upload, LogOut, Bird, Sun, Moon, History } from 'lucide-react';
import { useState, useEffect } from 'react';
import styles from './Navbar.module.css';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [theme, setTheme] = useState('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check if user has a preference saved
    const savedTheme = localStorage.getItem('kikiriweb-theme');
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('kikiriweb-theme', newTheme);
  };

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { href: '/students', label: 'Estudiantes', icon: <GraduationCap size={20} /> },
    { href: '/movements', label: 'Movimientos', icon: <History size={20} /> },
    { href: '/extras', label: 'Extras', icon: <Ticket size={20} /> },
    { href: '/import', label: 'Importar', icon: <Upload size={20} /> },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles.navContent}>
        <div className={styles.brand} onClick={() => router.push('/dashboard')}>
          <span className={styles.brandIcon}><Bird size={24} /></span>
          <span className={styles.brandText}>KikiriWeb</span>
        </div>

        <div className={styles.navLinks}>
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${
                pathname === item.href ? styles.navLinkActive : ''
              }`}
              onClick={(e) => {
                e.preventDefault();
                router.push(item.href);
              }}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
            </a>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className={styles.logoutBtn}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            <span>{mounted && theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</span>
          </button>
          
          <button className={styles.logoutBtn} onClick={handleLogout} title="Cerrar sesión">
            <span><LogOut size={20} /></span>
            <span className={styles.logoutLabel}>Salir</span>
          </button>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <div className={styles.mobileNav}>
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`${styles.mobileLink} ${
              pathname === item.href ? styles.mobileLinkActive : ''
            }`}
            onClick={(e) => {
              e.preventDefault();
              router.push(item.href);
            }}
          >
            <span className={styles.mobileIcon}>{item.icon}</span>
            <span className={styles.mobileLabel}>{item.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
