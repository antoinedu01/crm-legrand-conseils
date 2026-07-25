#!/usr/bin/env node
'use strict';

/**
 * Contrôle local du registre éditorial central marketing-ai/content-calendar/registre-editorial-central.csv
 *
 * Portée stricte de ce script :
 *  - lecture seule sur les fichiers marketing-ai/** ;
 *  - aucune écriture, aucune modification de fichier ;
 *  - aucun accès réseau, aucun service externe ;
 *  - aucun accès au CRM (server/, client/, data/) ;
 *  - aucune dépendance externe : uniquement les modules natifs de Node.js
 *    (fs, path), aucune installation de package requise.
 *
 * Usage : node marketing-ai/scripts/validate-editorial-registry.js
 * Code de sortie : 0 si aucune erreur, 1 si au moins une erreur détectée.
 * Les avertissements n'affectent pas le code de sortie.
 */

// Écrit en ESM (import/export) car package.json du dépôt déclare
// "type": "module" — package.json n'est jamais modifié par cette mission,
// le script s'adapte donc au module system existant plutôt que l'inverse.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_PATH = path.join(__dirname, '..', 'content-calendar', 'registre-editorial-central.csv');

const REQUIRED_COLUMNS = [
  'content_id', 'titre', 'theme', 'silo', 'persona', 'canal', 'compte',
  'format', 'objectif', 'etape_funnel', 'date_prevue', 'date_publication',
  'responsable', 'agent_producteur', 'url_cible', 'cta',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'statut_redaction', 'statut_sources', 'statut_seo', 'statut_conformite',
  'validation_humaine', 'statut_publication',
  'impressions', 'clics', 'visites_site', 'leads', 'rendez_vous', 'contrats',
  'ca_attribue', 'notes',
];

const PERFORMANCE_COLUMNS = [
  'impressions', 'clics', 'visites_site', 'leads', 'rendez_vous', 'contrats', 'ca_attribue',
];

// Valeurs autorisées, documentées dans registre-editorial-central.md § 2.
// La comparaison est faite en minuscules et sans espaces de bord (trim), pour
// tolérer les variations mineures de casse sans être laxiste sur le fond.
const ALLOWED_VALUES = {
  statut_redaction: [
    'idée', 'brief à créer', 'brief prêt', 'sources partiellement validées',
    'rédaction en cours', 'brouillon prêt', 'corrections requises',
  ],
  statut_sources: ['non fait', 'en cours', 'validé avec réserves', 'validé', 'sans objet'],
  statut_seo: ['non fait', 'en cours', 'validé', 'sans objet'],
  statut_conformite: [
    'non fait', 'à corriger', 'prêt pour validation humaine', 'validé', 'sans objet',
  ],
  validation_humaine: ['oui', 'non'],
  statut_publication: ['non créé', 'brouillon', 'programmé', 'publié', 'dépublié', 'non publié'],
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UTM_RE = /^[a-z0-9-]+$/;

function stripQuotes(field) {
  const f = field.trim();
  if (f.startsWith('"') && f.endsWith('"')) {
    return f.slice(1, -1).replace(/""/g, '"');
  }
  return f;
}

// Analyseur CSV minimal (délimiteur ';', support des champs entre guillemets
// avec ';' ou guillemets doublés à l'intérieur). Aucune dépendance externe.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      if (text[i - 1] !== '\r' || field !== '' || row.length > 0) {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
      }
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function normalizeStatus(value) {
  // Retire les précisions entre parenthèses pour la comparaison à la liste
  // fermée (ex. "Validé avec réserves (libellé à vérifier)" -> "validé avec réserves").
  return value.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function main() {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`Erreur : fichier introuvable : ${REGISTRY_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    console.error('Erreur : le registre est vide.');
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  // 1. Présence de toutes les colonnes obligatoires.
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) {
      errors.push(`Colonne obligatoire manquante dans l'en-tête : "${col}"`);
    }
  }

  const idx = {};
  header.forEach((name, i) => { idx[name] = i; });

  const get = (row, colName) => {
    const i = idx[colName];
    if (i === undefined || i >= row.length) return '';
    return (row[i] || '').trim();
  };

  // 2. Unicité de content_id.
  const seenIds = new Map();

  dataRows.forEach((row, rowNum) => {
    const lineLabel = `ligne ${rowNum + 2}`; // +2 : 1-based + en-tête
    const contentId = get(row, 'content_id');

    if (!contentId) {
      errors.push(`${lineLabel} : content_id vide.`);
      return;
    }

    if (seenIds.has(contentId)) {
      errors.push(`content_id dupliqué : "${contentId}" (lignes ${seenIds.get(contentId)} et ${rowNum + 2}).`);
    } else {
      seenIds.set(contentId, rowNum + 2);
    }

    // 3. Valeurs de statuts autorisées.
    for (const col of Object.keys(ALLOWED_VALUES)) {
      const value = get(row, col);
      if (!value) continue; // vide autorisé (ex. non encore renseigné)
      const normalized = normalizeStatus(value);
      const allowed = ALLOWED_VALUES[col].includes(normalized);
      if (!allowed) {
        errors.push(`${lineLabel} (${contentId}) : valeur non autorisée pour "${col}" : "${value}".`);
      }
    }

    // 4. Dates au format ISO lorsque renseignées.
    for (const col of ['date_prevue', 'date_publication']) {
      const value = get(row, col);
      if (!value) continue;
      if (!ISO_DATE_RE.test(value)) {
        errors.push(`${lineLabel} (${contentId}) : "${col}" n'est pas au format ISO AAAA-MM-JJ : "${value}".`);
        continue;
      }
      const d = new Date(value + 'T00:00:00Z');
      const [y, m, day] = value.split('-').map(Number);
      const roundTrips = d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
      if (!roundTrips) {
        errors.push(`${lineLabel} (${contentId}) : "${col}" n'est pas une date calendaire valide : "${value}".`);
      }
    }

    // 5. Interdiction statut_publication = publié si validation_humaine n'est pas positive.
    const statutPublication = normalizeStatus(get(row, 'statut_publication'));
    const validationHumaine = normalizeStatus(get(row, 'validation_humaine'));
    if (statutPublication === 'publié' && validationHumaine !== 'oui') {
      errors.push(`${lineLabel} (${contentId}) : statut_publication="publié" alors que validation_humaine n'est pas "Oui".`);
    }

    // 6. Interdiction d'une date de publication si le statut n'est pas publié/programmé.
    const datePublication = get(row, 'date_publication');
    if (datePublication && !['publié', 'programmé'].includes(statutPublication)) {
      errors.push(`${lineLabel} (${contentId}) : date_publication renseignée ("${datePublication}") alors que statut_publication="${get(row, 'statut_publication')}" (doit être "Programmé" ou "Publié").`);
    }

    // 7. Cohérence minimale des UTM : si un paramètre UTM est renseigné, il
    // doit respecter la convention (minuscules, chiffres, tirets uniquement -
    // voir analytics/convention-utm.md), et les 4 paramètres doivent être
    // tous renseignés ou tous vides (pas de lien à moitié taggé).
    const utmCols = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
    const utmValues = utmCols.map((c) => get(row, c));
    const utmFilledCount = utmValues.filter((v) => v !== '').length;
    if (utmFilledCount > 0 && utmFilledCount < utmCols.length) {
      warnings.push(`${lineLabel} (${contentId}) : paramètres UTM partiellement renseignés (${utmFilledCount}/4) — un lien ne devrait pas être taggé partiellement.`);
    }
    utmValues.forEach((v, i) => {
      if (v && !UTM_RE.test(v)) {
        errors.push(`${lineLabel} (${contentId}) : "${utmCols[i]}" ne respecte pas la convention UTM (minuscules, chiffres, tirets uniquement) : "${v}".`);
      }
    });

    // 8. Absence de données personnelles / chiffres inventés dans les
    // colonnes de performance. Aucune ligne du registre ne correspond à un
    // contenu publié à ce jour : ces colonnes doivent donc être vides. Toute
    // valeur non vide est signalée comme une donnée potentiellement
    // inventée ou une fuite de donnée personnelle, à vérifier humainement.
    for (const col of PERFORMANCE_COLUMNS) {
      const value = get(row, col);
      if (value === '') continue;
      if (!/^\d+(\.\d+)?$/.test(value)) {
        errors.push(`${lineLabel} (${contentId}) : "${col}" contient une valeur non numérique ("${value}") — risque de donnée personnelle ou de texte libre dans une colonne de performance.`);
      } else if (statutPublication !== 'publié') {
        errors.push(`${lineLabel} (${contentId}) : "${col}"="${value}" renseigné alors que statut_publication="${get(row, 'statut_publication')}" (aucune donnée de performance réelle ne devrait exister pour un contenu non publié — chiffre potentiellement inventé).`);
      }
    }
  });

  // Rapport.
  console.log(`Registre analysé : ${REGISTRY_PATH}`);
  console.log(`Lignes de données : ${dataRows.length}`);
  console.log('');

  if (warnings.length > 0) {
    console.log(`Avertissements (${warnings.length}) :`);
    warnings.forEach((w) => console.log(`  - ${w}`));
    console.log('');
  }

  if (errors.length > 0) {
    console.log(`Erreurs (${errors.length}) :`);
    errors.forEach((e) => console.log(`  - ${e}`));
    console.log('');
    console.log('Résultat : ÉCHEC');
    process.exit(1);
  }

  console.log('Résultat : OK — aucune erreur détectée.');
  process.exit(0);
}

main();
