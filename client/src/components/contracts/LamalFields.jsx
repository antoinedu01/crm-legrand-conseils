import React from 'react';
import { Field } from '../ui.jsx';
import { LAMAL_CARE_MODELS, LAMAL_DEDUCTIBLES, SWISS_CANTONS } from './lamalPayload.js';

const CARE_MODEL_LABELS = {
  standard: 'Standard',
  medecin_famille: 'Médecin de famille',
  hmo: 'HMO',
  telmed: 'Telmed',
  pharmacie: 'Pharmacie',
  autre: 'Autre',
};

const CANTON_LABELS = {
  AG: 'Argovie', AI: 'Appenzell Rhodes-Intérieures', AR: 'Appenzell Rhodes-Extérieures',
  BE: 'Berne', BL: 'Bâle-Campagne', BS: 'Bâle-Ville', FR: 'Fribourg', GE: 'Genève',
  GL: 'Glaris', GR: 'Grisons', JU: 'Jura', LU: 'Lucerne', NE: 'Neuchâtel',
  NW: 'Nidwald', OW: 'Obwald', SG: 'Saint-Gall', SH: 'Schaffhouse', SO: 'Soleure',
  SZ: 'Schwyz', TG: 'Thurgovie', TI: 'Tessin', UR: 'Uri', VD: 'Vaud', VS: 'Valais',
  ZG: 'Zoug', ZH: 'Zurich',
};

// Composant de présentation pur : reçoit values/onChange/disabled depuis
// ContractForm, ne construit jamais le payload API et ne possède aucune
// copie indépendante des règles métier (listes importées de lamalPayload.js).
export function LamalFields({ values, onChange, disabled }) {
  const set = (key) => (e) => onChange({ ...values, [key]: e.target.value });

  return (
    <div className="form-grid">
      <Field label="Modèle de soins *">
        <select
          required
          value={values.care_model}
          onChange={set('care_model')}
          disabled={disabled}
        >
          {LAMAL_CARE_MODELS.map((m) => <option key={m} value={m}>{CARE_MODEL_LABELS[m] || m}</option>)}
        </select>
      </Field>
      <Field label="Franchise (CHF) *">
        <select
          required
          value={values.deductible}
          onChange={set('deductible')}
          disabled={disabled}
        >
          <option value="">— Choisir —</option>
          {LAMAL_DEDUCTIBLES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Couverture accident">
        <label className="flex" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={values.accident_coverage}
            onChange={(e) => onChange({ ...values, accident_coverage: e.target.checked })}
            disabled={disabled}
          />
          Incluse dans l'assurance LAMal
        </label>
      </Field>
      <Field label="Canton">
        <select value={values.canton} onChange={set('canton')} disabled={disabled}>
          <option value="">— Non renseigné —</option>
          {SWISS_CANTONS.map((c) => <option key={c} value={c}>{c} — {CANTON_LABELS[c]}</option>)}
        </select>
      </Field>
      <Field label="Région tarifaire">
        <input
          value={values.tariff_region}
          onChange={set('tariff_region')}
          maxLength={20}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}
