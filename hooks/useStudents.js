import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { requestJson } from '@/lib/client';
import { SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';

export function useStudents(query, page, { enabled = true } = {}) {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null);
  const toast = useToast();
  const refresh = useCallback(async (options = {}) => {
    const { silent = false, background = false } = typeof options === 'boolean' ? { silent: options } : options;
    if (!enabled || (background && controller.current)) return false;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: '30' });
      const data = await requestJson(`/api/students?${params}`, { signal: current.signal });
      if (current.signal.aborted || controller.current !== current) return false;
      setStudents(data.students);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setLastUpdated(Date.now());
      setError('');
      return true;
    } catch (issue) {
      if (!current.signal.aborted && issue.status !== 401) {
        setError(issue.message);
        if (!background) toast.error(issue.message);
      }
      return false;
    } finally {
      if (controller.current === current) {
        controller.current = null;
        if (!current.signal.aborted) { setLoading(false); setRefreshing(false); }
      }
    }
  }, [query, page, enabled, toast]);
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    const timer = setTimeout(() => refresh(), 300);
    const resume = () => refresh({ silent: true });
    window.addEventListener(SESSION_RESTORED_EVENT, resume);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
      controller.current = null;
      window.removeEventListener(SESSION_RESTORED_EVENT, resume);
    };
  }, [enabled, refresh]);
  return { students, total, hasMore, loading, refreshing, lastUpdated, error, refresh };
}
