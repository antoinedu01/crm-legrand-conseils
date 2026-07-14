import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { fmtCHF, fmtDate, PIPELINE_STAGES, CLASSEMENTS } from '../labels.js';

function ScoringRulesModal({ onClose, onSaved }) {
  const { data, loading, reload } = useAsync(() => api.get('/api/prospects/scoring-rules'), []);
  const [error, setError] = useState(null);

  async function update(rule, patch) {
    setError(null);
    try {
      await api.put(`/api/prospects/scoring-rules/${rule.id}`, patch);
      reload();
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Réglages du scoring" onClose={onClose} wide>
      <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
        Chaque règle active ajoute (ou retire) des points. Le score organise votre travail —
        les raisons sont toujours affichées, et c'est vous qui décidez.
      </p>
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Règle</th><th className="num">Points</th><th>Active</th></tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.5 }}>
                <td>{r.label}</td>
                <td className="num">
                  <input
                    type="number" min="-100" max="100" defaultValue={r.points}
                    style={{ width: 70, textAlign: 'right' }}
                    onBlur={(e) => Number(e.target.value) !== r.points && update(r, { points: e.target.value })}
                  />
                </td>
                <td>
                  <label className="check">
                    <input type="checkbox" checked={!!r.active}
                           onChange={(e) => update(r, { active: e.target.checked ? 1 : 0 })} />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Classement : 10+ pts = Froid · 25+ = Tiède · 45+ = Chaud · 65+ = Prioritaire.
      </p>
      <div className="actions">
        <button className="primary" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}

function Prospects() {
  const [channelFilter, setChannelFilter] = useState('');
  const [showRules, setShowRules] = useState(false);
  const channels = useAsync(() => api.get('/api/channels'), []);
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/prospects?channel_id=${channelFilter}`),
    [channelFilter]
  );

  async function moveStage(p, stage) {
    await api.put(`/api/clients/${p.id}/lead`, { pipeline_stage: stage });
    reload();
  }

  const stages = Object.keys(PIPELINE_STAGES);
  const byStage = Object.fromEntries(stages.map((s) => [s, []]));
  (data || []).forEach((p) => (byStage[p.pipeline_stage] || byStage.nouveau).push(p));

  return (
    <>
      <div className="toolbar">
        <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
          <option value="">Tous les canaux</option>
          {(channels.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="grow" />
        <button onClick={() => setShowRules(true)}>⚙️ Réglages du scoring</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (data || []).length === 0 ? (
        <div className="card">
          <Empty>
            Aucun prospect pour le moment. Créez un client au statut « Prospect » (page Clients)
            et renseignez son origine — il apparaîtra ici avec son score.
          </Empty>
        </div>
      ) : (
        <div className="kanban">
          {stages.map((s) => (
            <div className="kcol" key={s}>
              <h3>{PIPELINE_STAGES[s]} <span className="count">{byStage[s].length}</span></h3>
              {byStage[s].map((p) => (
                <div className="kcard" key={p.id}>
                  <div className="name"><Link to={`/clients/${p.id}`}>{p.name}</Link></div>
                  <div className="meta">
                    {[p.channel_name, p.main_need, p.canton].filter(Boolean).join(' · ') || 'origine non renseignée'}
                  </div>
                  <div className="score-row">
                    <Badge value={p.classement} label={`${CLASSEMENTS[p.classement]} · ${p.score} pts`} />
                    {p.urgent && <Badge value="haute" label="Urgent" />}
                  </div>
                  {p.reasons.length > 0 && (
                    <details>
                      <summary>Pourquoi ce score ?</summary>
                      <ul>
                        {p.reasons.map((r) => (
                          <li key={r.label}>{r.label} ({r.points > 0 ? '+' : ''}{r.points})</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <select value={p.pipeline_stage} onChange={(e) => moveStage(p, e.target.value)}
                          aria-label="Changer d'étape">
                    {stages.map((st) => <option key={st} value={st}>{PIPELINE_STAGES[st]}</option>)}
                  </select>
                  <div className="meta">
                    {p.last_activity_at
                      ? `dernier échange : ${fmtDate(p.last_activity_at.slice(0, 10))}`
                      : `créé le ${fmtDate(p.created_at.slice(0, 10))} — aucun échange enregistré`}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {showRules && <ScoringRulesModal onClose={() => setShowRules(false)} onSaved={reload} />}
    </>
  );
}

function CostModal({ channel, onSaved, onClose }) {
  const now = new Date();
  const [form, setForm] = useState({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    amount: '',
    notes: '',
  });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/channels/${channel.id}/costs`, form);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={`Coût — ${channel.name}`} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Mois">
            <input type="month" required value={form.month} onChange={set('month')} />
          </Field>
          <Field label="Montant (CHF)">
            <input type="number" min="0" step="0.05" required value={form.amount} onChange={set('amount')} />
          </Field>
          <Field label="Note (facultatif)" full>
            <input value={form.notes} onChange={set('notes')} placeholder="p. ex. flyers, publicité, commission apporteur…" />
          </Field>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

function ChannelModal({ onSaved, onClose }) {
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/channels', form);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Nouveau canal d'acquisition" onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nom" full>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" full>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary">Créer</button>
        </div>
      </form>
    </Modal>
  );
}

function Channels() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [costFor, setCostFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/channels?year=${year}`),
    [year]
  );

  async function toggle(ch) {
    await api.put(`/api/channels/${ch.id}`, { active: ch.active ? 0 : 1 });
    reload();
  }

  const totals = (data || []).reduce(
    (acc, c) => ({
      leads: acc.leads + c.leads_year,
      costs: acc.costs + c.costs_year,
      contracts: acc.contracts + c.contracts_year,
      commissions: acc.commissions + c.commissions_year,
    }),
    { leads: 0, costs: 0, contracts: 0, commissions: 0 }
  );

  return (
    <>
      <div className="toolbar">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          {[0, 1, 2].map((i) => (
            <option key={i} value={currentYear - i}>{currentYear - i}</option>
          ))}
        </select>
        <div className="grow" />
        <button className="primary" onClick={() => setAdding(true)}>+ Nouveau canal</button>
      </div>

      <div className="tiles mb">
        <div className="tile">
          <div className="label">Leads reçus ({year})</div>
          <div className="value">{totals.leads}</div>
        </div>
        <div className="tile">
          <div className="label">Contrats signés ({year})</div>
          <div className="value">{totals.contracts}</div>
        </div>
        <div className="tile">
          <div className="label">Coûts engagés ({year})</div>
          <div className="value">{fmtCHF(totals.costs)}</div>
        </div>
        <div className="tile">
          <div className="label">Commissions perçues ({year})</div>
          <div className="value">{fmtCHF(totals.commissions)}</div>
          <div className="hint">
            {totals.costs > 0
              ? `retour : ${(totals.commissions / totals.costs).toFixed(1)}× la mise`
              : 'aucun coût saisi'}
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Canal</th>
                <th className="num">Leads {year}</th>
                <th className="num">Contrats</th>
                <th className="num">Coûts</th>
                <th className="num">CHF / lead</th>
                <th className="num">Commissions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((ch) => (
                <tr key={ch.id} style={ch.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <strong>{ch.name}</strong>
                    {!ch.active && <span className="muted"> · inactif</span>}
                    {ch.description && <div className="muted" style={{ fontSize: 12 }}>{ch.description}</div>}
                  </td>
                  <td className="num">{ch.leads_year}{ch.leads_total > ch.leads_year && <span className="muted"> / {ch.leads_total}</span>}</td>
                  <td className="num">{ch.contracts_year}</td>
                  <td className="num">{fmtCHF(ch.costs_year)}</td>
                  <td className="num">
                    {ch.leads_year > 0 && ch.costs_year > 0 ? fmtCHF(ch.costs_year / ch.leads_year) : '—'}
                  </td>
                  <td className="num">{fmtCHF(ch.commissions_year)}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="small" onClick={() => setCostFor(ch)}>+ Coût</button>{' '}
                    <button className="small ghost" onClick={() => toggle(ch)}>
                      {ch.active ? 'Désactiver' : 'Activer'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted mt" style={{ fontSize: 12 }}>
        L’origine de chaque prospect se renseigne sur sa fiche client (carte « Origine & prospection »).
        Les contrats et commissions d’un canal sont calculés à partir des prospects qui lui sont rattachés.
      </p>

      {costFor && <CostModal channel={costFor} onClose={() => setCostFor(null)} onSaved={() => { setCostFor(null); reload(); }} />}
      {adding && <ChannelModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export default function Development() {
  const [tab, setTab] = useState('prospects');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Développement du portefeuille</h1>
          <div className="sub">Acquisition de clients, suivi des canaux et actions commerciales</div>
        </div>
      </div>
      <div className="toolbar">
        <button className={tab === 'prospects' ? 'primary' : ''} onClick={() => setTab('prospects')}>
          Prospects & pipeline
        </button>
        <button className={tab === 'canaux' ? 'primary' : ''} onClick={() => setTab('canaux')}>
          Canaux d'acquisition
        </button>
      </div>
      {tab === 'prospects' && <Prospects />}
      {tab === 'canaux' && <Channels />}
    </>
  );
}
