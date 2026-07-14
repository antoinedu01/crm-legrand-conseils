import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { CLIENT_STATUS, CANTONS } from '../labels.js';

export function ClientForm({ initial, onSaved, onClose }) {
  const [form, setForm] = useState({
    type: 'particulier', first_name: '', last_name: '', company_name: '', email: '', phone: '',
    birth_date: '', address: '', npa: '', city: '', canton: '', profession: '',
    marital_status: '', status: 'prospect', notes: '',
    consent_data: false, consent_date: '', mandate_signed: false, mandate_date: '', info_lsa_date: '',
    ...initial,
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const payload = { ...form, consent_data: form.consent_data ? 1 : 0, mandate_signed: form.mandate_signed ? 1 : 0 };
      if (payload.consent_data && !payload.consent_date) payload.consent_date = new Date().toISOString().slice(0, 10);
      if (payload.mandate_signed && !payload.mandate_date) payload.mandate_date = new Date().toISOString().slice(0, 10);
      let id = initial?.id;
      if (id) await api.put(`/api/clients/${id}`, payload);
      else id = (await api.post('/api/clients', payload)).id;
      onSaved(id);
    } catch (err) {
      setError(err.message);
    }
  }

  const isCompany = form.type === 'entreprise';
  return (
    <Modal title={initial?.id ? 'Modifier le client' : 'Nouveau client'} onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Type">
            <select value={form.type} onChange={set('type')}>
              <option value="particulier">Particulier</option>
              <option value="entreprise">Entreprise</option>
            </select>
          </Field>
          <Field label="Statut">
            <select value={form.status} onChange={set('status')}>
              {Object.entries(CLIENT_STATUS).filter(([k]) => k !== 'anonymise').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          {isCompany ? (
            <Field label="Raison sociale" full>
              <input value={form.company_name || ''} onChange={set('company_name')} required />
            </Field>
          ) : (
            <>
              <Field label="Prénom">
                <input value={form.first_name || ''} onChange={set('first_name')} />
              </Field>
              <Field label="Nom">
                <input value={form.last_name || ''} onChange={set('last_name')} required />
              </Field>
            </>
          )}
          <Field label="E-mail">
            <input type="email" value={form.email || ''} onChange={set('email')} />
          </Field>
          <Field label="Téléphone">
            <input value={form.phone || ''} onChange={set('phone')} placeholder="+41 …" />
          </Field>
          {!isCompany && (
            <>
              <Field label="Date de naissance">
                <input type="date" value={form.birth_date || ''} onChange={set('birth_date')} />
              </Field>
              <Field label="État civil">
                <select value={form.marital_status || ''} onChange={set('marital_status')}>
                  <option value="">—</option>
                  {['célibataire', 'marié(e)', 'partenariat enregistré', 'divorcé(e)', 'veuf(ve)'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Profession">
                <input value={form.profession || ''} onChange={set('profession')} />
              </Field>
              <Field label="Nationalité">
                <input value={form.nationality || ''} onChange={set('nationality')} />
              </Field>
            </>
          )}
          <Field label="Adresse" full>
            <input value={form.address || ''} onChange={set('address')} />
          </Field>
          <Field label="NPA">
            <input value={form.npa || ''} onChange={set('npa')} />
          </Field>
          <Field label="Localité">
            <input value={form.city || ''} onChange={set('city')} />
          </Field>
          <Field label="Canton">
            <select value={form.canton || ''} onChange={set('canton')}>
              <option value="">—</option>
              {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <div />
          <Field label="Notes" full>
            <textarea rows={2} value={form.notes || ''} onChange={set('notes')} />
          </Field>
          <div className="full card" style={{ background: 'var(--wash)', border: 'none' }}>
            <h3>Conformité (nLPD / LSA)</h3>
            <div className="flex" style={{ gap: 18 }}>
              <label className="check">
                <input type="checkbox" checked={!!form.consent_data} onChange={set('consent_data')} />
                Consentement au traitement des données (nLPD)
              </label>
              <label className="check">
                <input type="checkbox" checked={!!form.mandate_signed} onChange={set('mandate_signed')} />
                Mandat de courtage signé
              </label>
            </div>
            <div className="form-grid mt">
              <Field label="Information remise selon l’art. 45 LSA, le">
                <input type="date" value={form.info_lsa_date || ''} onChange={set('info_lsa_date')} />
              </Field>
              <Field label="N° AVS (uniquement si nécessaire — donnée sensible)">
                <input value={form.avs_number || ''} onChange={set('avs_number')} placeholder="756.…" />
              </Field>
            </div>
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Clients() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/clients?q=${encodeURIComponent(q)}&status=${status}`),
    [q, status]
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <div className="sub">{data ? `${data.length} dossier(s)` : ''}</div>
        </div>
        <button className="primary" onClick={() => setShowForm(true)}>+ Nouveau client</button>
      </div>
      <div className="toolbar">
        <input placeholder="Rechercher (nom, e-mail, localité)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(CLIENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucun client. Créez votre premier dossier avec « + Nouveau client ».</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Nom</th><th>Statut</th><th>Localité</th><th>Contact</th>
                <th className="num">Contrats actifs</th><th>Conformité</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="click" onClick={() => navigate(`/clients/${c.id}`)}>
                  <td><strong>{c.display_name}</strong>{c.type === 'entreprise' && <span className="muted"> · entreprise</span>}</td>
                  <td><Badge value={c.status} label={CLIENT_STATUS[c.status]} /></td>
                  <td>{[c.npa, c.city].filter(Boolean).join(' ') || '—'}</td>
                  <td>{c.email || c.phone || '—'}</td>
                  <td className="num">{c.active_contracts} / {c.total_contracts}</td>
                  <td>
                    {c.status === 'anonymise' ? '—' :
                      c.consent_data && c.mandate_signed && c.info_lsa_date
                        ? <Badge value="actif" label="En ordre" />
                        : <Badge value="attendue" label="Incomplet" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showForm && (
        <ClientForm
          onClose={() => setShowForm(false)}
          onSaved={(id) => { setShowForm(false); reload(); navigate(`/clients/${id}`); }}
        />
      )}
    </>
  );
}
