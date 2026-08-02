import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Sélecteur d'éléments focusables standard (piège de focus) -- exclut les
// éléments désactivés et les éléments retirés explicitement de l'ordre de
// tabulation (`tabindex="-1"`), inclut ceux ayant un `tabindex` positif ou
// nul explicite.
const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableElements(container) {
  if (!container) return [];
  // `offsetParent !== null` écarte les éléments masqués (`display: none`,
  // conteneur non affiché) sans dépendre d'une bibliothèque tierce.
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null);
}

// Masquage du fond applicatif + verrouillage du défilement pendant qu'une
// modale est ouverte (correctif exigé avant commit, GATE LOT 7B) --
// compteur PARTAGÉ au niveau du module (pas par instance de `Modal`) : deux
// modales ne s'ouvrent normalement jamais simultanément dans cette
// application, mais une confirmation (`ConfirmModal`, elle-même construite
// sur `Modal`) peut apparaître PENDANT qu'une autre modale est déjà montée
// (ex. confirmation de perte de saisie du garde de navigation partagé
// pendant qu'une modale de validation reste affichée) -- seul le compteur
// revenant à zéro retire le masquage/déverrouille, jamais un simple
// démontage isolé qui laisserait le fond exposé alors qu'une autre modale
// est encore ouverte.
let openModalCount = 0;
let previousBodyOverflow = '';

// Pile PARTAGÉE des modales ouvertes, dans l'ordre de montage (correctif
// GATE LOT 7B, correction round, défaut certain relevé par la revue finale
// `client-meeting-ux`) : chaque `Modal` posait son propre écouteur
// `keydown` sur `window` sans notion de modale « du dessus ». Quand une
// confirmation (`ConfirmModal` du garde de navigation) s'ouvrait PAR-DESSUS
// une modale déjà affichée (ex. « Écarter »/« Retirer » interrompue par la
// barre latérale pendant que le formulaire était sale), une seule pression
// d'Échap fermait les DEUX modales simultanément -- l'écouteur du dessous
// se déclenchait aussi, détruisant son état local (motif déjà tapé) sans
// confirmation dédiée. Seule la modale au sommet de cette pile répond
// désormais à Échap/Tab.
let modalStack = [];

function acquireBackgroundLock() {
  openModalCount += 1;
  if (openModalCount === 1) {
    const root = document.getElementById('root');
    if (root) {
      // `inert` (norme HTML, tous navigateurs à jour) : retire le fond du
      // parcours clavier ET du parcours des technologies d'assistance en
      // une seule fois. `aria-hidden` ajouté en complément explicite pour
      // les technologies d'assistance qui ne traiteraient pas encore
      // `inert` de la même façon (appartenance ARIA explicite, jamais
      // supposée implicite). Appliqué à `#root` -- jamais à un ancêtre de
      // la modale elle-même, puisque la modale est désormais rendue via
      // portail directement dans `document.body`, en dehors de `#root` :
      // aucun risque de masquer la modale en masquant le reste de l'app.
      root.setAttribute('inert', '');
      root.setAttribute('aria-hidden', 'true');
    }
    // Verrouillage du défilement du document -- capture la valeur inline
    // précédente (le plus souvent vide, la feuille de style gouvernant
    // alors le défilement) pour la restaurer EXACTEMENT, jamais une chaîne
    // vide supposée par défaut.
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function releaseBackgroundLock() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    const root = document.getElementById('root');
    if (root) {
      root.removeAttribute('inert');
      root.removeAttribute('aria-hidden');
    }
    document.body.style.overflow = previousBodyOverflow;
  }
}

// Modale accessible (GATE LOT 7B ciblé §4 -- composant PARTAGÉ, modifié ici
// car l'amélioration est purement additive et bénéficie à tous les usages
// existants, jamais un changement de comportement métier) :
// - `role="dialog"`/`aria-modal="true"` (déjà présents) + `aria-labelledby`
//   (titre) + `aria-describedby` optionnel (`describedById`, fourni par
//   l'appelant quand un texte descriptif existe réellement).
// - Focus initial posé sur le premier élément focusable de la modale (la
//   modale elle-même en repli si aucun -- ne laisse jamais le focus sur
//   l'élément déclencheur, resté « derrière »).
// - Piège de focus Tab/Shift+Tab : intercepté uniquement aux deux bornes
//   (premier/dernier élément), jamais un recalcul de l'ordre de tabulation
//   par défaut du navigateur entre les deux -- l'ordre naturel du DOM à
//   l'intérieur de la modale suffit, seules les bornes doivent être
//   redirigées.
// - Retour du focus sur l'élément ayant déclenché l'ouverture, toujours au
//   démontage (fermeture volontaire OU changement d'écran), jamais
//   seulement sur le chemin de fermeture explicite.
// - `closeDisabled` (mutation réseau en cours) : Échap et clic sur le fond
//   n'appellent plus `onClose` -- empêche une fermeture accidentelle
//   pendant une écriture déjà envoyée au serveur ; le focus reste dans la
//   modale dans tous les cas (le piège Tab n'est jamais désactivé).
export function Modal({ title, onClose, children, wide, describedById, closeDisabled }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  // Capturé via un initialiseur paresseux de `useState`, jamais dans le
  // `useEffect` ci-dessous (constat client-meeting-ux, revues finales
  // ciblées §11) : le rendu précède TOUJOURS le commit/montage, alors qu'un
  // `autoFocus` natif posé sur un enfant de la modale (plusieurs modales
  // existantes : constat de retrait de membre, amendement, sélecteurs de
  // foyer) déplace `document.activeElement` PENDANT le montage, avant que ce
  // `useEffect` (qui ne s'exécute qu'après le commit complet) ait pu lire
  // l'élément déclencheur réel -- capturer ici, au rendu, élimine toute
  // course avec un `autoFocus` d'enfant.
  const [triggerEl] = useState(() => document.activeElement);

  useEffect(() => {
    acquireBackgroundLock();
    return () => releaseBackgroundLock();
  }, []);

  useEffect(() => {
    modalStack.push(titleId);
    return () => { modalStack = modalStack.filter((id) => id !== titleId); };
  }, [titleId]);

  useEffect(() => {
    const focusables = focusableElements(dialogRef.current);
    (focusables[0] || dialogRef.current)?.focus();
    return () => {
      // `focus` peut être absent sur certains éléments déjà détachés du DOM
      // (changement d'écran concurrent) -- jamais une exception non
      // capturée pour un simple retour de focus.
      triggerEl?.focus?.();
    };
  }, [triggerEl]);

  useEffect(() => {
    function onKeyDown(e) {
      // Seule la modale au sommet de la pile partagée répond -- une modale
      // masquée derrière une autre (déjà ouverte) ne doit jamais réagir à
      // un clavier destiné à celle du dessus.
      if (modalStack[modalStack.length - 1] !== titleId) return;
      if (e.key === 'Escape') {
        if (closeDisabled) return;
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = focusableElements(dialogRef.current);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, closeDisabled, titleId]);

  // Rendu via portail directement dans `document.body` (correctif exigé
  // avant commit, GATE LOT 7B) : la modale vivait auparavant comme
  // descendant ordinaire de la page qui l'ouvre, elle-même imbriquée dans
  // `#root` -- masquer `#root` pour protéger le fond aurait alors masqué
  // la modale elle-même (un ancêtre commun ne peut jamais être caché sans
  // cacher tout ce qu'il contient). Le portail rend la modale SŒUR de
  // `#root` dans le DOM : `acquireBackgroundLock`/`releaseBackgroundLock`
  // ci-dessus peuvent alors masquer `#root` en toute sécurité sans jamais
  // toucher à un ancêtre de la modale. `.modal-backdrop` est déjà
  // `position: fixed; inset: 0` (styles.css) -- un portail ne change donc
  // rien à l'affichage, uniquement l'emplacement dans l'arbre DOM.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !closeDisabled) onClose(); }}>
      <div
        className="modal" style={wide ? { maxWidth: 820 } : undefined}
        role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedById}
        ref={dialogRef} tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  );
}

// Confirmation accessible générique (GATE LOT 7B ciblé §4/§5) -- remplace
// `window.confirm()` pour les avertissements de perte de saisie et de
// remplacement de texte : une boîte native ne peut porter aucun des
// attributs/comportements ci-dessus (hors du DOM contrôlable), donc
// intestable par Playwright de la même façon que les autres modales.
export function ConfirmModal({ title, message, confirmLabel = 'Continuer', cancelLabel = 'Annuler', onConfirm, onCancel }) {
  const descId = useId();
  return (
    <Modal title={title} onClose={onCancel} describedById={descId}>
      <p id={descId}>{message}</p>
      <div className="actions">
        <button onClick={onCancel}>{cancelLabel}</button>
        <button className="primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function Field({ label, children, full }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const TONES = {
  actif: 'good', client: 'good', payee: 'good', terminee: 'good', ouverte: 'info',
  offre: 'info', prospect: 'info', attendue: 'warn', suspendu: 'warn',
  resilie: 'critical', annulee: 'critical', anonymise: 'critical', echu: 'serious',
  ancien: 'serious', haute: 'critical', normale: 'info', basse: '',
  non_qualifie: '', froid: 'info', tiede: 'warn', chaud: 'serious', prioritaire: 'critical',
  archive: 'serious',
  principal: 'good', conjoint: 'info', enfant: 'info', autre_charge: '',
  exact_match: 'critical', probable_match: 'serious', possible_similarity: 'warn', no_match: '',
  draft: 'info', in_progress: 'warn', suspended: 'serious', completed: 'good', cancelled: 'critical',
  answered: 'good', unknown: 'warn', not_applicable: '', cleared: 'serious',
  // Espace conseiller des findings (Lot 4B).
  critical: 'critical', high: 'warn', medium: 'info', low: '',
  active: 'good', dismissed: 'serious', superseded: '',
  running: 'warn', failed: 'critical',
  no_rule_set_available: '', not_yet_run: 'info', up_to_date: 'good', stale: 'warn',
  // Recommandations humaines (Lot 7B) -- `draft`/`dismissed`/`superseded`
  // réutilisent déjà les tons ci-dessus (mêmes valeurs, même sens).
  validated: 'good', withdrawn: 'serious',
  // Navigation historique par answer_id (Lot 4B, GATE §2).
  source_answer: 'info',
  // État global agrégé multi-domaines (Lot 4B, GATE §3) -- `up_to_date` et
  // `stale` réutilisent déjà les tons ci-dessus (mêmes valeurs, même sens).
  not_analyzed: '', partial: 'warn', unavailable: '', error: 'critical',
};

export function Badge({ value, label }) {
  return <span className={`badge ${TONES[value] ?? ''}`}>{label ?? value}</span>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function useAsync(fn, deps) {
  const [state, setState] = React.useState({ loading: true, data: null, error: null });
  const reload = React.useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => setState({ loading: false, data, error: null }),
      (error) => setState({ loading: false, data: null, error: error.message })
    );
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
