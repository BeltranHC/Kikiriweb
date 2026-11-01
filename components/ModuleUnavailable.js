import Link from 'next/link';
import { LockKeyhole, ArrowRight, Ticket } from 'lucide-react';
import styles from './ModuleUnavailable.module.css';

export default function ModuleUnavailable({ name='Entregas' }) {
  return <section className={styles.panel} aria-label={`${name}: temporalmente inhabilitado`}>
    <span className={styles.icon}><LockKeyhole size={32} /></span>
    <p className={styles.label}>MÓDULO DE {name.toUpperCase()}</p>
    <h1>Temporalmente inhabilitado</h1>
    <p className={styles.description}>Por el momento está disponible el reparto de tickets y su historial de asignaciones.</p>
    <Link className="btn btn-primary" href="/distribution"><Ticket size={17} />Ir a Reparto<ArrowRight size={16} /></Link>
  </section>;
}
