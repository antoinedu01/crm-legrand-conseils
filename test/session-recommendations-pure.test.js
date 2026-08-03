// Tests des fonctions PURES du formulaire de recommandations humaines
// (Legrand Diagnostic 360, GATE LOT 7B ciblé §9) -- aucun framework de test
// frontend ajouté (confirmé absent aux Lots 0/2/3A/3B/4B/7B) : ces fonctions
// n'ont aucune dépendance React/DOM et sont testées directement avec
// `node --test`, au même titre que le reste de la suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDeclaration, emptyFields, fieldsAreDirty, memberIdsEqual, formIsDirty,
  declarationFromRecommendation, fieldsFromRecommendation, fieldsToBody,
  interpretRecommendationError, CONFLICT_MESSAGE_REC, CONFLICT_MESSAGE_SESSION,
} from '../client/src/pages/sessionRecommendationsPure.js';

// --- emptyDeclaration / emptyFields -------------------------------------

test('emptyDeclaration — état initial explicite "unset", jamais dérivé', () => {
  assert.deepEqual(emptyDeclaration(), { mode: 'unset', text: '', extraText: '' });
});

test('emptyFields — toutes les valeurs narratives vides, les trois déclarations "unset"', () => {
  const f = emptyFields();
  assert.equal(f.title, '');
  assert.equal(f.advisor_rationale, '');
  assert.deepEqual(f.alternatives, emptyDeclaration());
  assert.deepEqual(f.risks, emptyDeclaration());
  assert.deepEqual(f.missingInfo, emptyDeclaration());
});

// --- fieldsAreDirty -------------------------------------------------------

test('fieldsAreDirty — formulaire vide comparé à lui-même : propre', () => {
  assert.equal(fieldsAreDirty(emptyFields(), emptyFields()), false);
});

test('fieldsAreDirty — un seul champ narratif modifié : sale', () => {
  const f = { ...emptyFields(), title: 'Titre QA' };
  assert.equal(fieldsAreDirty(f, emptyFields()), true);
});

test('fieldsAreDirty — modifier une déclaration (mode) rend sale', () => {
  const f = { ...emptyFields(), alternatives: { mode: 'none_identified', text: '', extraText: '' } };
  assert.equal(fieldsAreDirty(f, emptyFields()), true);
});

test('fieldsAreDirty — modifier puis revenir exactement à l\'état initial redevient propre', () => {
  const baseline = emptyFields();
  const modified = { ...baseline, title: 'Temporaire' };
  const reverted = { ...modified, title: baseline.title };
  assert.equal(fieldsAreDirty(reverted, baseline), false);
});

test('fieldsAreDirty — baseline absente retombe sur emptyFields()', () => {
  assert.equal(fieldsAreDirty(emptyFields(), null), false);
  assert.equal(fieldsAreDirty({ ...emptyFields(), title: 'X' }, undefined), true);
});

// --- memberIdsEqual ---------------------------------------------------

test('memberIdsEqual — mêmes ids, même ordre : égaux', () => {
  assert.equal(memberIdsEqual([1, 2, 3], [1, 2, 3]), true);
});

test('memberIdsEqual — mêmes ids, ordre différent : égaux (jamais un sens ordonné)', () => {
  assert.equal(memberIdsEqual([3, 1, 2], [1, 2, 3]), true);
});

test('memberIdsEqual — ensembles de tailles différentes : inégaux', () => {
  assert.equal(memberIdsEqual([1, 2], [1, 2, 3]), false);
});

test('memberIdsEqual — même taille, contenu différent : inégaux', () => {
  assert.equal(memberIdsEqual([1, 2], [1, 3]), false);
});

test('memberIdsEqual — deux tableaux vides : égaux', () => {
  assert.equal(memberIdsEqual([], []), true);
});

test('memberIdsEqual — ids en chaîne vs nombre (venus de sources différentes) : comparés numériquement', () => {
  assert.equal(memberIdsEqual(['1', '2'], [1, 2]), true);
});

// --- formIsDirty (§5 : domaine/portée/membres inclus) ------------------

test('formIsDirty — tout identique à la baseline : propre', () => {
  const baseline = { fields: emptyFields(), domain: 'health', scope: 'household', memberIds: [] };
  assert.equal(formIsDirty({ fields: emptyFields(), domain: 'health', scope: 'household', memberIds: [] }, baseline), false);
});

test('formIsDirty — domaine seul modifié : sale (pas seulement les champs narratifs)', () => {
  const baseline = { fields: emptyFields(), domain: 'health', scope: 'household', memberIds: [] };
  assert.equal(formIsDirty({ fields: emptyFields(), domain: 'life_pension', scope: 'household', memberIds: [] }, baseline), true);
});

test('formIsDirty — portée seule modifiée : sale', () => {
  const baseline = { fields: emptyFields(), domain: 'health', scope: 'household', memberIds: [] };
  assert.equal(formIsDirty({ fields: emptyFields(), domain: 'health', scope: 'member', memberIds: [] }, baseline), true);
});

test('formIsDirty — membres seuls modifiés (ensemble différent) : sale', () => {
  const baseline = { fields: emptyFields(), domain: 'health', scope: 'member', memberIds: [1] };
  assert.equal(formIsDirty({ fields: emptyFields(), domain: 'health', scope: 'member', memberIds: [1, 2] }, baseline), true);
});

test('formIsDirty — membres réordonnés seulement : propre (memberIdsEqual insensible à l\'ordre)', () => {
  const baseline = { fields: emptyFields(), domain: 'health', scope: 'member', memberIds: [1, 2] };
  assert.equal(formIsDirty({ fields: emptyFields(), domain: 'health', scope: 'member', memberIds: [2, 1] }, baseline), false);
});

test('formIsDirty — domaine/portée/membres ET champs modifiés puis TOUS ramenés à l\'état initial : redevient propre', () => {
  const baseline = { fields: emptyFields(), domain: 'health', scope: 'household', memberIds: [] };
  const dirty = { fields: { ...emptyFields(), title: 'Temp' }, domain: 'life_pension', scope: 'member', memberIds: [1, 2] };
  const reverted = { fields: emptyFields(), domain: 'health', scope: 'household', memberIds: [] };
  assert.equal(formIsDirty(dirty, baseline), true);
  assert.equal(formIsDirty(reverted, baseline), false);
});

// --- declarationFromRecommendation / fieldsFromRecommendation ----------

test('declarationFromRecommendation — flag "aucun identifié" prioritaire même si du texte existe (état terminal)', () => {
  assert.deepEqual(declarationFromRecommendation(true, 'texte résiduel', null), { mode: 'none_identified', text: '', extraText: '' });
});

test('declarationFromRecommendation — texte présent sans flag : "described"', () => {
  assert.deepEqual(declarationFromRecommendation(false, 'Un texte', 'Un extra'), { mode: 'described', text: 'Un texte', extraText: 'Un extra' });
});

test('declarationFromRecommendation — ni flag ni texte : "unset" (jamais un choix implicite)', () => {
  assert.deepEqual(declarationFromRecommendation(false, '', null), { mode: 'unset', text: '', extraText: '' });
  assert.deepEqual(declarationFromRecommendation(false, '   ', null), { mode: 'unset', text: '', extraText: '' }, 'texte uniquement composé d\'espaces = absent');
});

test('fieldsFromRecommendation — normalisation formulaire <- recommandation serveur, jamais depuis un finding', () => {
  const rec = {
    title: 'T', advisor_rationale: 'R', summary: 'S', expected_benefits: null, limitations: null,
    warnings: null, reservations: null,
    no_alternatives_identified: false, alternatives_considered: 'Alt', alternative_rejection_reason: 'Motif',
    no_additional_risks_identified: true, risks: 'ignoré car flag actif',
    no_missing_information_known: false, missing_information: null,
  };
  const fields = fieldsFromRecommendation(rec);
  assert.equal(fields.title, 'T');
  assert.equal(fields.expected_benefits, '', 'null -> chaîne vide, jamais "null" littéral');
  assert.deepEqual(fields.alternatives, { mode: 'described', text: 'Alt', extraText: 'Motif' });
  assert.deepEqual(fields.risks, { mode: 'none_identified', text: '', extraText: '' });
  assert.deepEqual(fields.missingInfo, { mode: 'unset', text: '', extraText: '' });
});

// --- fieldsToBody (construction du payload) -----------------------------

test('fieldsToBody — champs narratifs vides omis (undefined), jamais envoyés comme chaîne vide', () => {
  const body = fieldsToBody(emptyFields());
  assert.equal(body.title, '');
  assert.equal(body.advisor_rationale, '');
  assert.equal(body.summary, undefined);
  assert.equal(body.expected_benefits, undefined);
  assert.equal(body.no_alternatives_identified, false);
});

test('fieldsToBody — titre/justification recadrés (trim), jamais d\'espaces parasites envoyés', () => {
  const fields = { ...emptyFields(), title: '  Titre avec espaces  ', advisor_rationale: '  Justification  ' };
  const body = fieldsToBody(fields);
  assert.equal(body.title, 'Titre avec espaces');
  assert.equal(body.advisor_rationale, 'Justification');
});

test('fieldsToBody — déclaration "décrite" transmet texte + motif, flag "aucun identifié" à false', () => {
  const fields = { ...emptyFields(), alternatives: { mode: 'described', text: 'Alt', extraText: 'Motif' } };
  const body = fieldsToBody(fields);
  assert.equal(body.alternatives_considered, 'Alt');
  assert.equal(body.alternative_rejection_reason, 'Motif');
  assert.equal(body.no_alternatives_identified, false);
});

test('fieldsToBody — déclaration "aucun identifié" transmet le flag à true, texte omis', () => {
  const fields = { ...emptyFields(), risks: { mode: 'none_identified', text: '', extraText: '' } };
  const body = fieldsToBody(fields);
  assert.equal(body.no_additional_risks_identified, true);
  assert.equal(body.risks, undefined);
});

test('fieldsToBody <-> fieldsFromRecommendation — aller-retour stable sur un formulaire "décrit" rempli', () => {
  const original = {
    ...emptyFields(), title: 'T', advisor_rationale: 'R', summary: 'S',
    alternatives: { mode: 'described', text: 'Alt', extraText: 'Rejet' },
  };
  const body = fieldsToBody(original);
  const rehydrated = fieldsFromRecommendation({
    title: body.title, advisor_rationale: body.advisor_rationale, summary: body.summary,
    expected_benefits: null, limitations: null, warnings: null, reservations: null,
    no_alternatives_identified: body.no_alternatives_identified,
    alternatives_considered: body.alternatives_considered, alternative_rejection_reason: body.alternative_rejection_reason,
    no_additional_risks_identified: false, risks: null,
    no_missing_information_known: false, missing_information: null,
  });
  assert.equal(rehydrated.title, original.title);
  assert.deepEqual(rehydrated.alternatives, original.alternatives);
});

// --- interpretRecommendationError (§3 : codes machine, jamais le texte) -

test('interpretRecommendationError — RECOMMENDATION_REVISION_CONFLICT -> message de conflit de recommandation', () => {
  assert.equal(interpretRecommendationError({ data: { code: 'RECOMMENDATION_REVISION_CONFLICT' }, message: 'texte français quelconque' }), CONFLICT_MESSAGE_REC);
});

test('interpretRecommendationError — SESSION_REVISION_CONFLICT -> message de conflit de session, distinct du précédent', () => {
  const msg = interpretRecommendationError({ data: { code: 'SESSION_REVISION_CONFLICT' }, message: 'autre texte' });
  assert.equal(msg, CONFLICT_MESSAGE_SESSION);
  assert.notEqual(msg, CONFLICT_MESSAGE_REC);
});

test('interpretRecommendationError — code inconnu ou absent -> repli sur err.message, jamais un message générique masquant l\'erreur réelle', () => {
  assert.equal(interpretRecommendationError({ data: { code: 'HOUSEHOLD_ARCHIVED' }, message: 'Ce foyer est archivé.' }), 'Ce foyer est archivé.');
  assert.equal(interpretRecommendationError({ message: 'Erreur réseau.' }), 'Erreur réseau.');
  assert.equal(interpretRecommendationError({ data: {}, message: 'Sans code.' }), 'Sans code.');
});

test('interpretRecommendationError — ne dépend JAMAIS du contenu de err.message pour distinguer les codes (seul err.data.code compte)', () => {
  // Un message français qui mentionnerait accidentellement un autre
  // conflit ne doit jamais influencer la décision -- seule `data.code` fait
  // foi (GATE LOT 7B ciblé §3 : "jamais une interprétation basée sur le
  // texte français").
  const trickyMessage = 'La session a changé depuis la dernière consultation, mais ceci est en réalité un conflit de recommandation.';
  assert.equal(interpretRecommendationError({ data: { code: 'RECOMMENDATION_REVISION_CONFLICT' }, message: trickyMessage }), CONFLICT_MESSAGE_REC);
});
