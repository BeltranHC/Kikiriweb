'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { clearSearchStates } from '@/lib/view-state.mjs';
import { useToast } from './Toast';
import { LayoutDashboard, GraduationCap, Ticket, Upload, LogOut, Bird, History } from 'lucide-react';
import styles from './Navbar.module.css';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const toast = useToast();
  const navItems = [
    { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
    { href: '/students', label: 'Estudiantes', icon: GraduationCap },
    { href: '/movements', label: 'Movimientos', icon: History },
    { href: '/extras', label: 'Extras', icon: Ticket },
    { href: '/import', label: 'Importar', icon: Upload },
  ];
  const logout = async () => {
    setLeaving(true);
    try {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      try { clearSearchStates(window.sessionStorage); } catch { /* Storage may be blocked. */ }
      router.replace('/'); router.refresh();
    } catch { toast.error('No se pudo cerrar la sesión. Inténtalo de nuevo.'); setLeaving(false); }
  };
  return <nav className={styles.navbar} aria-label="Navegación principal">
    <div className={styles.navContent}>
      <Link href="/dashboard" className={styles.brand} aria-label="KikiriWeb, panel de entregas">
        <span className={styles.brandIcon}><Bird size={23} /></span>
        <span className={styles.brandText}>KikiriWeb<span className={styles.brandSubtitle}>Control de entregas</span></span>
      </Link>
      <div className={styles.navLinks}>{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}
        className={`${styles.navLink} ${pathname === href ? styles.navLinkActive : ''}`}><Icon size={17} /><span>{label}</span></Link>)}</div>
      <button type="button" className={styles.logoutBtn} onClick={logout} disabled={leaving} aria-label="Cerrar sesión"><LogOut size={17} /><span className={styles.logoutLabel}>{leaving ? 'Saliendo...' : 'Salir'}</span></button>
    </div>
    <div className={styles.mobileNav}>{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}
      className={`${styles.mobileLink} ${pathname === href ? styles.mobileLinkActive : ''}`}><Icon size={21} /><span className={styles.mobileLabel}>{label}</span></Link>)}</div>
  </nav>;
}
