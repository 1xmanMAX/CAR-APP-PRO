#!/usr/bin/env bash
# Control Flota en modo DEMO (Linux / macOS). En Windows usa INICIAR-DEMO.bat.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Falta Node.js (versión 22 o superior): https://nodejs.org"; exit 1; }
PNPM="npx --yes pnpm@9.12.3"
[ -d node_modules ] || { echo "Instalando lo necesario (solo la primera vez)…"; $PNPM install --frozen-lockfile; }
[ -d data-demo/pglite ] || $PNPM demo:flota
echo "Abre http://localhost:3000 · usuario demo@flota.pe · clave demo1234"
( sleep 8; (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) || (command -v open >/dev/null && open http://localhost:3000) || true ) >/dev/null 2>&1 &
DATA_DIR=./data-demo STORAGE_DIR=./data-demo/storage WEB_PUERTO=3000 exec $PNPM web
