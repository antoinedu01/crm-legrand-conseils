import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Badge, Empty, Modal, Field } from '../components/ui.jsx';
import { fmtDate } from '../labels.js';

function Overview() {
  return (
    <div className="card">
      <h2>Prospects & pipeline</h2>
      <p className="muted">
        Le suivi des prospects, le scoring et le pipeline commercial restent gérés depuis la page
        Développement.
      </p>
      <div className="mt">
        <Link to="/developpement">Voir les prospects & le pipeline →</Link>
      </div>
    </div>
  );
}

function ComingSoon({ label }) {
  return (
    <div className="card">
      <Empty>Le module {label} sera disponible dans une prochaine étape.</Empty>
    </div>
  );
}

const STATUS_LABELS = {
  booked: 'Réservé',
  confirmed: 'Confirmé',
  completed: 'Réalisé',
  no_show: 'No-show',
  cancelled: 'Annulé',
};

const APPOINTMENT_TYPE_LABELS = {
  assurance_sante: 'Assurance santé',
  prevoyance: 'Prévoyance',
  client_360: 'Client 360',
  follow_up: 'Suivi',
  signature: 'Signature',
  other: 'Autre',
};

const LOCATION_TYPE_LABELS = {
  in_person: 'Présentiel',
  phone: 'Téléphone',
  video: 'Visioconférence',
};

// Clé locale AAAA-MM-JJ construite depuis la date du navigateur (getFullYear/
// getMonth/getDate), volontairement PAS via toISOString() : toISOString()
// convertit en UTC et décalerait "aujourd'hui" d'un jour autour de minuit
// pour un fuseau positif comme celui de la Suisse.
function localDayKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// starts_at est déjà au format canonique "AAAA-MM-JJ HH:MM:SS" — la valeur
// métier locale telle qu'imposée par server/routes/appointments.js. Un
// simple découpage de chaîne suffit ; aucun objet Date, aucune conversion
// de fuseau n'est nécessaire ni souhaitable ici.
function dayKeyOf(startsAt) {
  return startsAt.slice(0, 10);
}
function timeOf(startsAt) {
  return startsAt.slice(11, 16);
}
function byStartsAtAsc(a, b) {
  return a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0;
}
function byStartsAtDesc(a, b) {
  return byStartsAtAsc(b, a);
}

const GROUPS = [
  { key: 'aujourdhui', label: "Aujourd'hui", showDate: false, sort: byStartsAtAsc },
  { key: 'avenir', label: 'À venir', showDate: true, sort: byStartsAtAsc },
  { key: 'passes', label: 'Passés', showDate: true, sort: byStartsAtDesc },
  { key: 'annules', label: 'No-show / annulés', showDate: true, sort: byStartsAtDesc },
];

// Priorité 1 : un statut no_show/cancelled classe toujours dans le groupe
// dédié, quelle que soit la date — un rendez-vous annulé ne doit jamais
// apparaître aussi dans "À venir" ou "Passés".
function classify(appt, today) {
  if (appt.status === 'no_show' || appt.status === 'cancelled') return 'annules';
  const day = dayKeyOf(appt.starts_at);
  if (day === today) return 'aujourdhui';
  if (day > today) return 'avenir';
  return 'passes';
}

function groupAppointments(rows) {
  const today = localDayKey(new Date());
  const buckets = { aujourdhui: [], avenir: [], passes: [], annules: [] };
  for (const appt of rows) buckets[classify(appt, today)].push(appt);
  for (const g of GROUPS) buckets[g.key].sort(g.sort);
  return buckets;
}

function AppointmentRow({ appt, showDate }) {
  return (
    <tr>
      <td>{showDate ? `${fmtDate(dayKeyOf(appt.starts_at))} ${timeOf(appt.starts_at)}` : timeOf(appt.starts_at)}</td>
      <td>
        <Link to={`/clients/${appt.client_id}`}>{appt.client_name || `Client #${appt.client_id}`}</Link>
        {appt.notes && <div className="muted" style={{ fontSize: 12 }}>{appt.notes}</div>}
      </td>
      <td>
        {APPOINTMENT_TYPE_LABELS[appt.appointment_type] || appt.appointment_type}
        {' · '}
        {LOCATION_TYPE_LABELS[appt.location_type] || appt.location_type}
        {appt.location && <div className="muted" style={{ fontSize: 12 }}>{appt.location}</div>}
        {appt.meeting_url && (
          <div style={{ fontSize: 12 }}>
            <a href={appt.meeting_url} target="_blank" rel="noreferrer">Lien de visioconférence</a>
          </div>
        )}
      </td>
      <td><Badge value={appt.status} label={STATUS_LABELS[appt.status] || appt.status} /></td>
      <td><Link to={`/clients/${appt.client_id}`}>Ouvrir le client</Link></td>
    </tr>
  );
}

function AppointmentsGroup({ label, rows, showDate }) {
  if (rows.length === 0) return null;
  return (
    <div className="card mt">
      <h2>{label} <span className="muted">({rows.length})</span></h2>
      <table className="data">
        <thead>
          <tr>
            <th>{showDate ? 'Date & heure' : 'Heure'}</th>
            <th>Client</th>
            <th>Type & lieu</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((appt) => <AppointmentRow key={appt.id} appt={appt} showDate={showDate} />)}
        </tbody>
      </table>
    </div>
  );
}

function Appointments() {
  const { data, loading, error, reload } = useAsync(() => api.get('/api/appointments'), []);
  const groups = useMemo(() => groupAppointments(data || []), [data]);
  const total = (data || []).length;

  return (
    <>
      <div className="toolbar">
        <button className="ghost small" onClick={reload}>Actualiser</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : total === 0 ? (
        <div className="card"><Empty>Aucun rendez-vous enregistré.</Empty></div>
      ) : (
        GROUPS.map((g) => (
          <AppointmentsGroup key={g.key} label={g.label} rows={groups[g.key]} showDate={g.showDate} />
        ))
      )}
    </>
  );
}

function CampaignForm({ initial, channels, onSaved, onClose }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    channel_id: initial?.channel_id != null ? String(initial.channel_id) : '',
    status: initial?.status || 'brouillon',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const name = form.name.trim();
    const status = form.status.trim();
    // Validation UX minimale seulement — le backend reste l'autorité finale
    // (server/routes/campaigns.js: validateCampaign). On bloque toutefois un
    // statut vide ici : côté serveur, une chaîne vide est convertie en NULL
    // avant la validation "non vide" (pick() transforme '' en null), et
    // status est NOT NULL en base (server/db.js) — un statut vide
    // provoquerait donc une erreur SQL brute plutôt qu'un message propre.
    if (!name) return setError('Le nom de la campagne est requis.');
    if (!status) return setError('Le statut ne peut pas être vide.');
    setSubmitting(true);
    try {
      const payload = { name, channel_id: form.channel_id, status };
      if (initial?.id) await api.put(`/api/campaigns/${initial.id}`, payload);
      else await api.post('/api/campaigns', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={initial?.id ? 'Modifier la campagne' : 'Nouvelle campagne'} onClose={onClose}>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Nom" full>
            <input required value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Canal">
            <select value={form.channel_id} onChange={set('channel_id')}>
              <option value="">Non attribué</option>
              {(channels || []).map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <input required value={form.status} onChange={set('status')} placeholder="brouillon" />
          </Field>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={submitting}>{initial?.id ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Campaigns() {
  const [editing, setEditing] = useState(null);
  const { data: campaigns, loading, error, reload } = useAsync(() => api.get('/api/campaigns'), []);
  const { data: channels, reload: reloadChannels } = useAsync(() => api.get('/api/channels'), []);

  function refreshAll() {
    reload();
    reloadChannels();
  }

  return (
    <>
      <div className="toolbar">
        <div className="grow" />
        <button className="ghost small" onClick={refreshAll}>Actualiser</button>{' '}
        <button className="primary" onClick={() => setEditing({})}>+ Nouvelle campagne</button>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : (campaigns || []).length === 0 ? (
          <Empty>Aucune campagne enregistrée.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Canal</th>
                <th>Statut</th>
                <th>Créée le</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.channel_name || 'Non attribué'}</td>
                  <td><Badge value={c.status} label={c.status} /></td>
                  <td>{fmtDate(c.created_at.slice(0, 10))}</td>
                  <td className="right">
                    <button className="small" onClick={() => setEditing(c)}>Modifier</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing !== null && (
        <CampaignForm
          initial={editing.id ? editing : undefined}
          channels={channels}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

export default function Acquisition() {
  const [tab, setTab] = useState('apercu');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Acquisition</h1>
          <div className="sub">Pilotez vos rendez-vous, campagnes et performances d'acquisition.</div>
        </div>
      </div>
      <div className="toolbar">
        <button className={tab === 'apercu' ? 'primary' : ''} onClick={() => setTab('apercu')}>
          Vue d'ensemble
        </button>
        <button className={tab === 'rdv' ? 'primary' : ''} onClick={() => setTab('rdv')}>
          Rendez-vous
        </button>
        <button className={tab === 'campagnes' ? 'primary' : ''} onClick={() => setTab('campagnes')}>
          Campagnes
        </button>
        <button className={tab === 'analytics' ? 'primary' : ''} onClick={() => setTab('analytics')}>
          Analytics
        </button>
      </div>
      {tab === 'apercu' && <Overview />}
      {tab === 'rdv' && <Appointments />}
      {tab === 'campagnes' && <Campaigns />}
      {tab === 'analytics' && <ComingSoon label="Analytics" />}
    </>
  );
}
