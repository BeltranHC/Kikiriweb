'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, X, ScanBarcode } from 'lucide-react';
import styles from './SearchBar.module.css';

export default function SearchBar({
  value = '',
  onSearch,
  onScan,
  placeholder = 'Buscar por nombre, código, DNI o N° Ticket...',
  inputRef: externalRef,
  autoFocus = false,
}) {
  const [focused, setFocused] = useState(false);
  const localRef = useRef(null);
  const inputRef = externalRef || localRef;

  const keyTimesRef = useRef([]);
  const burstTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    };
  }, []);

  const triggerScan = ticketNum => {
    // Limpiar inmediatamente para que no se acumulen los números en la siguiente lectura
    onSearch('');
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.focus();
    }
    keyTimesRef.current = [];
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    onScan(ticketNum);
  };

  const handleKeyDown = event => {
    if (event.key === 'Enter') {
      const trimmed = (inputRef.current?.value || value || '').trim();
      const match = trimmed.match(/^#?(\d+)$/);
      if (match && onScan) {
        event.preventDefault();
        const ticketNum = parseInt(match[1], 10);
        triggerScan(ticketNum);
        return;
      }
      if (!match) {
        event.preventDefault();
        onSearch(trimmed);
      }
    }
  };

  const handleKeyUp = event => {
    if (!onScan || event.key === 'Enter') return;

    const now = Date.now();
    keyTimesRef.current.push(now);
    if (keyTimesRef.current.length > 8) {
      keyTimesRef.current.shift();
    }

    // Detección de ráfaga de escáner de barras (intervalo ultra rápido < 45ms entre teclas)
    if (keyTimesRef.current.length >= 2) {
      const times = keyTimesRef.current;
      const avg = (times[times.length - 1] - times[0]) / (times.length - 1);

      if (avg < 45) {
        if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
        burstTimerRef.current = setTimeout(() => {
          const currentVal = (inputRef.current?.value || value || '').trim();
          const match = currentVal.match(/^#?(\d+)$/);
          if (match) {
            const ticketNum = parseInt(match[1], 10);
            triggerScan(ticketNum);
          }
        }, 55);
      }
    }
  };

  const handleClear = () => {
    onSearch('');
    if (inputRef.current) inputRef.current.value = '';
    keyTimesRef.current = [];
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    inputRef.current?.focus();
  };

  return (
    <div className={`${styles.searchWrapper} ${focused ? styles.focused : ''} ${onScan ? styles.scannerActive : ''}`}>
      {onScan ? (
        <ScanBarcode size={20} className={styles.scannerIcon} aria-hidden="true" title="Lector de barras habilitado" />
      ) : (
        <Search size={18} aria-hidden="true" />
      )}
      <input
        ref={inputRef}
        type="search"
        maxLength={200}
        aria-label="Buscar estudiantes o escanear ticket"
        className={styles.searchInput}
        placeholder={placeholder}
        value={value}
        onChange={event => onSearch(event.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      {onScan && (
        <span className={styles.scannerBadge} title="Escanea un ticket directamente con tu lector">
          <ScanBarcode size={13} /> Lector listo
        </span>
      )}
      {value && (
        <button className={styles.clearBtn} onClick={handleClear} type="button" aria-label="Limpiar búsqueda">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
