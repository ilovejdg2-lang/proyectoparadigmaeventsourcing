#!/usr/bin/env bash
# Levanta la plataforma completa con las imágenes publicadas en Docker Hub.
#
#   ./run.sh           baja las imágenes y levanta los contenedores
#   ./run.sh --build   construye las imágenes desde el código (necesita ../eventsourcingfrontend)
#   ./run.sh --down    apaga los contenedores; el historial queda en el volumen
#
# En un servidor, PUBLIC_HOST cambia la dirección que se imprime al final:
#   PUBLIC_HOST=20.30.40.50 ./run.sh

set -euo pipefail
cd "$(dirname "$0")"

if ! docker info > /dev/null 2>&1; then
  echo "Docker no está corriendo (o tu usuario no tiene permiso: prueba con sudo)." >&2
  exit 1
fi

case "${1:-}" in
  --down)
    docker compose down
    exit 0
    ;;
  --build)
    docker compose up -d --build
    ;;
  *)
    docker compose pull
    docker compose up -d --no-build
    ;;
esac

wait_for() {
  local url=$1
  for _ in $(seq 1 80); do
    if curl -fsS -o /dev/null "$url"; then return 0; fi
    sleep 3
  done
  echo "No respondió a tiempo: $url (revisa: docker compose logs)" >&2
  exit 1
}

wait_for http://localhost:3000/transactions
wait_for http://localhost:3001/history/transactions
wait_for http://localhost:5173/

host=${PUBLIC_HOST:-localhost}
echo
echo "Plataforma lista."
echo "  Frontend:          http://$host:5173/"
echo "  Transaction API:   http://$host:3000/api/docs"
echo "  History API:       http://$host:3001/"
echo
echo "Para generar datos de demo: API_URL=http://$host:3000 HISTORY_URL=http://$host:3001 node scripts/simular.mjs"
