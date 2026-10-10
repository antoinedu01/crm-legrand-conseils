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
// Séparateur : point-virgule ou retour à la ligne — la virgule reste
// disponible comme séparateur décimal (« 12:33,5 »).
function stepsToText(steps) {
  return (steps || []).map((s) => `${s.months}:${s.pct}`).join('; ');
}
// Retourne null si un palier est illisible (jamais d'interprétation
// approximative : « 6:80,12:50 » n'est pas un palier de 80,12 %).
function textToSteps(text) {
  const steps = [];
  for (const part of String(text || '').split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const pieces = part.split(':').map((x) => x.trim());
    if (pieces.length !== 2 || pieces.some((x) => !/^\d+([.,]\d+)?$/.test(x))) return null;
    const [months, pct] = pieces.map((x) => Number(x.replace(',', '.')));
    steps.push({ months, pct });
  }
  return steps;
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
  const usage = initial?.usage_count ?? initial?.contracts_count ?? 0;
  const locked = usage > 0;
  const preview = {
    ...form,
    value: numberOrNull(form.value),
    clawback_steps: textToSteps(form.clawback_steps_text) || [],
    clawback_months: numberOrNull(form.clawback_months),
  };

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const steps = form.clawback_mode === 'paliers' ? textToSteps(form.clawback_steps_text) : null;
    if (form.clawback_mode === 'paliers' && steps == null) {
      setError('Paliers de reprise illisibles : écrivez « mois:% repris » séparés par « ; », p. ex. 12:100; 24:50.');
      return;
    }
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
      clawback_steps: steps,
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
          Cette ligne a déjà servi ({initial.contracts_count || 0} contrat(s), {initial.commissions_count || 0} commission(s)) :
          la base de calcul, les montants et la règle de reprise sont figés. Pour un nouveau barème, désactivez-la et
          créez une nouvelle ligne.
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
            <input type="number" min="0" step="any" value={form.value} onChange={set('value')} disabled={locked} />
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
                <input type="number" min="0" step="any" value={form.valuation_pct} onChange={set('valuation_pct')} disabled={locked} placeholder="100" />
              </Field>
            </>
          )}
          <Field label="Plafond de commission (CHF, facultatif)">
            <input type="number" min="0" step="any" value={form.cap_chf} onChange={set('cap_chf')} disabled={locked} />
          </Field>
          <Field label="Commission récurrente (% de la prime annuelle, facultatif)">
            <input type="number" min="0" step="any" value={form.rec_rate} onChange={set('rec_rate')} />
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
            <Field label="Paliers « mois:% repris », séparés par « ; » (p. ex. 12:100; 24:50)">
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
  create: 'création',
  update: 'mise à jour',
  unchanged: 'inchangée',
  replace: 'remplacée (ancienne ligne conservée, désactivée)',
};

function ImportConventionPreview({ conv }) {
  const byAction = (action) => conv.rates.filter((r) => r.action === action);
  const parts = [];
  for (const [action, label] of [['create', 'nouvelle(s)'], ['update', 'mise(s) à jour'], ['replace', 'remplacée(s)'], ['unchanged', 'inchangée(s)']]) {
    const n = byAction(action).length;
    if (n) parts.push(`${n} ${label}`);
  }
  const reactivated = conv.rates.filter((r) => r.reactivated);
  const inactiveKept = conv.rates.filter((r) => r.inactive_kept);
  return (
    <li style={{ marginBottom: 6 }}>
      <strong>{conv.company}</strong> — {conv.title} ({CONVENTION_STATUS[conv.status] || conv.status}) :{' '}
      {ACTION_LABELS[conv.action] || conv.action}
      {conv.changed.length > 0 && <span className="muted"> ({conv.changed.join(', ')})</span>}
      <div className="muted" style={{ fontSize: 12 }}>
        {conv.rates_provided
          ? <>Lignes de barème : {parts.length ? parts.join(', ') : 'aucune'}</>
          : <>Aucune ligne de barème dans le fichier : le barème enregistré reste inchangé.</>}
      </div>
      {byAction('replace').length > 0 && (
        <div style={{ fontSize: 12 }}>
          Remplacées car déjà utilisées : {byAction('replace').map((r) => r.label).join(', ')}
        </div>
      )}
      {reactivated.length > 0 && (
        <div style={{ fontSize: 12 }}>Réactivées (demandé par le fichier) : {reactivated.map((r) => r.label).join(', ')}</div>
      )}
      {inactiveKept.length > 0 && (
        <div style={{ fontSize: 12 }}>
          Désactivées dans le CRM, laissées inactives : {inactiveKept.map((r) => r.label).join(', ')}
          {' '}(indiquez « "active": true » dans le fichier pour les réactiver)
        </div>
      )}
      {conv.retired.length > 0 && (
        <div style={{ fontSize: 12 }}>Absentes du fichier, désactivées : {conv.retired.join(', ')}</div>
      )}
      {conv.kept.length > 0 && (
        <div style={{ fontSize: 12 }}>Absentes du fichier, conservées telles quelles : {conv.kept.join(', ')}</div>
      )}
    </li>
  );
}

function ImportModal({ onDone, onClose }) {
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [deactivateOthers, setDeactivateOthers] = useState(false);
  const [retireMissing, setRetireMissing] = useState(false);
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
      setDeactivateOthers(parsed?.deactivate_companies_without_convention === true);
      setRetireMissing(parsed?.retire_missing_rates === true);
    } catch {
      setData(null);
      setError('Ce fichier n’est pas un fichier JSON valide.');
    }
  }

  useEffect(() => {
    if (!data) return undefined;
    let cancelled = false;
    setBusy(true);
    setPreview(null);
    api.post('/api/conventions/import', { data, dry_run: true, deactivate_others: deactivateOthers, retire_missing: retireMissing })
      .then((res) => { if (!cancelled) { setPreview(res); setError(null); } })
      .catch((err) => { if (!cancelled) { setPreview(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [data, deactivateOthers, retireMissing]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/api/conventions/import', {
        data, dry_run: false, deactivate_others: deactivateOthers, retire_missing: retireMissing,
      });
      onDone(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const created = preview?.companies.filter((c) => c.action === 'create') || [];
  const withHomonyms = preview?.companies.filter((c) => c.homonyms?.length) || [];
  const updated = preview?.companies.filter((c) => c.changed.length > 0) || [];
  const reactivated = preview?.companies.filter((c) => c.reactivate) || [];
  const inactiveKept = preview?.companies.filter((c) => c.inactive_kept) || [];

  return (
    <Modal title="Importer des conventions" onClose={busy ? () => {} : onClose} wide>
      <p className="muted">
        Fichier « crm-legrand-conventions » (JSON). Rien n’est enregistré avant votre confirmation : un aperçu des
        changements s’affiche d’abord. Seules les informations présentes dans le fichier sont écrites ; ce que vous avez
        complété dans le CRM est conservé, et les lignes déjà utilisées par des contrats ne sont jamais réécrites.
      </p>
      {error && <div className="alert error">{error}</div>}
      <Field label="Fichier">
        <input type="file" accept="application/json,.json" onChange={readFile} disabled={busy} />
      </Field>
      {data && (
        <>
          <label className="check mt">
            <input type="checkbox" checked={deactivateOthers} onChange={(e) => setDeactivateOthers(e.target.checked)} disabled={busy} />
            Désactiver les compagnies qui n’ont pas de convention dans ce fichier (leurs contrats et commissions restent
            intacts ; une compagnie qui a une convention signée dans le CRM n’est jamais désactivée)
          </label>
          <label className="check">
            <input type="checkbox" checked={retireMissing} onChange={(e) => setRetireMissing(e.target.checked)} disabled={busy} />
            Désactiver les lignes de barème absentes du fichier (sinon elles restent telles quelles)
          </label>
        </>
      )}
      {preview && (
        <div className="card mt">
          <h3>Aperçu — {fileName}</h3>
          <ul style={{ margin: '0 0 0 18px' }}>
            {preview.conventions.map((c) => <ImportConventionPreview key={`${c.company}-${c.title}`} conv={c} />)}
          </ul>
          {created.length > 0 && (
            <p>
              Compagnie(s) créée(s) :{' '}
              {created.map((c) => `${c.name}${c.created_inactive ? ' (inactive : aucune convention signée en vigueur)' : ''}`).join(', ')}
            </p>
          )}
          {withHomonyms.length > 0 && (
            <p>
              Autres fiches du CRM portant un nom ou un alias du fichier, non utilisées :{' '}
              {withHomonyms.map((c) => `${c.homonyms.join(', ')} (convention rattachée à ${c.name})`).join(' ; ')}
            </p>
          )}
          {updated.length > 0 && (
            <p>Compagnie(s) mise(s) à jour : {updated.map((c) => `${c.name} (${c.changed.join(', ')})`).join(' ; ')}</p>
          )}
          {reactivated.length > 0 && <p>Compagnie(s) réactivée(s) (convention signée) : {reactivated.map((c) => c.name).join(', ')}</p>}
          {inactiveKept.length > 0 && (
            <p>Compagnie(s) inactive(s) laissée(s) inactive(s) (convention non signée) : {inactiveKept.map((c) => c.name).join(', ')}</p>
          )}
          {preview.deactivate.length > 0 && <p>Compagnie(s) désactivée(s) : {preview.deactivate.join(', ')}</p>}
          {preview.deactivate_skipped.length > 0 && (
            <p>Conservée(s) active(s) car une convention signée est enregistrée dans le CRM : {preview.deactivate_skipped.join(', ')}</p>
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
          <h2 style={{ margin: 0 }}>
            {conv.company_name} <Badge value={conv.status} label={CONVENTION_STATUS[conv.status]} />
            {conv.in_force === false && <> <Badge value="resiliee" label="Échue" /></>}
          </h2>
          <div className="sub">{conv.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {conv.intermediary_code && <>N° / code : {conv.intermediary_code} · </>}
            {conv.effective_date && <>en vigueur dès le {fmtDate(conv.effective_date)} · </>}
            {conv.end_date && <>{conv.in_force === false ? 'a pris fin le' : 'prend fin le'} {fmtDate(conv.end_date)} · </>}
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
      ) : !Array.isArray(data) ? null : data.length === 0 ? (
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
          onDone={(res) => {
            setImporting(false);
            const s = res?.summary;
            setMessage(s
              ? `Import appliqué : ${s.conventions_created} convention(s) créée(s), ${s.conventions_updated} mise(s) à jour ; `
                + `lignes de barème : ${s.rates_created} créée(s), ${s.rates_updated} mise(s) à jour, ${s.rates_replaced} remplacée(s), `
                + `${s.rates_retired} désactivée(s) ; compagnies : ${s.companies_created} créée(s), ${s.companies_deactivated} désactivée(s). `
                + 'Vérifiez les lignes « à confirmer » ou « estimation ».'
              : 'Conventions importées. Vérifiez les lignes marquées « à confirmer » ou « estimation ».');
            reload();
            loadCompanies();
          }}
        />
      )}
    </>
  );
}
