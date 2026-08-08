import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Badge, Empty, Field } from '../components/ui.jsx';
import {
  BRANCHES, CONTRACT_STATUS, CLIENT_STATUS, COMMISSION_STATUS, COMMISSION_TYPES,
  ACTIVITY_TYPES, PIPELINE_STAGES, AGE_RANGES, WORK_SITUATIONS, MAIN_NEEDS, CONTACT_PREFS,
  fmtCHF, fmtDate, fmtDateTime,
} from '../labels.js';
import { ClientForm } from './Clients.jsx';
import { ContractForm } from './Contracts.jsx';

function LeadCard({ clientId, lead, onSaved }) {
  const [channels, setChannels] = React.useState([]);
  const [clients, setClients] = React.useState([]);
  const [form, setForm] = React.useState({
    channel_id: lead?.channel_id || '',
    referrer_client_id: lead?.referrer_client_id || '',
    pipeline_stage: lead?.pipeline_stage || 'nouveau',
    main_need: lead?.main_need || '',
    age_range: lead?.age_range || '',
    work_situation: lead?.work_situation || '',
    contact_pref: lead?.contact_pref || '',
    urgent: Boolean(lead?.urgent),
  });
  const [message, setMessage] = React.useState(null);
  const [error, setError] = React.useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  React.useEffect(() => {
    api.get('/api/channels').then((rows) => setChannels(rows.filter((c) => c.active)));
    api.get('/api/clients').then((rows) =>
      setClients(rows.filter((c) => c.status !== 'anonymise' && c.id !== Number(clientId)))
    );
  }, [clientId]);

  async function save(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.put(`/api/clients/${clientId}/lead`, form);
      setMessage('Origine enregistrée.');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  const isReferral = channels.find((c) => String(c.id) === String(form.channel_id))?.key === 'recommandations';

  return (
    <div className="card">
      <h2>Origine & prospection</h2>
      {message && <div className="alert ok">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={save}>
        <div className="form-grid">
          <Field label="Canal d'acquisition">
            <select value={form.channel_id} onChange={set('channel_id')}>
              <option value="">— Non renseigné —</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Étape du pipeline">
            <select value={form.pipeline_stage} onChange={set('pipeline_stage')}>
              {Object.entries(PIPELINE_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {isReferral && (
            <Field label="Recommandé par" full>
              <select value={form.referrer_client_id} onChange={set('referrer_client_id')}>
                <option value="">— Choisir le client parrain —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Besoin principal">
            <select value={form.main_need} onChange={set('main_need')}>
              <option value="">—</option>
              {MAIN_NEEDS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Meilleure plage de contact">
            <select value={form.contact_pref} onChange={set('contact_pref')}>
              <option value="">—</option>
              {CONTACT_PREFS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Tranche d'âge">
            <select value={form.age_range} onChange={set('age_range')}>
              <option value="">—</option>
              {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Situation professionnelle">
            <select value={form.work_situation} onChange={set('work_situation')}>
              <option value="">—</option>
              {WORK_SITUATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <label className="check full">
            <input type="checkbox" checked={form.urgent}
                   onChange={(e) => setForm({ ...form, urgent: e.target.checked })} />
            Besoin urgent ou échéance proche (résiliation, fin de contrat…)
          </label>
        </div>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="primary small">Enregistrer l'origine</button>
          {lead?.referrer_name && !isReferral && (
            <span className="muted" style={{ fontSize: 12 }}>Recommandé par {lead.referrer_name}</span>
          )}
        </div>
      </form>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div>{value || '—'}</div>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [addingContract, setAddingContract] = useState(false);
  const [activity, setActivity] = useState({ type: 'note', content: '' });
  const [warnings, setWarnings] = useState([]);
  const { data: c, loading, error, reload } = useAsync(() => api.get(`/api/clients/${id}`), [id]);

  if (loading) return <p className="muted">Chargement…</p>;
  if (error) return <div className="alert error">{error}</div>;

  const anonymized = c.status === 'anonymise';
  const complianceOk = c.consent_data && c.mandate_signed && c.info_lsa_date;

  async function addActivity(e) {
    e.preventDefault();
    if (!activity.content.trim()) return;
    await api.post(`/api/clients/${id}/activities`, activity);
    setActivity({ type: 'note', content: '' });
    reload();
  }

  async function anonymize() {
    const name = c.display_name;
    if (!window.confirm(
      `Anonymiser définitivement le dossier de ${name} ?\n\nToutes les données personnelles seront effacées (droit à l'effacement, nLPD). ` +
      `Les données contractuelles sont conservées de manière anonyme (obligation légale, 10 ans).\n\nCette action est irréversible.`
    )) return;
    await api.post(`/api/clients/${id}/anonymize`);
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{c.display_name}</h1>
          <div className="sub flex">
            <Badge value={c.status} label={CLIENT_STATUS[c.status]} />
            {!anonymized && (complianceOk
              ? <Badge value="actif" label="Conformité en ordre" />
              : <Badge value="attendue" label="Conformité incomplète" />)}
          </div>
        </div>
        <div className="flex">
          <a href={`/api/clients/${id}/export`} download>
            <button type="button">⬇ Export des données (nLPD)</button>
          </a>
          {!anonymized && <button onClick={() => setEditing(true)}>Modifier</button>}
          {!anonymized && <button className="danger" onClick={anonymize}>Anonymiser</button>}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="alert warn">
          <strong>Contrat créé, mais des points de conformité sont ouverts :</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {!anonymized && !complianceOk && (
        <div className="alert warn">
          Dossier incomplet :{' '}
          {[
            !c.consent_data && 'consentement nLPD manquant',
            !c.mandate_signed && 'mandat de courtage non signé',
            !c.info_lsa_date && 'information art. 45 LSA non remise',
          ].filter(Boolean).join(' · ')}
          {' — '}<a onClick={() => setEditing(true)} style={{ cursor: 'pointer' }}>compléter</a>
        </div>
      )}

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Coordonnées</h2>
          <div className="grid cols-2">
            <Info label="E-mail" value={c.email} />
            <Info label="Téléphone" value={c.phone} />
            <Info label="Adresse" value={[c.address, [c.npa, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')} />
            <Info label="Canton" value={c.canton} />
            {c.type === 'particulier' && (
              <>
                <Info label="Date de naissance" value={fmtDate(c.birth_date)} />
                <Info label="État civil" value={c.marital_status} />
                <Info label="Profession" value={c.profession} />
                <Info label="Nationalité" value={c.nationality} />
              </>
            )}
          </div>
          {c.notes && <p className="mt" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
        </div>
        <div className="card">
          <h2>Conformité du dossier</h2>
          <table className="data">
            <tbody>
              <tr>
                <td>Consentement au traitement des données (nLPD)</td>
                <td className="right">{c.consent_data ? <Badge value="actif" label={`Oui — ${fmtDate(c.consent_date)}`} /> : <Badge value="attendue" label="Manquant" />}</td>
              </tr>
              <tr>
                <td>Mandat de courtage</td>
                <td className="right">{c.mandate_signed ? <Badge value="actif" label={`Signé — ${fmtDate(c.mandate_date)}`} /> : <Badge value="attendue" label="Non signé" />}</td>
              </tr>
              <tr>
                <td>Information selon l’art. 45 LSA</td>
                <td className="right">{c.info_lsa_date ? <Badge value="actif" label={`Remise — ${fmtDate(c.info_lsa_date)}`} /> : <Badge value="attendue" label="Non remise" />}</td>
              </tr>
              <tr>
                <td>Dossier créé le</td>
                <td className="right muted">{fmtDateTime(c.created_at)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mb">
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <h2>Contrats ({c.contracts.length})</h2>
          {!anonymized && <button className="small primary" onClick={() => setAddingContract(true)}>+ Nouveau contrat</button>}
        </div>
        {c.contracts.length === 0 ? (
          <Empty>Aucun contrat pour ce client.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Branche</th><th>Compagnie</th><th>Police</th><th>Statut</th>
                <th className="num">Prime/an</th><th>Début</th><th>Échéance</th>
              </tr>
            </thead>
            <tbody>
              {c.contracts.map((ct) => (
                <tr key={ct.id} className="click" onClick={() => navigate(`/contrats?q=${encodeURIComponent(ct.policy_number || ct.product_name || '')}`)}>
                  <td><strong>{BRANCHES[ct.branch] || ct.branch}</strong>{ct.product_name && <div className="muted" style={{ fontSize: 12 }}>{ct.product_name}</div>}</td>
                  <td>{ct.company_name}</td>
                  <td>{ct.policy_number || '—'}</td>
                  <td><Badge value={ct.status} label={CONTRACT_STATUS[ct.status]} /></td>
                  <td className="num">{fmtCHF(ct.annual_premium)}</td>
                  <td>{fmtDate(ct.start_date)}</td>
                  <td>{fmtDate(ct.end_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!anonymized && (
        <div className="mb">
          <LeadCard clientId={id} lead={c.lead} onSaved={reload} />
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h2>Suivi & activités</h2>
          {!anonymized && (
            <form onSubmit={addActivity} className="flex mb">
              <select value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })}>
                {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input className="grow" placeholder="Ajouter une note, un appel, un rendez-vous…"
                     value={activity.content}
                     onChange={(e) => setActivity({ ...activity, content: e.target.value })} />
              <button className="primary small">Ajouter</button>
            </form>
          )}
          {c.activities.length === 0 ? (
            <Empty>Aucune activité enregistrée.</Empty>
          ) : (
            <ul className="timeline">
              {c.activities.map((a) => (
                <li key={a.id}>
                  <span className="when">{fmtDateTime(a.created_at)}</span>
                  <span><Badge value="" label={ACTIVITY_TYPES[a.type] || a.type} /> {a.content}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2>Commissions liées</h2>
          {c.commissions.length === 0 ? (
            <Empty>Aucune commission pour ce client.</Empty>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Type</th><th>Échéance</th><th className="num">Attendu</th>
                  <th className="num">Reçu</th><th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {c.commissions.map((cm) => (
                  <tr key={cm.id}>
                    <td>{COMMISSION_TYPES[cm.type] || cm.type}</td>
                    <td>{fmtDate(cm.expected_payment_date)}</td>
                    <td className="num">{fmtCHF(cm.expected_amount_chf)}</td>
                    <td className="num">{fmtCHF(cm.received_amount_chf)}</td>
                    <td><Badge value={cm.status} label={COMMISSION_STATUS[cm.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt"><Link to="/commissions">Gérer les commissions →</Link></div>
        </div>
      </div>

      {editing && (
        <ClientForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      )}
      {addingContract && (
        <ContractForm
          initialClientId={Number(id)}
          onClose={() => setAddingContract(false)}
          onSaved={(w) => { setAddingContract(false); setWarnings(w || []); reload(); }}
        />
      )}
    </>
  );
}
