'use client';

import { percentage } from '@/lib/utils';
import { Ticket, CheckCircle, Clock, GraduationCap, Banknote } from 'lucide-react';
import styles from './StatsPanel.module.css';

export default function StatsPanel({ stats }) {
  const {
    totalTickets = 0,
    pickedUp = 0,
    pending = 0,
    totalStudents = 0,
    extraTickets = 0,
    collectedNow = 0,
    collectedCash = 0,
    collectedYape = 0,
  } = stats || {};

  const pct = percentage(pickedUp, totalTickets);

  const cards = [
    {
      label: 'Total Tickets',
      value: totalTickets,
      icon: <Ticket size={24} />,
      color: 'primary',
    },
    {
      label: 'Recogidos',
      value: pickedUp,
      icon: <CheckCircle size={24} />,
      color: 'success',
    },
    {
      label: 'Pendientes',
      value: pending,
      icon: <Clock size={24} />,
      color: 'warning',
    },
    {
      label: 'Estudiantes',
      value: totalStudents,
      icon: <GraduationCap size={24} />,
      color: 'info',
    },
    {
      label: 'Cobrado Hoy',
      value: `S/ ${collectedNow}`,
      subLabel: `Efe: S/ ${collectedCash} | Yape: S/ ${collectedYape}`,
      icon: <Banknote size={24} />,
      color: 'success',
    },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.statsGrid}>
        {cards.map((card) => (
          <div key={card.label} className={`${styles.statCard} ${styles[card.color]}`}>
            <div className={styles.statIcon}>{card.icon}</div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{card.value}</span>
              <span className={styles.statLabel}>{card.label}</span>
              {card.subLabel && <span style={{ fontSize: '0.8rem', opacity: 0.8, display: 'block', marginTop: '4px' }}>{card.subLabel}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Overall progress */}
      <div className={styles.progressSection}>
        <div className={styles.progressHeader}>
          <span className={styles.progressTitle}>Avance General</span>
          <span className={styles.progressPct}>{pct}%</span>
        </div>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${pct}%` }}
          />
        </div>
        {extraTickets > 0 && (
          <span className={styles.extraNote}>
            <Ticket size={16} className="inline-icon" /> {extraTickets} tickets extra disponibles
          </span>
        )}
      </div>
    </div>
  );
}
