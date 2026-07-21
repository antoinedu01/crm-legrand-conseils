import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { BRANCHES, CONTRACT_STATUS, PAYMENT_FREQUENCIES, fmtCHF } from '../labels.js';
import { buildGenericContractPayload, hasAnySpecializedBlock } from '../components/contracts/contractPayload.js';
import { buildLamalBlock, composeLamalPayload } from '../components/contracts/lamalPayload.js';
import { LamalFields } from '../components/contracts/LamalFields.jsx';

const DEFAULT_LAMAL_FIELDS = { care_model: 'standard', deductible: '', accident_coverage: true, canton: '', tariff_region: '' };

function lamalFieldsFromBlock(block) {
  return {
    care_model: block.care_model,
    deductible: block.deductible,
    accident_coverage: block.accident_coverage,
    canton: block.canton ?? '',
    tariff_region: block.tariff_region ?? '',
  };
}

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
  const [submitting, setSubmitting] = useState(false);
  const branchLocked = !!initial?.id && hasAnySpecializedBlock(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const hasExistingLamal = initial?.lamal != null;
  const [lamalMode, setLamalMode] = useState(hasExistingLamal ? 'unchanged' : 'absent');
  const [lamalFields, setLamalFields] = useState(
    hasExistingLamal ? lamalFieldsFromBlock(initial.lamal) : DEFAULT_LAMAL_FIELDS
  );
  const [lamalModeBeforeRemoval, setLamalModeBeforeRemoval] = useState(null);

  function handleBranchChange(e) {
    const nextBranch = e.target.value;
    setForm((f) => ({ ...f, branch: nextBranch }));
    // Activation automatique uniquement à la création, lors de la première
    // sélection de la branche lamal (règle I2 §6). En édition d'un contrat
    // lamal sans bloc, l'activation passe par le bouton « Ajouter les
    // détails LAMal » ci-dessous, jamais automatiquement.
    if (nextBranch === 'lamal' && !initial?.id && lamalMode === 'absent') {
      setLamalFields(DEFAULT_LAMAL_FIELDS);
      setLamalMode('value');
    }
  }

  function handleLamalFieldsChange(nextFields) {
    setLamalFields(nextFields);
    if (lamalMode === 'unchanged') setLamalMode('value');
  }

  function addLamalDetails() {
    setLamalFields(DEFAULT_LAMAL_FIELDS);
    setLamalMode('value');
  }

  function requestLamalRemoval() {
    if (!window.confirm('Supprimer les détails LAMal de ce contrat ? La suppression sera appliquée à l’enregistrement.')) return;
    setLamalModeBeforeRemoval(lamalMode);
    setLamalMode('removed');
  }

  function cancelLamalRemoval() {
    setLamalMode(lamalModeBeforeRemoval || 'unchanged');
    setLamalModeBeforeRemoval(null);
  }

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
    if (submitting) return;
    setError(null);

    // Construction et validation du bloc LAMal avant tout appel API : une
    // erreur de saisie ne doit jamais partir en requête incomplète, et ne
    // doit pas non plus faire passer le bouton en état "Enregistrement…".
    let lamalBlock;
    if (form.branch === 'lamal' && lamalMode === 'value') {
      try {
        lamalBlock = buildLamalBlock(lamalFields);
      } catch (err) {
        setError(err.message);
        return;
      }
    }

    setSubmitting(true);
    try {
      const generic = buildGenericContractPayload(form);
      const payload = composeLamalPayload(generic, { mode: lamalMode, branch: form.branch, block: lamalBlock });
      if (initial?.id) {
        await api.put(`/api/contracts/${initial.id}`, payload);
        onSaved([]);
      } else {
        const res = await api.post('/api/contracts', payload);
        onSaved(res.warnings || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const premium = Number(form.annual_premium) || 0;
  const acq = (premium * (Number(form.acq_commission_rate) || 0)) / 100;
  const rec = (premium * (Number(form.rec_commission_rate) || 0)) / 100;

  return (
    <Modal title={initial?.id ? 'Modifier le contrat' : 'Nouveau contrat'} onClose={submitting ? () => {} : onClose} wide>
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
            <select value={form.branch} onChange={handleBranchChange} disabled={branchLocked}>
              {Object.entries(BRANCHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {branchLocked && (
              <small className="muted">La branche ne peut pas être modifiée tant que les détails spécialisés existent.</small>
            )}
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
        {form.branch === 'lamal' && (
          <div className="card mt">
            <h3>Détails LAMal</h3>
            {lamalMode === 'absent' && (
              <button type="button" className="small" onClick={addLamalDetails} disabled={submitting}>
                Ajouter les détails LAMal
              </button>
            )}
            {(lamalMode === 'unchanged' || lamalMode === 'value') && (
              <>
                <LamalFields values={lamalFields} onChange={handleLamalFieldsChange} disabled={submitting} />
                {hasExistingLamal && (
                  <button type="button" className="small danger mt" onClick={requestLamalRemoval} disabled={submitting}>
                    Supprimer les détails LAMal
                  </button>
                )}
              </>
            )}
            {lamalMode === 'removed' && (
              <div className="alert warn">
                Les détails LAMal seront supprimés à l’enregistrement.
                <div className="mt">
                  <button type="button" className="small" onClick={cancelLamalRemoval} disabled={submitting}>
                    Annuler la suppression
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {premium > 0 && (acq > 0 || rec > 0) && (
          <div className="alert ok mt">
            Commissions estimées : acquisition <strong>{fmtCHF(acq)}</strong>
            {rec > 0 && <> · portefeuille <strong>{fmtCHF(rec)}/an</strong></>}
            {!initial?.id && <> — la commission d’acquisition sera créée automatiquement.</>}
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={onClose} disabled={submitting}>Annuler</button>
          <button className="primary" disabled={submitting}>{submitting ? 'Enregistrement…' : 'Enregistrer'}</button>
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
