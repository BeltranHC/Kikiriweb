import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '@/lib/client';
import { SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';

export function useFacultyDirectory(query, page, semester, enabled, type = 'all', ticketStatus = 'all') {
  const [data, setData] = useState({ students: [], total: 0, hasMore: false, semesters: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef(null);
  const previousQuery = useRef(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: query, page: String(page), semester, type, ticketStatus });
      const result = await requestJson(`/api/faculty?${params}`, { signal: current.signal });
      if (!current.signal.aborted && controller.current === current) setData(result);
    } catch (issue) {
      if (!current.signal.aborted && issue.status !== 401) setError(issue.message);
    } finally {
      if (controller.current === current) { controller.current = null; setLoading(false); }
    }
  }, [query, page, semester, enabled, type, ticketStatus]);
  useEffect(() => {
    if (!enabled) return;
    // Debounce typing only; opening the page and changing filters start immediately.
    const wait = previousQuery.current !== null && previousQuery.current !== query ? 250 : 0;
    previousQuery.current = query;
    setLoading(true); setError('');
    const timer = setTimeout(refresh, wait);
    const resume = () => refresh();
    window.addEventListener(SESSION_RESTORED_EVENT, resume);
    return () => { clearTimeout(timer); controller.current?.abort(); controller.current = null; window.removeEventListener(SESSION_RESTORED_EVENT, resume); };
  }, [refresh, enabled, query]);
  return { ...data, loading, error, refresh };
}
