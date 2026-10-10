import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Field } from '../ui.jsx';
import { fmtCHF, fmtDate } from '../../labels.js';
import {
  computeConventionCommission, describeRate, describeClawback, clawbackPeriodEnd,
} from '../../../../shared/conventionRules.js';

// Sélection de la ligne de barème de la convention pour un contrat, avec
// l'estimation de la commission et la période de reprise. Le calcul vient du
// module partagé shared/conventionRules.js — exactement celui du serveur.
// Ne s'affiche que si la compagnie a une convention couvrant la branche.
// `onChange(rateId, rate)` reçoit l'identifiant (chaîne) et la ligne choisie.
export function ConventionRateField({ companyId, branch, value, onChange, contract, isEdit, disabled }) {
  const [rates, setRates] = useState([]);

  useEffect(() => {
    // Jamais les lignes de la compagnie ou de la branche précédente pendant
    // le chargement : elles pourraient être choisies par erreur.
    setRates([]);
    if (!companyId || !branch) return undefined;
    const controller = new AbortController();
    api
      .get(`/api/conventions/rates?company_id=${companyId}&branch=${branch}${isEdit ? '&include_inactive=1' : ''}`, controller.signal)
      .then(setRates)
      .catch((err) => { if (err.name !== 'AbortError') setRates([]); });
    return () => controller.abort();
  }, [companyId, branch, isEdit]);

  const isUsable = (r) => r.active && r.convention_status === 'signee' && r.convention_in_force !== false;

  // À la création, une seule ligne possible : elle est proposée d'office.
  useEffect(() => {
    if (isEdit || value) return;
    const usable = rates.filter(isUsable);
    if (usable.length === 1) onChange(String(usable[0].id), usable[0]);
  }, [rates, isEdit]);

  if (rates.length === 0) return null;
  const selected = rates.find((r) => String(r.id) === String(value)) || null;
  const estimate = selected ? computeConventionCommission(selected, contract) : null;
  const periodEnd = selected ? clawbackPeriodEnd(selected, contract.start_date) : null;

  return (
    <>
      <Field label="Barème de la convention" full>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value, rates.find((r) => String(r.id) === e.target.value) || null)}
          disabled={disabled}
        >
          <option value="">— Aucune ligne (saisie manuelle de la commission) —</option>
          {rates.map((r) => {
            const usable = isUsable(r);
            const why = !r.active ? 'ligne inactive' : r.convention_status !== 'signee' ? 'convention non signée' : 'convention échue';
            return (
              <option key={r.id} value={r.id} disabled={!usable && String(r.id) !== String(value)}>
                {r.label} — {describeRate(r)}{usable ? '' : ` (${why})`}
              </option>
            );
          })}
        </select>
      </Field>
      {selected && (
        <div className={`alert ${estimate.amount != null ? 'ok' : 'warn'} full`} style={{ marginBottom: 0 }}>
          {estimate.amount != null ? (
            <>
              Commission d’acquisition selon la convention : <strong>{fmtCHF(estimate.amount)}</strong>
              {selected.is_estimate && <> (estimation — base à confirmer)</>}
              <div className="muted" style={{ fontSize: 12 }}>{estimate.formula}</div>
              {isEdit ? (
                <div>En modification, aucune commission n’est créée ni recalculée : ajustez-la au besoin depuis la page Commissions.</div>
              ) : (
                <div>Elle sera créée automatiquement, en montant fixe, avec le contrat.</div>
              )}
            </>
          ) : (
            <>{estimate.formula}</>
          )}
          <div style={{ marginTop: 8 }}>
            <strong>Reprise :</strong> {describeClawback(selected)}
            {periodEnd && <> — jusqu’au <strong>{fmtDate(periodEnd)}</strong></>}
            {selected.clawback_notes && <div className="muted" style={{ fontSize: 12 }}>{selected.clawback_notes}</div>}
          </div>
          {selected.conditions && (
            <div style={{ marginTop: 8 }}><strong>Conditions :</strong> {selected.conditions}</div>
          )}
          {selected.obligations && (
            <div style={{ marginTop: 8 }}><strong>À joindre / à respecter :</strong> {selected.obligations}</div>
          )}
        </div>
      )}
    </>
  );
}
