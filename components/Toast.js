'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

const ToastContext = createContext(null);
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => {
    const activeTimers = timers.current;
    return () => { activeTimers.forEach(clearTimeout); activeTimers.clear(); };
  }, []);
  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(previous => [...previous, { id, message, type }]);
    const schedule = (callback, delay) => {
      const timer = setTimeout(() => { timers.current.delete(timer); callback(); }, delay);
      timers.current.add(timer);
    };
    schedule(() => {
      setToasts(previous => previous.map(toast => toast.id === id ? { ...toast, exiting: true } : toast));
      schedule(() => setToasts(previous => previous.filter(toast => toast.id !== id)), 300);
    }, duration);
  }, []);
  const success = useCallback(message => addToast(message, 'success'), [addToast]);
  const error = useCallback(message => addToast(message, 'error'), [addToast]);
  const warning = useCallback(message => addToast(message, 'warning'), [addToast]);
  const info = useCallback(message => addToast(message, 'info'), [addToast]);
  const value = useMemo(() => ({ addToast, success, error, warning, info }), [addToast, success, error, warning, info]);
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.type} ${toast.exiting ? 'toast-exit' : ''}`}>
        <span className="toast-icon" aria-hidden="true">
          {toast.type === 'success' && <CheckCircle size={18} />}
          {toast.type === 'error' && <XCircle size={18} />}
          {toast.type === 'warning' && <AlertTriangle size={18} />}
          {toast.type === 'info' && <Info size={18} />}
        </span><span>{toast.message}</span>
      </div>)}
    </div>
  </ToastContext.Provider>;
}
