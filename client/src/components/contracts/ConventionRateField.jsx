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
export function ConventionRateField({ companyId, branch, value, onChange, contract, isEdit, disabled }) {
  const [rates, setRates] = useState([]);

  useEffect(() => {
    if (!companyId || !branch) {
      setRates([]);
      return undefined;
    }
    const controller = new AbortController();
    api
      .get(`/api/conventions/rates?company_id=${companyId}&branch=${branch}${isEdit ? '&include_inactive=1' : ''}`, controller.signal)
      .then(setRates)
      .catch((err) => { if (err.name !== 'AbortError') setRates([]); });
    return () => controller.abort();
  }, [companyId, branch, isEdit]);

  // À la création, une seule ligne possible : elle est proposée d'office.
  useEffect(() => {
    if (isEdit || value) return;
    const active = rates.filter((r) => r.active);
    if (active.length === 1) onChange(String(active[0].id));
  }, [rates, isEdit]);

  if (rates.length === 0) return null;
  const selected = rates.find((r) => String(r.id) === String(value)) || null;
  const estimate = selected ? computeConventionCommission(selected, contract) : null;
  const periodEnd = selected ? clawbackPeriodEnd(selected, contract.start_date) : null;

  return (
    <>
      <Field label="Barème de la convention" full>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">— Aucune ligne (saisie manuelle de la commission) —</option>
          {rates.map((r) => {
            const usable = r.active && r.convention_status === 'signee';
            return (
              <option key={r.id} value={r.id} disabled={!usable && String(r.id) !== String(value)}>
                {r.label} — {describeRate(r)}{usable ? '' : ' (ligne inactive)'}
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
              {!isEdit && <div>Elle sera créée automatiquement, en montant fixe, avec le contrat.</div>}
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
