'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import styles from './SearchBar.module.css';

export default function SearchBar({ value = '', onSearch, placeholder = 'Buscar por nombre, código, DNI o N° Ticket...' }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={`${styles.searchWrapper} ${focused ? styles.focused : ''}`}>
      <Search size={18} aria-hidden="true" />
      <input type="search" maxLength={200} aria-label="Buscar estudiantes" className={styles.searchInput}
        placeholder={placeholder} value={value} onChange={event => onSearch(event.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoComplete="off" />
      {value && <button className={styles.clearBtn} onClick={() => onSearch('')} type="button" aria-label="Limpiar búsqueda"><X size={16} /></button>}
    </div>
  );
}
