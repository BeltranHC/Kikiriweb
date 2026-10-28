import { useEffect, useRef, useState } from 'react';

function interactionInProgress() {
  return document.hidden || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ||
    !!document.querySelector('dialog[open], [data-ticket-selection="true"], [data-mutation-pending="true"]');
}
export function useAutoRefresh(callback, { enabled = true, interval = 30000 } = {}) {
  const latest = useRef(callback);
  const [paused, setPaused] = useState(false);
  useEffect(() => { latest.current = callback; }, [callback]);
  useEffect(() => {
    if (!enabled) return;
    let pendingCheck;
    const updatePause = () => {
      clearTimeout(pendingCheck);
      pendingCheck = setTimeout(() => setPaused(interactionInProgress()), 0);
    };
    const refresh = () => {
      const blocked = interactionInProgress();
      setPaused(blocked);
      if (!blocked) latest.current();
    };
    const timer = setInterval(refresh, interval);
    document.addEventListener('focusin', updatePause);
    document.addEventListener('focusout', updatePause);
    document.addEventListener('click', updatePause);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer); clearTimeout(pendingCheck);
      document.removeEventListener('focusin', updatePause);
      document.removeEventListener('focusout', updatePause);
      document.removeEventListener('click', updatePause);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, interval]);
  return paused;
}
