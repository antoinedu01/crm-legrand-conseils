import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Badge, Empty, Modal, Field } from '../components/ui.jsx';
import { fmtDate, fmtCHF, COMMISSION_STATUS } from '../labels.js';

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
function isBookedOrConfirmed(appt) {
  return appt.status === 'booked' || appt.status === 'confirmed';
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

// Formatage local des compteurs (leads/clients/contrats) — CHF est délégué
// à fmtCHF (labels.js), déjà utilisé partout ailleurs dans le CRM ; pas de
// raison d'en dupliquer la logique ici. null/undefined restent "—" plutôt
// que d'être transformés en 0, qui aurait un sens différent.
const numberFormatter = new Intl.NumberFormat('fr-CH');
function formatNumber(n) {
  return n == null ? '—' : numberFormatter.format(n);
}

function SummaryTiles({ summary }) {
  const byStatus = Object.entries(summary.commissions.by_status || {});
  return (
    <div className="tiles mb">
      <div className="tile">
        <div className="label">Leads</div>
        <div className="value">{formatNumber(summary.leads.total)}</div>
      </div>
      <div className="tile">
        <div className="label">Clients convertis</div>
        <div className="value">{formatNumber(summary.clients.total_converted)}</div>
        <div className="hint">dont {formatNumber(summary.clients.unattributed)} non attribué(s)</div>
      </div>
      <div className="tile">
        <div className="label">Contrats</div>
        <div className="value">{formatNumber(summary.contracts.total)}</div>
        <div className="hint">dont {formatNumber(summary.contracts.unattributed)} non attribué(s)</div>
      </div>
      <div className="tile">
        <div className="label">Commissions</div>
        <div className="value">{fmtCHF(summary.commissions.total_amount)}</div>
        {byStatus.length > 0 && (
          <div className="hint">
            {byStatus.map(([status, amount]) => `${COMMISSION_STATUS[status] || status} ${fmtCHF(amount)}`).join(' · ')}
          </div>
        )}
      </div>
      <div className="tile">
        <div className="label">Coûts d'acquisition bruts</div>
        <div className="value">{fmtCHF(summary.channel_costs.total_amount)}</div>
      </div>
    </div>
  );
}

// Tri : commissions décroissantes, départage déterministe par nom de
// campagne (évite un ordre instable entre deux rechargements en cas
// d'égalité de commissions).
function byCommissionsDesc(a, b) {
  return b.commissions_amount - a.commissions_amount || a.campaign_name.localeCompare(b.campaign_name, 'fr-CH');
}

function CampaignsPerformanceTable({ data }) {
  const rows = [...(data?.campaigns || [])].sort(byCommissionsDesc);
  const unattributed = data?.unattributed;
  return (
    <>
      {rows.length === 0 ? (
        <Empty>Aucune campagne enregistrée.</Empty>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Campagne</th>
              <th>Canal</th>
              <th className="num">Leads</th>
              <th className="num">Clients</th>
              <th className="num">Contrats</th>
              <th className="num">Commissions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.campaign_id}>
                <td>{c.campaign_name} <Badge value={c.campaign_status} label={c.campaign_status} /></td>
                <td>{c.channel_name || 'Non attribué'}</td>
                <td className="num">{formatNumber(c.leads)}</td>
                <td className="num">{formatNumber(c.clients_converted)}</td>
                <td className="num">{formatNumber(c.contracts)}</td>
                <td className="num">{fmtCHF(c.commissions_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unattributed && (
        // unattributed n'a pas de champ "leads" côté backend (voir
        // server/routes/acquisition-analytics.js) : jamais affiché comme 0.
        <p className="muted mt" style={{ fontSize: 13 }}>
          Non attribué (sans campagne) : {formatNumber(unattributed.clients_total)} client(s) converti(s) ·{' '}
          {formatNumber(unattributed.contracts)} contrat(s) · {fmtCHF(unattributed.commissions_amount)} de commissions.
        </p>
      )}
    </>
  );
}

function ChannelsPerformanceTable({ data }) {
  // Ordre backend conservé tel quel (ch.active DESC, ch.sort, ch.name) —
  // aucune préférence de tri n'a été demandée pour cette table.
  const rows = data?.channels || [];
  const unattributed = data?.unattributed;
  return (
    <>
      {rows.length === 0 ? (
        <Empty>Aucun canal enregistré.</Empty>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Canal</th>
              <th className="num">Leads</th>
              <th className="num">Clients</th>
              <th className="num">Contrats</th>
              <th className="num">Commissions</th>
              <th className="num">Coûts bruts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ch) => (
              <tr key={ch.channel_id} style={ch.active ? undefined : { opacity: 0.6 }}>
                <td>{ch.channel_name}{!ch.active && <span className="muted"> · inactif</span>}</td>
                <td className="num">{formatNumber(ch.leads)}</td>
                <td className="num">{formatNumber(ch.clients_converted)}</td>
                <td className="num">{formatNumber(ch.contracts)}</td>
                <td className="num">{fmtCHF(ch.commissions_amount)}</td>
                <td className="num">{fmtCHF(ch.costs_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unattributed && (
        // unattributed n'a ni "leads" ni "costs_total" côté backend : jamais
        // affichés comme 0.
        <p className="muted mt" style={{ fontSize: 13 }}>
          Non attribué (sans canal) : {formatNumber(unattributed.clients_total)} client(s) converti(s) ·{' '}
          {formatNumber(unattributed.contracts)} contrat(s) · {fmtCHF(unattributed.commissions_amount)} de commissions.
        </p>
      )}
    </>
  );
}

function AttributionAnalytics() {
  const summaryQ = useAsync(() => api.get('/api/acquisition/analytics/summary'), []);
  const campaignsQ = useAsync(() => api.get('/api/acquisition/analytics/campaigns'), []);
  const channelsQ = useAsync(() => api.get('/api/acquisition/analytics/channels'), []);

  function refreshAll() {
    summaryQ.reload();
    campaignsQ.reload();
    channelsQ.reload();
  }

  // Les 3 endpoints renvoient le même tableau `caveats` (voir
  // server/routes/acquisition-analytics.js), mais on déduplique par égalité
  // stricte de chaîne plutôt que de supposer qu'ils resteront identiques.
  const caveats = useMemo(() => {
    const all = [
      ...(summaryQ.data?.caveats || []),
      ...(campaignsQ.data?.caveats || []),
      ...(channelsQ.data?.caveats || []),
    ];
    return [...new Set(all)];
  }, [summaryQ.data, campaignsQ.data, channelsQ.data]);

  return (
    <>
      <div className="toolbar">
        <div className="grow" />
        <button className="ghost small" onClick={refreshAll}>Actualiser</button>
      </div>

      {summaryQ.error && <div className="alert error">{summaryQ.error}</div>}
      {summaryQ.loading ? (
        <p className="muted">Chargement…</p>
      ) : summaryQ.data && <SummaryTiles summary={summaryQ.data} />}

      <div className="card mt">
        <h2>Performance par campagne</h2>
        {campaignsQ.error && <div className="alert error">{campaignsQ.error}</div>}
        {campaignsQ.loading ? (
          <p className="muted">Chargement…</p>
        ) : (
          <CampaignsPerformanceTable data={campaignsQ.data} />
        )}
      </div>

      <div className="card mt">
        <h2>Performance par canal</h2>
        {channelsQ.error && <div className="alert error">{channelsQ.error}</div>}
        {channelsQ.loading ? (
          <p className="muted">Chargement…</p>
        ) : (
          <ChannelsPerformanceTable data={channelsQ.data} />
        )}
      </div>

      {caveats.length > 0 && (
        <div className="card mt">
          <h2>À propos des données</h2>
          <ul className="mt" style={{ margin: 0, paddingLeft: 18 }}>
            {caveats.map((c) => (
              <li key={c} className="muted" style={{ fontSize: 13, marginBottom: 6 }}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// Indicateurs RDV de la Vue d'ensemble : définitions volontairement propres
// à cet écran (pas une redéfinition des groupes de l'onglet Rendez-vous,
// voir server/routes/acquisition-analytics.js pour l'esprit — ici c'est un
// pur indicateur d'interface). "Aujourd'hui" reprend la même règle que le
// groupe Aujourd'hui de A3b (tout statut sauf annulé/no-show). "À venir" est
// volontairement plus étroit (booked/confirmed uniquement, jour strictement
// futur) : un indicateur "commercialement pertinent", pas un inventaire
// complet — classify()/groupAppointments() (A3b) ne sont pas modifiés.
function Overview({ setTab }) {
  const summaryQ = useAsync(() => api.get('/api/acquisition/analytics/summary'), []);
  const appointmentsQ = useAsync(() => api.get('/api/appointments'), []);
  const campaignsQ = useAsync(() => api.get('/api/campaigns'), []);

  function refreshAll() {
    summaryQ.reload();
    appointmentsQ.reload();
    campaignsQ.reload();
  }

  const today = localDayKey(new Date());
  const appointments = appointmentsQ.data || [];
  const todayCount = appointments.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'no_show' && dayKeyOf(a.starts_at) === today
  ).length;
  const upcomingCount = appointments.filter(
    (a) => isBookedOrConfirmed(a) && dayKeyOf(a.starts_at) > today
  ).length;
  // "Aujourd'hui restant / futur" : comparaison au niveau du jour uniquement
  // (comme partout ailleurs dans ce fichier), pas de comparaison à l'heure
  // près — cohérent avec l'absence de logique d'heure "maintenant" ailleurs
  // dans Acquisition.jsx.
  const nextAppointments = appointments
    .filter((a) => isBookedOrConfirmed(a) && dayKeyOf(a.starts_at) >= today)
    .sort(byStartsAtAsc)
    .slice(0, 5);

  const campaigns = campaignsQ.data || [];
  const recentCampaigns = campaigns.slice(0, 3);

  return (
    <>
      <div className="toolbar">
        <div className="grow" />
        <button className="ghost small" onClick={refreshAll}>Actualiser</button>
      </div>

      <div className="tiles mb">
        <div className="tile">
          <div className="label">Leads</div>
          <div className="value">
            {summaryQ.loading ? '…' : summaryQ.error ? '—' : formatNumber(summaryQ.data.leads.total)}
          </div>
        </div>
        <div className="tile">
          <div className="label">Clients convertis</div>
          <div className="value">
            {summaryQ.loading ? '…' : summaryQ.error ? '—' : formatNumber(summaryQ.data.clients.total_converted)}
          </div>
          {!summaryQ.loading && !summaryQ.error && (
            <div className="hint">dont {formatNumber(summaryQ.data.clients.unattributed)} non attribué(s)</div>
          )}
        </div>
        <div className="tile">
          <div className="label">Contrats</div>
          <div className="value">
            {summaryQ.loading ? '…' : summaryQ.error ? '—' : formatNumber(summaryQ.data.contracts.total)}
          </div>
          {!summaryQ.loading && !summaryQ.error && (
            <div className="hint">dont {formatNumber(summaryQ.data.contracts.unattributed)} non attribué(s)</div>
          )}
        </div>
        <div className="tile">
          <div className="label">Commissions</div>
          <div className="value">
            {summaryQ.loading ? '…' : summaryQ.error ? '—' : fmtCHF(summaryQ.data.commissions.total_amount)}
          </div>
        </div>
        <div className="tile">
          <div className="label">RDV aujourd'hui</div>
          <div className="value">{appointmentsQ.loading ? '…' : appointmentsQ.error ? '—' : formatNumber(todayCount)}</div>
        </div>
        <div className="tile">
          <div className="label">RDV à venir</div>
          <div className="value">{appointmentsQ.loading ? '…' : appointmentsQ.error ? '—' : formatNumber(upcomingCount)}</div>
        </div>
        <div className="tile">
          <div className="label">Campagnes</div>
          <div className="value">{campaignsQ.loading ? '…' : campaignsQ.error ? '—' : formatNumber(campaigns.length)}</div>
        </div>
      </div>
      {summaryQ.error && <div className="alert error">{summaryQ.error}</div>}

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Prochains rendez-vous</h2>
          {appointmentsQ.error && <div className="alert error">{appointmentsQ.error}</div>}
          {appointmentsQ.loading ? (
            <p className="muted">Chargement…</p>
          ) : appointmentsQ.error ? null : nextAppointments.length === 0 ? (
            <Empty>Aucun rendez-vous à venir.</Empty>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Quand</th><th>Client</th><th>Type</th><th>Statut</th><th></th></tr>
              </thead>
              <tbody>
                {nextAppointments.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDate(dayKeyOf(a.starts_at))} {timeOf(a.starts_at)}</td>
                    <td><Link to={`/clients/${a.client_id}`}>{a.client_name || `Client #${a.client_id}`}</Link></td>
                    <td>{APPOINTMENT_TYPE_LABELS[a.appointment_type] || a.appointment_type}</td>
                    <td><Badge value={a.status} label={STATUS_LABELS[a.status] || a.status} /></td>
                    <td><Link to={`/clients/${a.client_id}`}>Ouvrir le client</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Campagnes récentes</h2>
          {campaignsQ.error && <div className="alert error">{campaignsQ.error}</div>}
          {campaignsQ.loading ? (
            <p className="muted">Chargement…</p>
          ) : campaignsQ.error ? null : recentCampaigns.length === 0 ? (
            <Empty>Aucune campagne enregistrée.</Empty>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Nom</th><th>Canal</th><th>Statut</th></tr>
              </thead>
              <tbody>
                {recentCampaigns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.channel_name || 'Non attribué'}</td>
                    <td><Badge value={c.status} label={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

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

      <div className="card mt">
        <h2>Actions rapides</h2>
        <div className="toolbar">
          <button className="small" onClick={() => setTab('rdv')}>Voir les rendez-vous</button>
          <button className="small" onClick={() => setTab('campagnes')}>Voir les campagnes</button>
          <button className="small" onClick={() => setTab('analytics')}>Voir les analytics</button>
          <Link to="/developpement">Voir les prospects & le pipeline →</Link>
        </div>
      </div>
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
      {tab === 'apercu' && <Overview setTab={setTab} />}
      {tab === 'rdv' && <Appointments />}
      {tab === 'campagnes' && <Campaigns />}
      {tab === 'analytics' && <AttributionAnalytics />}
    </>
  );
}
