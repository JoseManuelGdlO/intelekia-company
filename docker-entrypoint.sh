#!/bin/sh
set -e

# Los volúmenes de EasyPanel empiezan vacíos: la primera vez se llenan con la copia de fábrica.
# "-n" no pisa nada que ya exista, así que tus datos (memorias, ideas, roles editados) se conservan
# entre despliegues y solo se agregan archivos nuevos que traiga una versión nueva.
mkdir -p /app/departamentos /app/backend/state
cp -rn /app/seed/departamentos/. /app/departamentos/ 2>/dev/null || true
cp -rn /app/seed/state/. /app/backend/state/ 2>/dev/null || true

exec "$@"
