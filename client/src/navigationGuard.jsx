import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { ConfirmModal } from './components/ui.jsx';

// Garde de perte de saisie PARTAGÉE, seule source de vérité pour toute
// l'application (constat client-meeting-ux/compliance-privacy-reviewer,
// revues finales ciblées LOT 7B, correctif exigé avant commit) -- avant ce
// module, seule la navigation interne à `SessionRecommendations.jsx` était
// protégée (boutons d'en-tête, retour d'écran, `beforeunload`) ; la barre
// latérale, la déconnexion et le bouton Précédent/Suivant du navigateur ne
// l'étaient jamais, alors que ce sont exactement les chemins par lesquels un
// conseiller quitte le plus naturellement un écran. Une SEULE implémentation
// (ce module), jamais une résolution divergente par page.
//
// Portée volontairement limitée à la PROTECTION DE NAVIGATION (quitter la
// page/l'application) : les confirmations purement locales à un formulaire
// (effacement d'un texte déjà saisi en changeant de déclaration dans
// `DeclarationField`) restent hors de ce module, une préoccupation
// différente (perte de contenu local, pas une navigation).
const NavigationGuardContext = createContext(null);

export function useNavigationGuard() {
  const ctx = useContext(NavigationGuardContext);
  if (!ctx) throw new Error('useNavigationGuard doit être utilisé sous NavigationGuardProvider.');
  return ctx;
}

export function NavigationGuardProvider({ children }) {
  const dirtyRef = useRef(false);
  const [dirty, setDirtyState] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null); // { resolve }

  const setDirty = useCallback((value) => {
    dirtyRef.current = !!value;
    setDirtyState(!!value);
  }, []);

  // Porte UNIQUE utilisée par tout déclencheur de navigation de
  // l'application (lien latéral, déconnexion, bouton Précédent propre à un
  // écran, bouton Précédent/Suivant du NAVIGATEUR ci-dessous) -- ne montre
  // la confirmation QUE si un formulaire est réellement sale au moment de
  // l'appel, jamais un état figé.
  const confirmIfDirty = useCallback(() => {
    if (!dirtyRef.current) return Promise.resolve(true);
    return new Promise((resolve) => setPendingConfirm({ resolve }));
  }, []);

  // beforeunload (actualisation / fermeture d'onglet) -- écouteur natif
  // ajouté UNIQUEMENT quand un formulaire est réellement sale, retiré dès
  // qu'il redevient propre (sauvegarde/création réussie, abandon confirmé,
  // retour manuel à l'état initial, démontage) : source UNIQUE désormais,
  // remplace l'ancien hook local `useBeforeUnloadGuard` dupliqué par page.
  useEffect(() => {
    if (!dirty) return undefined;
    function onBeforeUnload(e) { e.preventDefault(); e.returnValue = ''; }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Bouton Précédent/Suivant du NAVIGATEUR -- l'API History ne permet
  // JAMAIS d'empêcher nativement un `popstate` (le navigateur a déjà changé
  // l'URL au moment où l'évènement est reçu) : seule une entrée
  // supplémentaire ("sentinelle", même URL que la page courante, donc
  // invisible pour React Router qui ne recalcule rien sur une navigation
  // sans changement de chemin) permet d'absorber le PREMIER appui, le temps
  // de proposer la confirmation. `sentinelArmedRef` borne à UNE SEULE
  // entrée supplémentaire par page protégée, quel que soit le nombre de
  // cycles sale/propre traversés, pour limiter au strict minimum l'effet de
  // bord connu de cette technique (voir limite documentée ci-dessous).
  const sentinelArmedRef = useRef(false);
  useEffect(() => {
    if (dirty && !sentinelArmedRef.current) {
      window.history.pushState({ __navGuardSentinel: true }, '', window.location.href);
      sentinelArmedRef.current = true;
    }
  }, [dirty]);

  useEffect(() => {
    function onPopState() {
      if (!dirtyRef.current) return; // rien à protéger : navigation normale, jamais interceptée
      confirmIfDirty().then((ok) => {
        if (ok) {
          sentinelArmedRef.current = false;
          setDirty(false);
          window.history.go(-1); // quitte réellement maintenant (une seule entrée sentinelle a été consommée par ce popstate)
        } else {
          // Annulé : réarme une sentinelle pour continuer à protéger un
          // éventuel appui suivant (la précédente a été consommée par ce
          // popstate lui-même).
          window.history.pushState({ __navGuardSentinel: true }, '', window.location.href);
        }
      });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [confirmIfDirty, setDirty]);

  function handleConfirm() {
    const p = pendingConfirm;
    setPendingConfirm(null);
    p?.resolve(true);
  }
  function handleCancel() {
    const p = pendingConfirm;
    setPendingConfirm(null);
    p?.resolve(false);
  }

  return (
    <NavigationGuardContext.Provider value={{ dirty, setDirty, confirmIfDirty }}>
      {children}
      {pendingConfirm && (
        <ConfirmModal
          title="Quitter sans enregistrer ?"
          message="Des informations saisies n'ont pas été enregistrées. Quitter quand même ?"
          confirmLabel="Quitter sans enregistrer"
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </NavigationGuardContext.Provider>
  );
}
