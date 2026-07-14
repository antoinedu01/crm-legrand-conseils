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

rem Installe (ou repare) les composants si l'un d'eux manque
if not exist node_modules\express\package.json goto :install
if not exist node_modules\vite\package.json goto :install
if not exist node_modules\better-sqlite3\package.json goto :install
goto :installed
:install
echo Installation en cours, patientez 1 a 2 minutes... NE FERMEZ PAS cette fenetre.
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  L'installation a echoue. Verifiez votre connexion internet puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)
:installed

if not exist client\dist\index.html (
  echo Preparation de l'interface...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  La preparation de l'interface a echoue. Relancez ce fichier.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  CRM demarre ! Votre navigateur va s'ouvrir sur http://localhost:3000
echo  Laissez cette fenetre noire OUVERTE pendant que vous travaillez.
echo  Pour arreter le CRM : fermez cette fenetre.
echo.
echo  Depuis un iPad/telephone sur le MEME Wi-Fi, ouvrez Safari a l'adresse :
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo     http://%%a:3000 ^(sans les espaces^)
echo  (Si Windows demande d'autoriser Node.js dans le pare-feu :
echo   cochez "Reseaux prives" puis cliquez "Autoriser l'acces".)
echo.
start "" http://localhost:3000
set NODE_ENV=production
node server\index.js
pause
