#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installé sur cet ordinateur."
  echo "  Téléchargez-le gratuitement sur https://nodejs.org (bouton vert « LTS »),"
  echo "  installez-le, puis relancez ce fichier."
  echo ""
  read -r -p "Appuyez sur Entrée pour fermer…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Première utilisation : installation en cours, patientez 1 à 2 minutes…"
  npm install --no-audit --no-fund
fi

if [ ! -d client/dist ]; then
  echo "Préparation de l'interface…"
  npm run build
fi

echo ""
echo "  CRM démarré ! Votre navigateur va s'ouvrir sur http://localhost:3000"
echo "  Laissez cette fenêtre OUVERTE pendant que vous travaillez."
echo "  Pour arrêter le CRM : fermez cette fenêtre (ou Ctrl+C)."
echo ""
( sleep 2 && open http://localhost:3000 ) &
NODE_ENV=production node server/index.js
