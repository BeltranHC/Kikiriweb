'use client';

import { useState, useCallback } from 'react';
import { debounce } from '@/lib/utils';
import { Search } from 'lucide-react';
import styles from './SearchBar.module.css';

export default function SearchBar({ onSearch, placeholder = 'Buscar por nombre, código, DNI o N° Ticket...' }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSearch = useCallback(
    debounce((value) => {
      onSearch(value);
    }, 300),
    [onSearch]
  );

  const handleChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    debouncedSearch(value);
  };

  const handleClear = () => {
    setQuery('');
    onSearch('');
  };

  return (
    <div className={`${styles.searchWrapper} ${focused ? styles.focused : ''}`}>
      <span className={styles.searchIcon}>
        <Search size={18} />
      </span>
      <input
        id="search-input"
        type="text"
        className={styles.searchInput}
        placeholder={placeholder}
        value={query}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
      />
      {query && (
        <button
          className={styles.clearBtn}
          onClick={handleClear}
          type="button"
          aria-label="Limpiar búsqueda"
        >
          ✕
        </button>
      )}
    </div>
  );
}
