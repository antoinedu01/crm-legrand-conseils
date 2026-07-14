import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Badge, Empty } from '../components/ui.jsx';
import { BRANCHES, COMMISSION_STATUS, COMMISSION_TYPES, fmtCHF, fmtDate } from '../labels.js';

export default function Commissions() {
  const currentYear = new Date().getFullYear();
  const [status, setStatus] = useState('');
  const [year, setYear] = useState(String(currentYear));
  const [message, setMessage] = useState(null);
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/commissions?status=${status}&year=${year}`),
    [status, year]
  );

  const totals = (data || []).reduce(
    (acc, c) => {
      if (c.status === 'payee') acc.paid += c.amount;
      if (c.status === 'attendue') acc.pending += c.amount;
      return acc;
    },
    { paid: 0, pending: 0 }
  );

  async function markPaid(c) {
    await api.put(`/api/commissions/${c.id}`, { status: 'payee' });
    reload();
  }
  async function cancel(c) {
    if (!window.confirm('Annuler cette commission ?')) return;
    await api.put(`/api/commissions/${c.id}`, { status: 'annulee' });
    reload();
  }
  async function generateRecurring() {
    const res = await api.post('/api/commissions/generate-recurring', { year: Number(year) || currentYear });
    setMessage(
      res.created > 0
        ? `${res.created} commission(s) de portefeuille générée(s) pour ${res.year}.`
        : `Aucune commission à générer pour ${res.year} — tout est déjà à jour.`
    );
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Commissions</h1>
          <div className="sub">
            Payées : <strong>{fmtCHF(totals.paid)}</strong> · Attendues : <strong>{fmtCHF(totals.pending)}</strong>
            {year && <> · année {year}</>}
          </div>
        </div>
        <button onClick={generateRecurring}>⟳ Générer les commissions récurrentes</button>
      </div>
      {message && <div className="alert ok">{message}</div>}
      <div className="toolbar">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes les années</option>
          {[0, 1, 2, 3].map((i) => (
            <option key={i} value={currentYear - i}>{currentYear - i}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(COMMISSION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucune commission pour ces critères. Les commissions d’acquisition sont créées automatiquement avec chaque nouveau contrat.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Client</th><th>Compagnie</th><th>Contrat</th><th>Type</th>
                <th>Échéance</th><th className="num">Montant</th><th>Statut</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.client_id}`}>{c.client_name}</Link></td>
                  <td>{c.company_name}</td>
                  <td>{BRANCHES[c.branch] || c.branch}{c.policy_number && <div className="muted" style={{ fontSize: 12 }}>{c.policy_number}</div>}</td>
                  <td>{COMMISSION_TYPES[c.type] || c.type}{c.label && <div className="muted" style={{ fontSize: 12 }}>{c.label}</div>}</td>
                  <td>{fmtDate(c.due_date)}{c.paid_date && <div className="muted" style={{ fontSize: 12 }}>payée le {fmtDate(c.paid_date)}</div>}</td>
                  <td className="num"><strong>{fmtCHF(c.amount)}</strong></td>
                  <td><Badge value={c.status} label={COMMISSION_STATUS[c.status]} /></td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {c.status === 'attendue' && (
                      <>
                        <button className="small primary" onClick={() => markPaid(c)}>Payée ✓</button>{' '}
                        <button className="small" onClick={() => cancel(c)}>Annuler</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted mt" style={{ fontSize: 12 }}>
        Transparence de la rémunération : selon l’art. 45b LSA, le client doit être informé de la
        rémunération perçue de tiers. Les montants ci-dessus sont exportables par client depuis son dossier.
      </p>
    </>
  );
}
