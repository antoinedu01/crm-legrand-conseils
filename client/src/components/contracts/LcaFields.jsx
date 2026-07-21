import React from 'react';
import { Field } from '../ui.jsx';
import { UNDERWRITING_STATUSES, RESERVATION_STATUSES, EXCLUSION_STATUSES } from './lcaPayload.js';

const UNDERWRITING_LABELS = {
  non_requis: 'Non requis',
  questionnaire_transmis: 'Questionnaire transmis',
  decision_attendue: 'Décision attendue',
  acceptee: 'Acceptée',
  acceptee_avec_reserve: 'Acceptée avec réserve',
  refusee: 'Refusée',
};

const RESERVATION_LABELS = {
  aucune: 'Aucune',
  en_cours: 'En cours',
  active: 'Active',
  levee: 'Levée',
};

const EXCLUSION_LABELS = {
  aucune: 'Aucune',
  presentes: 'Présentes',
};

// Composant de présentation pur : reçoit values/onChange/disabled depuis
// ContractForm, ne construit jamais le payload API et ne possède aucune
// copie indépendante des règles métier (listes importées de lcaPayload.js).
export function LcaFields({ values, onChange, disabled }) {
  const set = (key) => (e) => onChange({ ...values, [key]: e.target.value });

  return (
    <div className="form-grid">
      <Field label="Statut de souscription">
        <select value={values.underwriting_status} onChange={set('underwriting_status')} disabled={disabled}>
          {UNDERWRITING_STATUSES.map((s) => <option key={s} value={s}>{UNDERWRITING_LABELS[s] || s}</option>)}
        </select>
      </Field>
      <Field label="Délai d'attente (jours)">
        <input
          type="number"
          min="0"
          step="1"
          value={values.waiting_period_days}
          onChange={set('waiting_period_days')}
          disabled={disabled}
        />
      </Field>
      <Field label="Statut de réserve administrative">
        <select
          value={values.administrative_reservation_status}
          onChange={set('administrative_reservation_status')}
          disabled={disabled}
        >
          {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_LABELS[s] || s}</option>)}
        </select>
      </Field>
      <Field label="Statut d'exclusion">
        <select value={values.exclusions_status} onChange={set('exclusions_status')} disabled={disabled}>
          {EXCLUSION_STATUSES.map((s) => <option key={s} value={s}>{EXCLUSION_LABELS[s] || s}</option>)}
        </select>
      </Field>
      <div className="alert warn full">
        Ne saisissez aucune donnée médicale. Indiquez uniquement le statut administratif ou contractuel
        communiqué par l'assureur.
      </div>
      <Field label="Notes sur la réserve" full>
        <textarea
          rows={2}
          maxLength={200}
          value={values.reservation_notes}
          onChange={set('reservation_notes')}
          placeholder="p. ex. Réserve communiquée par l'assureur"
          disabled={disabled}
        />
        <small className="muted">{(values.reservation_notes || '').length}/200 caractères — statut administratif uniquement</small>
      </Field>
      <Field label="Notes sur les exclusions" full>
        <textarea
          rows={2}
          maxLength={200}
          value={values.exclusions_notes}
          onChange={set('exclusions_notes')}
          placeholder="p. ex. Exclusion mentionnée dans la décision de l'assureur"
          disabled={disabled}
        />
        <small className="muted">{(values.exclusions_notes || '').length}/200 caractères — statut administratif uniquement</small>
      </Field>
    </div>
  );
}
