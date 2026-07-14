import React, { useEffect } from 'react';

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 820 } : undefined} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, full }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const TONES = {
  actif: 'good', client: 'good', payee: 'good', terminee: 'good', ouverte: 'info',
  offre: 'info', prospect: 'info', attendue: 'warn', suspendu: 'warn',
  resilie: 'critical', annulee: 'critical', anonymise: 'critical', echu: 'serious',
  ancien: 'serious', haute: 'critical', normale: 'info', basse: '',
};

export function Badge({ value, label }) {
  return <span className={`badge ${TONES[value] ?? ''}`}>{label ?? value}</span>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function useAsync(fn, deps) {
  const [state, setState] = React.useState({ loading: true, data: null, error: null });
  const reload = React.useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => setState({ loading: false, data, error: null }),
      (error) => setState({ loading: false, data: null, error: error.message })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
