@echo off
title CRM Legrand Conseils
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe sur cet ordinateur.
  echo  Telechargez-le gratuitement sur https://nodejs.org ^(bouton vert "LTS"^),
  echo  installez-le, puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Premiere utilisation : installation en cours, patientez 1 a 2 minutes...
  call npm install --no-audit --no-fund
)

if not exist client\dist (
  echo Preparation de l'interface...
  call npm run build
)

echo.
echo  CRM demarre ! Votre navigateur va s'ouvrir sur http://localhost:3000
echo  Laissez cette fenetre noire OUVERTE pendant que vous travaillez.
echo  Pour arreter le CRM : fermez cette fenetre.
echo.
start "" http://localhost:3000
set NODE_ENV=production
node server\index.js
pause
