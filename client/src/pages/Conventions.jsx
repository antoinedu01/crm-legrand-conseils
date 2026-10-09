import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import {
  BRANCHES, CONVENTION_STATUS, CLIENT_FOLLOWUP, RATE_BASES, CLAWBACK_MODES, fmtDate,
} from '../labels.js';
import { describeRate, describeClawback } from '../../../shared/conventionRules.js';

const EMPTY_CONVENTION = {
  company_id: '', title: '', counterparty: '', intermediary_code: '', status: 'signee',
  signed_date: '', effective_date: '', end_date: '', scope: '', termination_notice: '', payment_terms: '',
  statement_objection_days: '', client_followup: 'non_precise', obligations: '', restrictions: '',
  missing_documents: '', document_location: '', notes: '',
};

const EMPTY_RATE = {
  branch: 'lamal', label: '', insurer_entity: '', basis: 'fixe', value: '', multiply_by_years: false,
  max_years: '', valuation_pct: '', cap_chf: '', is_estimate: false, rec_rate: '', rec_conditions: '',
  clawback_mode: 'inconnu', clawback_steps_text: '', clawback_months: '', clawback_notes: '',
  conditions: '', source_ref: '', active: true, sort: 0,
};

const VALUE_LABELS = {
  fixe: 'Montant (CHF)',
  mois_prime: 'Nombre de primes mensuelles',
  pct_prime_annuelle: 'Taux (%)',
  pct_production: 'Taux (%) sur la production',
  aucune: 'Valeur (facultatif)',
  a_confirmer: 'Valeur connue (facultatif)',
};

const numberOrNull = (v) => (v === '' || v == null ? null : Number(v));

// « 12:100; 24:50 » ↔ [{ months: 12, pct: 100 }, { months: 24, pct: 50 }]
function stepsToText(steps) {
  return (steps || []).map((s) => `${s.months}:${s.pct}`).join('; ');
}
function textToSteps(text) {
  return String(text || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [months, pct] = part.split(':').map((x) => Number(String(x).trim().replace(',', '.')));
      return { months, pct };
    });
}

function ConventionForm({ initial, companies, onSaved, onClose }) {
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY_CONVENTION, ...initial };
    for (const k of Object.keys(EMPTY_CONVENTION)) if (base[k] == null) base[k] = '';
    return base;
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const payload = { ...form, company_id: Number(form.company_id), statement_objection_days: numberOrNull(form.statement_objection_days) };
    for (const k of Object.keys(EMPTY_CONVENTION)) if (payload[k] === '') payload[k] = null;
    try {
      if (initial?.id) await api.put(`/api/conventions/${initial.id}`, payload);
      else await api.post('/api/conventions', payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={initial?.id ? 'Modifier la convention' : 'Nouvelle convention'} onClose={submitting ? () => {} : onClose} wide>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Compagnie">
            <select required value={form.company_id} onChange={set('company_id')}>
              <option value="">— Choisir —</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (inactive)'}</option>)}
            </select>
          </Field>
          <Field label="Statut">
            <select value={form.status} onChange={set('status')}>
              {Object.entries(CONVENTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Titre" full>
            <input required value={form.title} onChange={set('title')} placeholder="p. ex. Convention de collaboration + annexe Vie" />
          </Field>
          <Field label="Cocontractant (signataire côté compagnie)">
            <input value={form.counterparty} onChange={set('counterparty')} />
          </Field>
          <Field label="N° d’intermédiaire / code de production">
            <input value={form.intermediary_code} onChange={set('intermediary_code')} />
          </Field>
          <Field label="Date de signature">
            <input type="date" value={form.signed_date} onChange={set('signed_date')} />
          </Field>
          <Field label="Entrée en vigueur">
            <input type="date" value={form.effective_date} onChange={set('effective_date')} />
          </Field>
          <Field label="Fin (si résiliée)">
            <input type="date" value={form.end_date} onChange={set('end_date')} />
          </Field>
          <Field label="Suivi du client après conclusion">
            <select value={form.client_followup} onChange={set('client_followup')}>
              {Object.entries(CLIENT_FOLLOWUP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Délai de contestation des décomptes (jours)">
            <input type="number" min="0" max="365" step="1" value={form.statement_objection_days} onChange={set('statement_objection_days')} />
          </Field>
          <Field label="Emplacement de l’original">
            <input value={form.document_location} onChange={set('document_location')} placeholder="p. ex. kDrive / Conventions / …" />
          </Field>
          <Field label="Champ d’application (produits, sociétés)" full>
            <textarea rows={2} value={form.scope} onChange={set('scope')} />
          </Field>
          <Field label="Résiliation" full>
            <textarea rows={2} value={form.termination_notice} onChange={set('termination_notice')} />
          </Field>
          <Field label="Paiement des commissions (rythme, retenues, compensation)" full>
            <textarea rows={2} value={form.payment_terms} onChange={set('payment_terms')} />
          </Field>
          <Field label="Pièces et obligations à chaque proposition" full>
            <textarea rows={3} value={form.obligations} onChange={set('obligations')} />
          </Field>
          <Field label="Interdits et restrictions (publicité, logo, rabais, données…)" full>
            <textarea rows={3} value={form.restrictions} onChange={set('restrictions')} />
          </Field>
          <Field label="Pièces manquantes à demander" full>
            <textarea rows={2} value={form.missing_documents} onChange={set('missing_documents')} />
          </Field>
          <Field label="Notes" full>
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose} disabled={submitting}>Annuler</button>
          <button className="primary" disabled={submitting}>{submitting ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RateForm({ conventionId, initial, onSaved, onClose }) {
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY_RATE, ...initial };
    for (const k of Object.keys(EMPTY_RATE)) if (base[k] == null) base[k] = EMPTY_RATE[k];
    base.clawback_steps_text = stepsToText(initial?.clawback_steps);
    return base;
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const locked = (initial?.contracts_count || 0) > 0;
  const preview = {
    ...form,
    value: numberOrNull(form.value),
    clawback_steps: textToSteps(form.clawback_steps_text),
    clawback_months: numberOrNull(form.clawback_months),
  };

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const payload = {
      branch: form.branch,
      label: form.label,
      insurer_entity: form.insurer_entity || null,
      basis: form.basis,
      value: numberOrNull(form.value),
      multiply_by_years: form.basis === 'pct_prime_annuelle' && Boolean(form.multiply_by_years),
      max_years: form.basis === 'pct_production' ? numberOrNull(form.max_years) : null,
      valuation_pct: form.basis === 'pct_production' ? numberOrNull(form.valuation_pct) : null,
      cap_chf: numberOrNull(form.cap_chf),
      is_estimate: Boolean(form.is_estimate),
      rec_rate: numberOrNull(form.rec_rate),
      rec_conditions: form.rec_conditions || null,
      clawback_mode: form.clawback_mode,
      clawback_steps: form.clawback_mode === 'paliers' ? textToSteps(form.clawback_steps_text) : null,
      clawback_months: form.clawback_mode === 'prorata' ? numberOrNull(form.clawback_months) : null,
      clawback_notes: form.clawback_notes || null,
      conditions: form.conditions || null,
      source_ref: form.source_ref || null,
      active: Boolean(form.active),
      sort: Number(form.sort) || 0,
    };
    try {
      if (initial?.id) await api.put(`/api/conventions/rates/${initial.id}`, payload);
      else await api.post(`/api/conventions/${conventionId}/rates`, payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={initial?.id ? 'Modifier la ligne de barème' : 'Nouvelle ligne de barème'} onClose={submitting ? () => {} : onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {locked && (
        <div className="alert warn">
          Cette ligne a déjà servi à {initial.contracts_count} contrat(s) : la base de calcul, les montants et la règle de
          reprise sont figés. Pour un nouveau barème, désactivez-la et créez une nouvelle ligne.
        </div>
      )}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Branche">
            <select value={form.branch} onChange={set('branch')} disabled={locked}>
              {Object.entries(BRANCHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Société porteuse du risque">
            <input value={form.insurer_entity} onChange={set('insurer_entity')} />
          </Field>
          <Field label="Produit / catégorie" full>
            <input required value={form.label} onChange={set('label')} placeholder="p. ex. Complémentaire hospitalisation — contrat 3 ou 5 ans" />
          </Field>
          <Field label="Base de calcul">
            <select value={form.basis} onChange={set('basis')} disabled={locked}>
              {Object.entries(RATE_BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={VALUE_LABELS[form.basis]}>
            <input type="number" min="0" step="0.001" value={form.value} onChange={set('value')} disabled={locked} />
          </Field>
          {form.basis === 'pct_prime_annuelle' && (
            <label className="check full">
              <input type="checkbox" checked={Boolean(form.multiply_by_years)} onChange={set('multiply_by_years')} disabled={locked} />
              Taux annuel multiplié par le nombre d’années entières de durée du contrat
            </label>
          )}
          {form.basis === 'pct_production' && (
            <>
              <Field label="Durée maximale prise en compte (ans)">
                <input type="number" min="1" step="1" value={form.max_years} onChange={set('max_years')} disabled={locked} />
              </Field>
              <Field label="Coefficient de valorisation (%)">
                <input type="number" min="0" step="0.01" value={form.valuation_pct} onChange={set('valuation_pct')} disabled={locked} placeholder="100" />
              </Field>
            </>
          )}
          <Field label="Plafond de commission (CHF, facultatif)">
            <input type="number" min="0" step="0.01" value={form.cap_chf} onChange={set('cap_chf')} disabled={locked} />
          </Field>
          <Field label="Commission récurrente (% de la prime annuelle, facultatif)">
            <input type="number" min="0" step="0.01" value={form.rec_rate} onChange={set('rec_rate')} />
          </Field>
          <label className="check full">
            <input type="checkbox" checked={Boolean(form.is_estimate)} onChange={set('is_estimate')} />
            Estimation : la base exacte reste à confirmer avec la compagnie
          </label>
          <Field label="Reprise (extourne)">
            <select value={form.clawback_mode} onChange={set('clawback_mode')} disabled={locked}>
              {Object.entries(CLAWBACK_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {form.clawback_mode === 'paliers' && (
            <Field label="Paliers « mois:% repris » (p. ex. 12:100; 24:50)">
              <input value={form.clawback_steps_text} onChange={set('clawback_steps_text')} disabled={locked} />
            </Field>
          )}
          {form.clawback_mode === 'prorata' && (
            <Field label="Durée de la période de reprise (mois)">
              <input type="number" min="1" step="1" value={form.clawback_months} onChange={set('clawback_months')} disabled={locked} />
            </Field>
          )}
          <div className="full muted" style={{ fontSize: 12 }}>
            Calcul : {describeRate(preview)} · Reprise : {describeClawback(preview)}
          </div>
          <Field label="Précisions sur la reprise" full>
            <input value={form.clawback_notes} onChange={set('clawback_notes')} placeholder="p. ex. pas de reprise en cas de décès" />
          </Field>
          <Field label="Conditions (âge maximal, pièces, exclusions…)" full>
            <textarea rows={2} value={form.conditions} onChange={set('conditions')} />
          </Field>
          <Field label="Commission récurrente — conditions" full>
            <input value={form.rec_conditions} onChange={set('rec_conditions')} />
          </Field>
          <Field label="Référence dans la convention">
            <input value={form.source_ref} onChange={set('source_ref')} placeholder="p. ex. Annexe A §4.2" />
          </Field>
          <Field label="Ordre d’affichage">
            <input type="number" step="1" value={form.sort} onChange={set('sort')} />
          </Field>
          <label className="check full">
            <input type="checkbox" checked={Boolean(form.active)} onChange={set('active')} />
            Ligne active (proposée dans les nouveaux contrats)
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose} disabled={submitting}>Annuler</button>
          <button className="primary" disabled={submitting}>{submitting ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
}

const ACTION_LABELS = {
  create: 'création', update: 'mise à jour', unchanged: 'inchangée', replace: 'remplacée (ancienne ligne conservée, désactivée)',
};

function ImportModal({ onDone, onClose }) {
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [deactivateOthers, setDeactivateOthers] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function readFile(e) {
    const file = e.target.files?.[0];
    setError(null);
    setPreview(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = JSON.parse(await file.text());
      setData(parsed);
      setDeactivateOthers(Boolean(parsed.deactivate_companies_without_convention));
    } catch {
      setData(null);
      setError('Ce fichier n’est pas un fichier JSON valide.');
    }
  }

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setBusy(true);
    api.post('/api/conventions/import', { data, dry_run: true, deactivate_others: deactivateOthers })
      .then((res) => { if (!cancelled) { setPreview(res); setError(null); } })
      .catch((err) => { if (!cancelled) { setPreview(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [data, deactivateOthers]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/conventions/import', { data, dry_run: false, deactivate_others: deactivateOthers });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Importer des conventions" onClose={busy ? () => {} : onClose} wide>
      <p className="muted">
        Fichier « crm-legrand-conventions » (JSON). Rien n’est enregistré avant votre confirmation : un aperçu des
        changements s’affiche d’abord. Les lignes déjà utilisées par des contrats ne sont jamais réécrites.
      </p>
      {error && <div className="alert error">{error}</div>}
      <Field label="Fichier">
        <input type="file" accept="application/json,.json" onChange={readFile} disabled={busy} />
      </Field>
      {data && (
        <label className="check mt">
          <input type="checkbox" checked={deactivateOthers} onChange={(e) => setDeactivateOthers(e.target.checked)} disabled={busy} />
          Désactiver les compagnies qui n’ont pas de convention dans ce fichier (leurs contrats restent intacts)
        </label>
      )}
      {preview && (
        <div className="card mt">
          <h3>Aperçu — {fileName}</h3>
          <ul style={{ margin: '0 0 0 18px' }}>
            {preview.conventions.map((c) => (
              <li key={`${c.company}-${c.title}`}>
                <strong>{c.company}</strong> — {c.title} ({CONVENTION_STATUS[c.status] || c.status}) : {ACTION_LABELS[c.action]},{' '}
                {c.rates.length} ligne(s) de barème
                {c.rates.some((r) => r.action === 'replace') && <> dont {c.rates.filter((r) => r.action === 'replace').length} remplacée(s)</>}
                {c.retired.length > 0 && <>, {c.retired.length} ligne(s) désactivée(s)</>}
              </li>
            ))}
          </ul>
          {preview.companies.some((c) => c.action === 'create') && (
            <p>Compagnie(s) créée(s) : {preview.companies.filter((c) => c.action === 'create').map((c) => c.name).join(', ')}</p>
          )}
          {preview.deactivate.length > 0 && (
            <p>Compagnie(s) désactivée(s) : {preview.deactivate.join(', ')}</p>
          )}
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="primary" onClick={apply} disabled={busy || !preview}>
          {busy ? 'Patientez…' : 'Appliquer l’import'}
        </button>
      </div>
    </Modal>
  );
}

function TextBlock({ label, children }) {
  if (!children) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <strong>{label} :</strong> <span style={{ whiteSpace: 'pre-line' }}>{children}</span>
    </div>
  );
}

function ConventionCard({ conv, onEdit, onDelete, onAddRate, onEditRate, onDeleteRate }) {
  const [open, setOpen] = useState(false);
  const activeRates = conv.rates.filter((r) => r.active);
  const inactiveRates = conv.rates.filter((r) => !r.active);
  return (
    <div className="card mt">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{conv.company_name} <Badge value={conv.status} label={CONVENTION_STATUS[conv.status]} /></h2>
          <div className="sub">{conv.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {conv.intermediary_code && <>N° / code : {conv.intermediary_code} · </>}
            {conv.effective_date && <>en vigueur dès le {fmtDate(conv.effective_date)} · </>}
            Suivi du client : {CLIENT_FOLLOWUP[conv.client_followup] || '—'}
          </div>
        </div>
        <div style={{ whiteSpace: 'nowrap' }}>
          <button className="small" onClick={() => setOpen(!open)}>{open ? 'Masquer les conditions' : 'Conditions'}</button>{' '}
          <button className="small" onClick={onEdit}>Modifier</button>{' '}
          <button className="small danger" onClick={onDelete}>✕</button>
        </div>
      </div>
      {conv.missing_documents && (
        <div className="alert warn"><strong>Pièces manquantes :</strong> {conv.missing_documents}</div>
      )}
      {open && (
        <div className="mt" style={{ fontSize: 13 }}>
          <TextBlock label="Cocontractant">{conv.counterparty}</TextBlock>
          <TextBlock label="Champ d’application">{conv.scope}</TextBlock>
          <TextBlock label="Pièces et obligations">{conv.obligations}</TextBlock>
          <TextBlock label="Interdits et restrictions">{conv.restrictions}</TextBlock>
          <TextBlock label="Paiement">{conv.payment_terms}</TextBlock>
          {conv.statement_objection_days != null && (
            <TextBlock label="Contestation des décomptes">{`${conv.statement_objection_days} jours`}</TextBlock>
          )}
          <TextBlock label="Résiliation">{conv.termination_notice}</TextBlock>
          <TextBlock label="Original">{conv.document_location}</TextBlock>
          <TextBlock label="Notes">{conv.notes}</TextBlock>
        </div>
      )}
      <table className="data mt">
        <thead>
          <tr><th>Branche</th><th>Produit</th><th>Commission d’acquisition</th><th>Reprise</th><th className="num">Contrats</th><th></th></tr>
        </thead>
        <tbody>
          {[...activeRates, ...inactiveRates].map((r) => (
            <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
              <td>{BRANCHES[r.branch] || r.branch}</td>
              <td>
                {r.label}
                {r.insurer_entity && <div className="muted" style={{ fontSize: 12 }}>{r.insurer_entity}</div>}
                {r.source_ref && <div className="muted" style={{ fontSize: 12 }}>{r.source_ref}</div>}
                {!r.active && <div className="muted" style={{ fontSize: 12 }}>ligne inactive</div>}
              </td>
              <td>
                {describeRate(r)}
                {r.is_estimate && <div className="muted" style={{ fontSize: 12 }}>estimation — base à confirmer</div>}
                {r.cap_chf != null && <div className="muted" style={{ fontSize: 12 }}>plafond CHF {r.cap_chf}</div>}
              </td>
              <td>{describeClawback(r)}</td>
              <td className="num">{r.contracts_count}</td>
              <td className="right" style={{ whiteSpace: 'nowrap' }}>
                <button className="small" onClick={() => onEditRate(r)}>Modifier</button>{' '}
                <button className="small danger" onClick={() => onDeleteRate(r)}>✕</button>
              </td>
            </tr>
          ))}
          {conv.rates.length === 0 && (
            <tr><td colSpan={6} className="muted">Aucune ligne de barème.</td></tr>
          )}
        </tbody>
      </table>
      <div className="mt">
        <button className="small" onClick={onAddRate}>+ Ligne de barème</button>
      </div>
    </div>
  );
}

export default function Conventions() {
  const { data, loading, error, reload } = useAsync(() => api.get('/api/conventions'), []);
  const [companies, setCompanies] = useState([]);
  const [editingConvention, setEditingConvention] = useState(null);
  const [rateTarget, setRateTarget] = useState(null); // { conventionId, rate? }
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState(null);

  function loadCompanies() {
    api.get('/api/companies').then(setCompanies).catch(() => setCompanies([]));
  }
  useEffect(loadCompanies, []);

  async function removeConvention(conv) {
    if (!window.confirm(`Supprimer la convention « ${conv.title} » (${conv.company_name}) et ses lignes de barème ?`)) return;
    try {
      await api.del(`/api/conventions/${conv.id}`);
      reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function removeRate(rate) {
    if (!window.confirm(`Supprimer la ligne « ${rate.label} » ?`)) return;
    try {
      await api.del(`/api/conventions/rates/${rate.id}`);
      reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conventions de courtage</h1>
          <div className="sub">Barèmes, reprises et obligations de chaque compagnie — données confidentielles, jamais à publier</div>
        </div>
        <div>
          <button onClick={() => setImporting(true)}>Importer un fichier</button>{' '}
          <button className="primary" onClick={() => setEditingConvention({})}>+ Nouvelle convention</button>
        </div>
      </div>
      {message && <div className="alert ok">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : data.length === 0 ? (
        <div className="card"><Empty>Aucune convention enregistrée. Importez le fichier de vos conventions ou créez-en une.</Empty></div>
      ) : (
        data.map((conv) => (
          <ConventionCard
            key={conv.id}
            conv={conv}
            onEdit={() => setEditingConvention(conv)}
            onDelete={() => removeConvention(conv)}
            onAddRate={() => setRateTarget({ conventionId: conv.id })}
            onEditRate={(rate) => setRateTarget({ conventionId: conv.id, rate })}
            onDeleteRate={removeRate}
          />
        ))
      )}
      {editingConvention !== null && (
        <ConventionForm
          initial={editingConvention.id ? editingConvention : undefined}
          companies={companies}
          onClose={() => setEditingConvention(null)}
          onSaved={() => { setEditingConvention(null); reload(); }}
        />
      )}
      {rateTarget && (
        <RateForm
          conventionId={rateTarget.conventionId}
          initial={rateTarget.rate}
          onClose={() => setRateTarget(null)}
          onSaved={() => { setRateTarget(null); reload(); }}
        />
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            setMessage('Conventions importées. Vérifiez les lignes marquées « à confirmer » ou « estimation ».');
            reload();
            loadCompanies();
          }}
        />
      )}
    </>
  );
}
