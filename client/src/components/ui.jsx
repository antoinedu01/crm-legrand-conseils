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
  non_qualifie: '', froid: 'info', tiede: 'warn', chaud: 'serious', prioritaire: 'critical',
  archive: 'serious',
  principal: 'good', conjoint: 'info', enfant: 'info', autre_charge: '',
  exact_match: 'critical', probable_match: 'serious', possible_similarity: 'warn', no_match: '',
  draft: 'info', in_progress: 'warn', suspended: 'serious', completed: 'good', cancelled: 'critical',
  answered: 'good', unknown: 'warn', not_applicable: '', cleared: 'serious',
  // Espace conseiller des findings (Lot 4B).
  critical: 'critical', high: 'warn', medium: 'info', low: '',
  active: 'good', dismissed: 'serious', superseded: '',
  running: 'warn', failed: 'critical',
  no_rule_set_available: '', not_yet_run: 'info', up_to_date: 'good', stale: 'warn',
  // Navigation historique par answer_id (Lot 4B, GATE §2).
  source_answer: 'info',
  // État global agrégé multi-domaines (Lot 4B, GATE §3) -- `up_to_date` et
  // `stale` réutilisent déjà les tons ci-dessus (mêmes valeurs, même sens).
  not_analyzed: '', partial: 'warn', unavailable: '', error: 'critical',
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
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
