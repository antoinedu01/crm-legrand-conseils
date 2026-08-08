import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, Modal, Field, Badge, Empty } from '../components/ui.jsx';
import { BRANCHES, COMMISSION_STATUS, COMMISSION_TYPES, COMMISSION_MODES, fmtCHF, fmtDate } from '../labels.js';
import { FIXED_ONLY_BRANCHES } from '../components/contracts/fixedCommissionBranches.js';

function defaultModeForBranch(branch) {
  return FIXED_ONLY_BRANCHES.includes(branch) ? 'fixed_amount' : 'percentage';
}

function allowedModesForBranch(branch) {
  return FIXED_ONLY_BRANCHES.includes(branch)
    ? ['fixed_amount', 'manual_adjustment']
    : ['fixed_amount', 'percentage', 'manual_adjustment'];
}

// Formulaire de création/modification d'une ligne de commission — mode
// pourcentage/montant fixe/ajustement manuel, plusieurs lignes possibles
// par contrat, montant reçu saisi séparément du montant attendu.
function CommissionForm({ initial, contracts, onSaved, onClose }) {
  const isEdit = !!initial?.id;
  const initialContract = contracts.find((c) => c.id === initial?.contract_id);
  const [form, setForm] = useState({
    contract_id: initial?.contract_id || '',
    type: initial?.type || 'acquisition',
    commission_mode: initial?.commission_mode || (initialContract ? defaultModeForBranch(initialContract.branch) : ''),
    expected_amount_chf: initial?.expected_amount_chf ?? '',
    received_amount_chf: initial?.received_amount_chf ?? '',
    expected_payment_date: initial?.expected_payment_date || '',
    received_payment_date: initial?.received_payment_date || '',
    status: initial?.status || 'expected',
    product_name: initial?.product_name || '',
    insured_label: initial?.insured_label || '',
    insurer_statement_reference: initial?.insurer_statement_reference || '',
    accounting_period: initial?.accounting_period || '',
    label: initial?.label || '',
    notes: initial?.notes || '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const selectedContract = contracts.find((c) => String(c.id) === String(form.contract_id));
  const branch = selectedContract?.branch;
  const allowedModes = branch ? allowedModesForBranch(branch) : ['fixed_amount', 'percentage', 'manual_adjustment'];

  // Une fois qu'un montant a été (partiellement) reçu, que la ligne est une
  // reprise, ou qu'elle a déjà été reprise, le montant attendu, le mode et
  // le type deviennent immuables côté backend (server/routes/commissions.js)
  // — reflété ici pour ne jamais proposer une modification qui serait de
  // toute façon rejetée.
  const financialsLocked = isEdit && (
    ['received', 'partially_received', 'reversed'].includes(initial.status) ||
    initial.reversal_of_commission_id != null
  );

  function pickContract(e) {
    const contract_id = e.target.value;
    const contract = contracts.find((c) => String(c.id) === contract_id);
    setForm((f) => ({
      ...f,
      contract_id,
      commission_mode: contract ? defaultModeForBranch(contract.branch) : f.commission_mode,
    }));
  }

  const rate = form.type === 'recurrente' ? selectedContract?.rec_commission_rate : selectedContract?.acq_commission_rate;
  const premium = Number(selectedContract?.annual_premium) || 0;
  const percentagePreview = form.commission_mode === 'percentage' && premium > 0 && Number(rate) > 0
    ? Math.round(premium * Number(rate)) / 100
    : null;

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        type: form.type,
        commission_mode: form.commission_mode,
        expected_amount_chf: form.expected_amount_chf === '' ? null : Number(form.expected_amount_chf),
        received_amount_chf: form.received_amount_chf === '' ? undefined : Number(form.received_amount_chf),
        expected_payment_date: form.expected_payment_date || null,
        received_payment_date: form.received_payment_date || null,
        status: form.status,
        product_name: form.product_name || null,
        insured_label: form.insured_label || null,
        insurer_statement_reference: form.insurer_statement_reference || null,
        accounting_period: form.accounting_period || null,
        label: form.label || null,
        notes: form.notes || null,
      };
      if (isEdit) {
        await api.put(`/api/commissions/${initial.id}`, payload);
      } else {
        if (!form.contract_id) throw new Error('Le contrat est requis.');
        await api.post('/api/commissions', { contract_id: form.contract_id, ...payload });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? `Modifier la commission #${initial.id}` : 'Nouvelle commission'} onClose={submitting ? () => {} : onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {financialsLocked && (
        <div className="alert warn">
          Cette commission a déjà été (partiellement) reçue{initial.reversal_of_commission_id ? ' ou constitue une reprise' : ''}.
          Le montant attendu, le mode et le type ne sont plus modifiables — utilisez une reprise pour corriger un montant déjà reçu.
        </div>
      )}
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Contrat">
            <select required value={form.contract_id} onChange={pickContract} disabled={isEdit}>
              <option value="">— Choisir —</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client_name} — {BRANCHES[c.branch] || c.branch}{c.policy_number ? ` (${c.policy_number})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={set('type')} disabled={financialsLocked}>
              {Object.entries(COMMISSION_TYPES).filter(([k]) => k !== 'reprise').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Mode de commission">
            <select value={form.commission_mode} onChange={set('commission_mode')} disabled={financialsLocked || !form.contract_id}>
              <option value="">— Choisir —</option>
              {allowedModes.map((m) => <option key={m} value={m}>{COMMISSION_MODES[m]}</option>)}
            </select>
            {branch && FIXED_ONLY_BRANCHES.includes(branch) && (
              <small className="muted">
                LAMal/LCA : aucun calcul automatique fondé sur la prime — montant fixe fourni par la compagnie.
              </small>
            )}
          </Field>
          {form.commission_mode === 'percentage' && (
            <Field label="Base de calcul" full>
              <div className="muted" style={{ fontSize: 13 }}>
                Prime annuelle {fmtCHF(premium)} × taux {rate != null ? `${rate}%` : '—'}
                {percentagePreview != null && (
                  <>
                    {' '}= <strong>{fmtCHF(percentagePreview)}</strong>{' '}
                    <button
                      type="button"
                      className="small"
                      onClick={() => setForm((f) => ({ ...f, expected_amount_chf: percentagePreview }))}
                    >
                      Utiliser ce montant
                    </button>
                  </>
                )}
              </div>
            </Field>
          )}
          <Field label="Montant attendu (CHF)">
            <input
              type="number" min="0" step="0.01" required
              value={form.expected_amount_chf} onChange={set('expected_amount_chf')} disabled={financialsLocked}
            />
          </Field>
          <Field label="Montant reçu (CHF)">
            <input type="number" min="0" step="0.01" value={form.received_amount_chf} onChange={set('received_amount_chf')} />
          </Field>
          <Field label="Statut">
            <select value={form.status} onChange={set('status')}>
              {Object.entries(COMMISSION_STATUS).filter(([k]) => k !== 'reversed').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Échéance attendue">
            <input type="date" value={form.expected_payment_date} onChange={set('expected_payment_date')} />
          </Field>
          <Field label="Date de réception">
            <input type="date" value={form.received_payment_date} onChange={set('received_payment_date')} />
          </Field>
          <Field label="Produit / référence">
            <input value={form.product_name} onChange={set('product_name')} placeholder="p. ex. Global Smart, Mundo, hospitalisation…" />
          </Field>
          <Field label="Assuré concerné (si différent du client titulaire)">
            <input value={form.insured_label} onChange={set('insured_label')} />
          </Field>
          <Field label="Référence décompte assureur">
            <input value={form.insurer_statement_reference} onChange={set('insurer_statement_reference')} />
          </Field>
          <Field label="Période comptable">
            <input value={form.accounting_period} onChange={set('accounting_period')} placeholder="p. ex. 2026-Q1" />
          </Field>
          <Field label="Libellé">
            <input value={form.label} onChange={set('label')} />
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

// Reprise/annulation (§5) : ne modifie ni ne supprime jamais la commission
// d'origine — crée une ligne négative liée, l'originale passe à 'reversed'.
function ReverseForm({ commission, onSaved, onClose }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/api/commissions/${commission.id}/reverse`, {
        reversal_amount_chf: amount === '' ? null : -Math.abs(Number(amount)),
        expected_payment_date: date || null,
        notes: notes || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Reprise de la commission #${commission.id}`} onClose={submitting ? () => {} : onClose}>
      {error && <div className="alert error">{error}</div>}
      <p className="muted">
        Montant initialement attendu : <strong>{fmtCHF(commission.expected_amount_chf)}</strong> · reçu à ce jour :{' '}
        <strong>{fmtCHF(commission.received_amount_chf)}</strong>. Une nouvelle ligne négative sera créée et liée à cette
        commission ; celle-ci passera au statut « Reprise » sans être ni modifiée ni supprimée.
      </p>
      <form onSubmit={submit}>
        <Field label="Montant repris (CHF)">
          <input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Échéance de la reprise">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="actions">
          <button type="button" onClick={onClose} disabled={submitting}>Annuler</button>
          <button className="primary" disabled={submitting}>{submitting ? 'Enregistrement…' : 'Confirmer la reprise'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Commissions() {
  const currentYear = new Date().getFullYear();
  const [status, setStatus] = useState('');
  const [year, setYear] = useState(String(currentYear));
  const [companyId, setCompanyId] = useState('');
  const [product, setProduct] = useState('');
  const [message, setMessage] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [formState, setFormState] = useState(null);
  const [reverseTarget, setReverseTarget] = useState(null);

  const { data, loading, error, reload } = useAsync(
    () => api.get(`/api/commissions?status=${status}&year=${year}&company_id=${companyId}&product=${encodeURIComponent(product)}`),
    [status, year, companyId, product]
  );

  useEffect(() => {
    api.get('/api/companies').then((rows) => setCompanies(rows.filter((c) => c.active)));
    api.get('/api/contracts').then(setContracts);
  }, []);

  // Solde restant = attendu net − reçu net (§7), à l'exclusion des lignes
  // annulées (jamais dues) — les lignes de reprise contribuent négativement
  // aux deux sommes par simple addition, sans cas particulier.
  const totals = (data || []).reduce(
    (acc, c) => {
      if (c.status !== 'cancelled') {
        acc.expected += c.expected_amount_chf;
        acc.received += c.received_amount_chf;
      }
      return acc;
    },
    { expected: 0, received: 0 }
  );
  const balance = totals.expected - totals.received;

  async function markReceived(c) {
    await api.put(`/api/commissions/${c.id}`, { status: 'received' });
    reload();
  }
  async function cancel(c) {
    if (!window.confirm('Annuler cette commission ?')) return;
    await api.put(`/api/commissions/${c.id}`, { status: 'cancelled' });
    reload();
  }
  async function generateRecurring() {
    const res = await api.post('/api/commissions/generate-recurring', { year: Number(year) || currentYear });
    setMessage(
      res.created > 0
        ? `${res.created} commission(s) de portefeuille générée(s) pour ${res.year}.`
        : `Aucune commission à générer pour ${res.year} — tout est déjà à jour.`
    );
    reload();
  }
  function closeForms() {
    setFormState(null);
    setReverseTarget(null);
  }
  function afterSave() {
    closeForms();
    reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Commissions</h1>
          <div className="sub">
            Attendu : <strong>{fmtCHF(totals.expected)}</strong> · Reçu : <strong>{fmtCHF(totals.received)}</strong>
            {' '}· Solde : <strong>{fmtCHF(balance)}</strong>
            {year && <> · année {year}</>}
          </div>
        </div>
        <div>
          <button onClick={() => setFormState({ mode: 'create' })}>+ Nouvelle commission</button>{' '}
          <button onClick={generateRecurring}>⟳ Générer les commissions récurrentes</button>
        </div>
      </div>
      {message && <div className="alert ok">{message}</div>}
      <div className="toolbar">
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes les années</option>
          {[0, 1, 2, 3].map((i) => (
            <option key={i} value={currentYear - i}>{currentYear - i}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(COMMISSION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Toutes les compagnies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="Produit…" value={product} onChange={(e) => setProduct(e.target.value)} />
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : data.length === 0 ? (
          <Empty>Aucune commission pour ces critères.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Client</th><th>Compagnie</th><th>Contrat</th><th>Produit</th><th>Type</th><th>Mode</th>
                <th>Échéance</th><th className="num">Attendu</th><th className="num">Reçu</th>
                <th className="num">Solde</th><th>Statut</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.client_id}`}>{c.client_name}</Link></td>
                  <td>{c.company_name}</td>
                  <td>
                    {BRANCHES[c.branch] || c.branch}
                    {c.policy_number && <div className="muted" style={{ fontSize: 12 }}>{c.policy_number}</div>}
                  </td>
                  <td>
                    {c.product_name || c.contract_product_name || '—'}
                    {c.insured_label && <div className="muted" style={{ fontSize: 12 }}>{c.insured_label}</div>}
                  </td>
                  <td>
                    {COMMISSION_TYPES[c.type] || c.type}
                    {c.label && <div className="muted" style={{ fontSize: 12 }}>{c.label}</div>}
                    {c.reversal_of_commission_id != null && (
                      <div className="muted" style={{ fontSize: 12 }}>reprise de #{c.reversal_of_commission_id}</div>
                    )}
                  </td>
                  <td>{COMMISSION_MODES[c.commission_mode] || c.commission_mode}</td>
                  <td>
                    {fmtDate(c.expected_payment_date)}
                    {c.received_payment_date && <div className="muted" style={{ fontSize: 12 }}>reçue le {fmtDate(c.received_payment_date)}</div>}
                  </td>
                  <td className="num"><strong>{fmtCHF(c.expected_amount_chf)}</strong></td>
                  <td className="num">{fmtCHF(c.received_amount_chf)}</td>
                  <td className="num">{fmtCHF(c.expected_amount_chf - c.received_amount_chf)}</td>
                  <td><Badge value={c.status} label={COMMISSION_STATUS[c.status]} /></td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {(c.status === 'expected' || c.status === 'disputed') && (
                      <>
                        <button className="small primary" onClick={() => markReceived(c)}>Reçue ✓</button>{' '}
                        <button className="small" onClick={() => cancel(c)}>Annuler</button>{' '}
                      </>
                    )}
                    {(c.status === 'received' || c.status === 'partially_received') && (
                      <button className="small" onClick={() => setReverseTarget(c)}>Reprise</button>
                    )}{' '}
                    <button className="small" onClick={() => setFormState({ mode: 'edit', commission: c })}>Modifier</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted mt" style={{ fontSize: 12 }}>
        Transparence de la rémunération : selon l’art. 45b LSA, le client doit être informé de la
        rémunération perçue de tiers. Les montants ci-dessus sont exportables par client depuis son dossier.
      </p>
      {formState && (
        <CommissionForm
          initial={formState.mode === 'edit' ? formState.commission : null}
          contracts={contracts}
          onSaved={afterSave}
          onClose={closeForms}
        />
      )}
      {reverseTarget && <ReverseForm commission={reverseTarget} onSaved={afterSave} onClose={closeForms} />}
    </>
  );
}
