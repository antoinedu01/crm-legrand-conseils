import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync, Badge, Empty, Field, Modal } from '../components/ui.jsx';
import { fmtDateTime } from '../labels.js';

// Consultation et SIMULATION uniquement (Legrand Diagnostic 360, chantier
// préalable à l'activation, docs/advisory/DATA_RETENTION.md). AUCUN bouton
// d'exécution réelle sur cet écran -- cohérent avec l'absence de route
// `executePurge` côté serveur (server/advisoryRetention.js). Toute la
// politique reste désactivée par défaut ; les durées affichées sont
// PROPOSÉES, jamais présentées comme juridiquement validées.

const CATEGORY_LABELS = {
  abandoned_diagnostic: 'A — Diagnostic abandonné',
  prospect_no_mandate: 'B — Prospect sans mandat ni contrat',
  finalized_advice: 'C — Conseil finalisé',
  audit_log: 'D — Journaux d’audit',
  backups: 'E — Sauvegardes',
};

const ACTION_LABELS = { delete: 'Suppression', anonymize: 'Anonymisation', retain: 'Conservation (aucune action)' };

// Catégories B/C : arithmétique CALENDAIRE exacte (décision humaine du
// 2026-08-04, server/advisoryRetention.js, addCalendarMonths) -- jamais une
// approximation en jours. `duration_days` (365/3650) reste seedé en base à
// titre d'ordre de grandeur, mais n'est plus la source du calcul pour ces
// deux catégories : on affiche donc l'unité calendaire exacte plutôt que la
// valeur brute en jours, pour ne jamais laisser croire à une précision
// journalière qui n'est plus la réalité du calcul.
const CALENDAR_DURATION_LABELS = {
  prospect_no_mandate: '12 mois calendaires',
  finalized_advice: '10 années calendaires',
};

function durationLabel(policy) {
  return CALENDAR_DURATION_LABELS[policy.category] || `${policy.duration_days} jour${policy.duration_days > 1 ? 's' : ''}`;
}

function PoliciesPanel() {
  const { data: policies, loading } = useAsync(() => api.get('/api/advisory/retention/policies').then((r) => r.policies), []);
  if (loading) return <p className="muted">Chargement…</p>;
  const anyEnabled = policies.some((p) => p.enabled);
  return (
    <section className="card">
      <h2>Politique de conservation</h2>
      {!anyEnabled && (
        <p className="alert warn">
          Aucune catégorie n’est activée — politique <strong>en attente de validation juridique</strong> (voir
          docs/advisory/DATA_RETENTION.md). Aucune donnée de diagnostic n’est concernée par une conservation limitée
          tant qu’aucune catégorie n’est activée.
        </p>
      )}
      <table className="data">
        <thead>
          <tr>
            <th>Catégorie</th><th>État</th><th>Durée proposée</th><th>Description</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.id}>
              <td>{CATEGORY_LABELS[p.category] || p.category}</td>
              <td><Badge value={p.enabled ? 'active' : 'archive'} label={p.enabled ? 'Active' : 'Inactive'} /></td>
              <td>{durationLabel(p)}</td>
              <td className="muted">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DryRunPanel() {
  const { data: runs, loading, reload } = useAsync(() => api.get('/api/advisory/retention/purge-runs?run_type=dry_run').then((r) => r.runs), []);
  const [selected, setSelected] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function runSimulation() {
    setRunning(true);
    setError('');
    try {
      const run = await api.post('/api/advisory/retention/dry-run', {});
      await reload();
      setSelected(run);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card">
      <h2>Simulation (dry-run)</h2>
      <p className="muted">
        Seul mode disponible : calcule les dossiers éligibles sans jamais modifier ni supprimer aucune donnée de
        diagnostic. Aucune purge réelle n’est possible depuis cette interface.
      </p>
      {error && <p className="alert error">{error}</p>}
      <button className="primary" onClick={runSimulation} disabled={running}>
        {running ? 'Simulation en cours…' : 'Lancer une simulation'}
      </button>

      <h3 style={{ marginTop: 24 }}>Historique des simulations</h3>
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : runs.length === 0 ? (
        <Empty>Aucune simulation n’a encore été exécutée.</Empty>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Dossiers scannés</th><th>Éligibles</th><th>Exclus (legal hold)</th><th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="click" onClick={() => setSelected(r)}>
                <td>{fmtDateTime(r.started_at)}</td>
                <td>{r.total_dossiers_scanned}</td>
                <td>{r.total_eligible}</td>
                <td>{r.total_legal_hold_excluded}</td>
                <td><button className="ghost small" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>Détail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && <DryRunDetailModal runId={selected.id} onClose={() => setSelected(null)} />}
    </section>
  );
}

function DryRunDetailModal({ runId, onClose }) {
  const { data: run, loading } = useAsync(() => api.get(`/api/advisory/retention/purge-runs/${runId}`), [runId]);
  return (
    <Modal title="Résultat de la simulation" onClose={onClose}>
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : run.items.length === 0 ? (
        <Empty>Aucun dossier éligible lors de cette simulation.</Empty>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Foyer</th><th>Session</th><th>Catégorie</th><th>Raison</th><th>Échéance</th><th>Legal hold</th><th>Action envisagée</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((item) => (
              <tr key={item.id}>
                <td>#{item.household_id}</td>
                <td>#{item.session_id}</td>
                <td>{CATEGORY_LABELS[item.category] || item.category}</td>
                <td className="muted">{item.eligibility_reason}</td>
                <td>{item.due_date || '—'}</td>
                <td>{item.legal_hold_blocking ? <Badge value="critical" label="Bloqué" /> : '—'}</td>
                <td>{ACTION_LABELS[item.action_planned] || item.action_planned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="actions">
        <button onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}

function LegalHoldsPanel() {
  const [householdId, setHouseholdId] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const { data: holds, loading, reload } = useAsync(
    () => (householdId ? api.get(`/api/advisory/retention/households/${householdId}/legal-holds`).then((r) => r.legal_holds) : Promise.resolve([])),
    [householdId]
  );

  async function search(value) {
    setQ(value);
    if (value.trim().length < 2) return setResults([]);
    const rows = await api.get(`/api/advisory/households?q=${encodeURIComponent(value)}`);
    setResults(rows.slice(0, 8));
  }

  function pick(h) {
    setHouseholdId(h.id);
    setQ(h.label || h.primary_display_name);
    setResults([]);
  }

  async function submitCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/api/advisory/retention/households/${householdId}/legal-holds`, { reason });
      setReason('');
      setCreateOpen(false);
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function lift(hold) {
    const ended_reason = window.prompt('Motif de levée du legal hold (obligatoire) :');
    if (!ended_reason || !ended_reason.trim()) return;
    try {
      await api.post(`/api/advisory/retention/households/${householdId}/legal-holds/${hold.id}/lift`, { ended_reason });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  const active = holds ? holds.find((h) => h.active) : null;

  return (
    <section className="card">
      <h2>Legal holds</h2>
      <p className="muted">
        Un legal hold bloque toute action de purge pour l’ensemble d’un dossier (foyer), quelle que soit la
        catégorie ou l’échéance calculée. Motif obligatoire à la pose comme à la levée.
      </p>
      {error && <p className="alert error">{error}</p>}

      <Field label="Foyer" full>
        <input value={q} onChange={(e) => search(e.target.value)} placeholder="Rechercher un foyer (nom, principal)…" />
        {results.length > 0 && (
          <table className="data" style={{ marginTop: 8 }}>
            <tbody>
              {results.map((h) => (
                <tr key={h.id} className="click" onClick={() => pick(h)}>
                  <td>{h.label || `Foyer ${h.primary_display_name}`}</td>
                  <td className="muted">{h.primary_display_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Field>

      {householdId && (
        <>
          {!active && (
            <button className="primary" style={{ marginTop: 12 }} onClick={() => setCreateOpen(true)}>
              Poser un legal hold pour ce foyer
            </button>
          )}
          <h3 style={{ marginTop: 24 }}>Historique</h3>
          {loading ? (
            <p className="muted">Chargement…</p>
          ) : holds.length === 0 ? (
            <Empty>Aucun legal hold pour ce foyer.</Empty>
          ) : (
            <table className="data">
              <thead>
                <tr><th>État</th><th>Motif</th><th>Posé le</th><th>Levé le</th><th>Motif de levée</th><th></th></tr>
              </thead>
              <tbody>
                {holds.map((h) => (
                  <tr key={h.id}>
                    <td><Badge value={h.active ? 'critical' : 'archive'} label={h.active ? 'Actif' : 'Levé'} /></td>
                    <td>{h.reason}</td>
                    <td>{fmtDateTime(h.created_at)}</td>
                    <td>{h.ended_at ? fmtDateTime(h.ended_at) : '—'}</td>
                    <td className="muted">{h.ended_reason || '—'}</td>
                    <td>{h.active && <button className="ghost small" onClick={() => lift(h)}>Lever</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {createOpen && (
        <Modal title="Poser un legal hold" onClose={() => setCreateOpen(false)}>
          <form onSubmit={submitCreate}>
            <Field label="Motif (obligatoire)" full>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} required rows={3} autoFocus />
            </Field>
            <div className="actions">
              <button type="button" onClick={() => setCreateOpen(false)}>Annuler</button>
              <button type="submit" className="primary">Poser le hold</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export default function DataRetention() {
  return (
    <div className="page">
      <h1>Rétention des données de diagnostic</h1>
      <p className="alert warn">
        <strong>Politique proposée — validation juridique humaine requise avant activation.</strong> Aucune durée
        indiquée ci-dessous n’est présentée comme juridiquement validée. Voir docs/advisory/DATA_RETENTION.md.
      </p>
      <PoliciesPanel />
      <DryRunPanel />
      <LegalHoldsPanel />
    </div>
  );
}
