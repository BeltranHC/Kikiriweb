'use client';

import { percentage } from '@/lib/utils';
import { Ticket, CheckCircle, Clock, GraduationCap, Banknote, Smartphone } from 'lucide-react';
import styles from './StatsPanel.module.css';
const number = new Intl.NumberFormat('es-PE');
const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);

export default function StatsPanel({ stats }) {
  const { totalTickets = 0, pickedUp = 0, pending = 0, totalStudents = 0, extraTickets = 0, collectedNow = 0, collectedCash = 0, collectedYape = 0 } = stats || {};
  const pct = percentage(pickedUp, totalTickets);
  const cards = [
    { label: 'Tickets totales', value: number.format(totalTickets), icon: Ticket, color: 'primary' },
    { label: 'Entregados', value: number.format(pickedUp), icon: CheckCircle, color: 'success' },
    { label: 'Pendientes', value: number.format(pending), icon: Clock, color: 'warning' },
    { label: 'Estudiantes', value: number.format(totalStudents), icon: GraduationCap, color: 'info' },
    { label: 'Cobrado hoy', value: money(collectedNow), icon: Banknote, color: 'cash' },
  ];
  return <section className={styles.panel} aria-label="Resumen de entregas">
    <div className={styles.statsGrid}>{cards.map(({ label, value, icon: Icon, color }) => <article className={`${styles.statCard} ${styles[color]}`} key={label}>
      <div className={styles.cardHeading}><span className={styles.statLabel}>{label}</span><span className={styles.statIcon}><Icon size={17} /></span></div>
      <strong className={styles.statValue}>{value}</strong>
      {color === 'cash' && (
        <div className={styles.cashDetail}>
          <span className={styles.cashPill}>
            <Banknote size={13} />
            <span>Efectivo:</span>
            <b>{money(collectedCash)}</b>
          </span>
          <span className={styles.yapePill}>
            <Smartphone size={13} />
            <span>Yape:</span>
            <b>{money(collectedYape)}</b>
          </span>
        </div>
      )}
    </article>)}</div>
    <div className={styles.progressSection}>
      <div className={styles.progressHeader}><span className={styles.progressTitle}>Avance de entregas <span>{number.format(pickedUp)} de {number.format(totalTickets)} tickets</span></span><strong className={styles.progressPct}>{pct}%</strong></div>
      <div className={styles.progressBar} role="progressbar" aria-label="Avance de entregas" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={styles.progressFill} style={{ width: `${pct}%` }} /></div>
      {extraTickets > 0 && <span className={styles.extraNote}><Ticket size={13} /> {extraTickets} tickets extra disponibles</span>}
    </div>
  </section>;
}
