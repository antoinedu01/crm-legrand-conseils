import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { BRANCHES, CONTRACT_STATUS, PAYMENT_FREQUENCIES, fmtCHF, fmtDate } from '../labels.js';

export function ContractForm({ initial, initialClientId, onSaved, onClose }) {
  const [clients, setClients] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState({
    client_id: initialClientId || '', company_id: '', branch: 'vie_3a', policy_number: '',
    product_name: '', annual_premium: '', payment_frequency: 'annuelle',
    start_date: '', end_date: '', status: 'offre',
    acq_commission_rate: '', rec_commission_rate: '', notes: '',
    ...initial,
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    api.get('/api/clients').then((rows) => setClients(rows.filter((c) => c.status !== 'anonymise')));
    api.get('/api/companies').then((rows) => setCompanies(rows.filter((c) => c.active)));
  }, []);

  // Pré-remplit les taux de commission avec ceux de la compagnie choisie
  function pickCompany(e) {
    const company_id = e.target.value;
    const co = companies.find((c) => String(c.id) === company_id);
    setForm((f) => ({
      ...f,
      company_id,
      acq_commission_rate: f.acq_commission_rate === '' && co ? co.default_acq_rate : f.acq_commission_rate,
      rec_commission_rate: f.rec_commission_rate === '' && co ? co.default_rec_rate : f.rec_commission_rate,
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      if (initial?.id) {
        await api.put(`/api/contracts/${initial.id}`, form);
        onSaved([]);
      } else {
        const res = await api.post('/api/contracts', form);
        onSaved(res.warnings || []);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  const premium = Number(form.annual_premium) || 0;
  const acq = (premium * (Number(form.acq_commission_rate) || 0)) / 100;
  const rec = (premium * (Number(form.rec_commission_rate) || 0)) / 100;

  return (
    <Modal title={initial?.id ? 'Modifier le contrat' : 'Nouveau contrat'} onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Client">
            <select required value={form.client_id} onChange={set('client_id')} disabled={!!initial?.id}>
              <option value="">— Choisir —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
          </Field>
          <Field label="Compagnie">
            <select required value={form.company_id} onChange={pickCompany}>
              <option value="">— Choisir —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Branche">
            <select value={form.branch} onChange={set('branch')}>
              {Object.entries(BRANCHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Statut">
            <select value={form.status} onChange={set('status')}>
              {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="N° de police">
            <input value={form.policy_number || ''} onChange={set('policy_number')} />
          </Field>
          <Field label="Produit">
            <input value={form.product_name || ''} onChange={set('product_name')} placeholder="p. ex. Prévoyance 3a épargne" />
          </Field>
          <Field label="Prime annuelle (CHF)">
            <input type="number" min="0" step="0.01" value={form.annual_premium ?? ''} onChange={set('annual_premium')} />
          </Field>
          <Field label="Fréquence de paiement">
            <select value={form.payment_frequency} onChange={set('payment_frequency')}>
              {Object.entries(PAYMENT_FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Début">
            <input type="date" value={form.start_date || ''} onChange={set('start_date')} />
          </Field>
          <Field label="Échéance">
            <input type="date" value={form.end_date || ''} onChange={set('end_date')} />
          </Field>
          <Field label="Commission d’acquisition (%)">
            <input type="number" min="0" step="0.01" value={form.acq_commission_rate ?? ''} onChange={set('acq_commission_rate')} />
          </Field>
          <Field label="Commission récurrente / portefeuille (%)">
            <input type="number" min="0" step="0.01" value={form.rec_commission_rate ?? ''} onChange={set('rec_commission_rate')} />
          </Field>
          <Field label="Notes" full>
            <textarea rows={2} value={form.notes || ''} onChange={set('notes')} />
          </Field>
        </div>
        {premium > 0 && (acq > 0 || rec > 0) && (
          <div className="alert ok mt">
            Commissions estimées : acquisition <strong>{fmtCHF(acq)}</strong>
            {rec > 0 && <> · portefeuille <strong>{fmtCHF(rec)}/an</strong></>}
            {!initial?.id && <> — la commission d’acquisition sera créée automatiquement.</>}
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Contracts() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const branch = params.get('branch') || '';
  const [editing, setEditing] = useState(null); // null | {} | contrat
  const [warnings, setWarnings] = useState([]);
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/contracts?q=${encodeURIComponent(q)}&status=${status}&branch=${branch}`),
    [q, status, branch]
  );

  const setParam = (k) => (e) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(k, e.target.value); else next.delete(k);
    setParams(next, { replace: true });
  };

  async function remove(ct) {
    if (!window.confirm(`Supprimer le contrat ${ct.policy_number || ct.id} ? Les commissions non payées liées seront aussi supprimées.`)) return;
    try {
      await api.del(`/api/contracts/${ct.id}`);
      reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contrats</h1>
          <div className="sub">{data ? `${data.length} contrat(s)` : ''}</div>
        </div>
        <button className="primary" onClick={() => setEditing({})}>+ Nouveau contrat</button>
      </div>
      {warnings.length > 0 && (
        <div className="alert warn">
          <strong>Contrat créé, mais des points de conformité sont ouverts :</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <div className="toolbar">
        <input placeholder="Rechercher (police, produit, client, compagnie)…" value={q} onChange={setParam('q')} style={{ minWidth: 280 }} />
        <select value={status} onChange={setParam('status')}>
          <option value="">Tous les statuts</option>
          {Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={branch} onChange={setParam('branch')}>
          <option value="">Toutes les branches</option>
          {Object.entries(BRANCHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucun contrat trouvé.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Client</th><th>Branche</th><th>Compagnie</th><th>Police</th><th>Statut</th>
                <th className="num">Prime/an</th><th className="num">Comm. perçues</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((ct) => (
                <tr key={ct.id}>
                  <td><Link to={`/clients/${ct.client_id}`}>{ct.client_name}</Link></td>
                  <td>{BRANCHES[ct.branch] || ct.branch}{ct.product_name && <div className="muted" style={{ fontSize: 12 }}>{ct.product_name}</div>}</td>
                  <td>{ct.company_name}</td>
                  <td>{ct.policy_number || '—'}</td>
                  <td><Badge value={ct.status} label={CONTRACT_STATUS[ct.status]} /></td>
                  <td className="num">{fmtCHF(ct.annual_premium)}</td>
                  <td className="num" title="payées / attendues">
                    {fmtCHF(ct.commissions_paid)}
                    {ct.commissions_pending > 0 && <span className="muted"> (+{fmtCHF(ct.commissions_pending)})</span>}
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="small" onClick={() => setEditing(ct)}>Modifier</button>{' '}
                    <button className="small danger" onClick={() => remove(ct)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing !== null && (
        <ContractForm
          initial={editing.id ? editing : undefined}
          onClose={() => setEditing(null)}
          onSaved={(w) => { setEditing(null); setWarnings(w || []); reload(); }}
        />
      )}
    </>
  );
}
