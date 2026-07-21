import React from 'react';
import { Field } from '../ui.jsx';
import { COMPONENT_TYPES, INDEXATION_TYPES } from './lifePayload.js';

const COMPONENT_TYPE_LABELS = {
  mixte: 'Mixte',
  risque_pur: 'Risque pur',
  capital_differe: 'Capital différé',
  rente: 'Rente',
  unit_linked: 'Lié à des fonds (unit-linked)',
  autre: 'Autre',
};

const INDEXATION_LABELS = {
  aucune: 'Aucune',
  fixe: 'Fixe',
  indice_prix_conso: 'Indice des prix à la consommation',
  autre: 'Autre',
};

// Composant de présentation pur : reçoit values/onChange/disabled depuis
// ContractForm, ne construit jamais le payload API et ne possède aucune
// copie indépendante des règles métier (listes importées de lifePayload.js).
export function LifeFields({ values, onChange, disabled, periodicDurationRequired }) {
  const set = (key) => (e) => onChange({ ...values, [key]: e.target.value });
  const setCheckbox = (key) => (e) => onChange({ ...values, [key]: e.target.checked });

  return (
    <div className="form-grid">
      <Field label="Type de composante">
        <select value={values.component_type} onChange={set('component_type')} disabled={disabled}>
          <option value="">Sélectionner une catégorie</option>
          {COMPONENT_TYPES.map((v) => <option key={v} value={v}>{COMPONENT_TYPE_LABELS[v] || v}</option>)}
        </select>
      </Field>
      <Field label="Capital assuré en cas de décès (CHF)">
        <input
          type="number"
          min="0"
          step="any"
          value={values.insured_death_capital}
          onChange={set('insured_death_capital')}
          disabled={disabled}
        />
      </Field>
      <Field label="Capital assuré en cas d'invalidité (CHF)">
        <input
          type="number"
          min="0"
          step="any"
          value={values.insured_disability_capital}
          onChange={set('insured_disability_capital')}
          disabled={disabled}
        />
      </Field>
      <Field label="Rente assurée (CHF)">
        <input
          type="number"
          min="0"
          step="any"
          value={values.insured_rent}
          onChange={set('insured_rent')}
          disabled={disabled}
        />
      </Field>
      <Field label="Valeur de rachat (CHF)">
        <input
          type="number"
          min="0"
          step="any"
          value={values.surrender_value}
          onChange={set('surrender_value')}
          disabled={disabled}
        />
      </Field>
      <Field label="Type d'indexation">
        <select value={values.indexation_type} onChange={set('indexation_type')} disabled={disabled}>
          {INDEXATION_TYPES.map((v) => <option key={v} value={v}>{INDEXATION_LABELS[v] || v}</option>)}
        </select>
      </Field>
      <Field label={periodicDurationRequired ? 'Durée contractuelle (années) *' : 'Durée contractuelle (années)'}>
        <input
          type="number"
          min="1"
          step="1"
          required={periodicDurationRequired}
          value={values.policy_term_years}
          onChange={set('policy_term_years')}
          disabled={disabled}
        />
        {periodicDurationRequired && (
          <small className="muted">
            Obligatoire pour une prime périodique (non requise et ignorée pour une prime unique).
          </small>
        )}
      </Field>
      <Field label="Libération du paiement des primes">
        <label className="flex" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={Boolean(values.premium_waiver)}
            onChange={setCheckbox('premium_waiver')}
            disabled={disabled}
          />
          Libération en cas d'incapacité de travail
        </label>
      </Field>
      <div className="alert warn full">
        Saisissez uniquement les caractéristiques contractuelles et financières. Aucune donnée médicale ne doit
        être enregistrée ici.
      </div>
    </div>
  );
}
