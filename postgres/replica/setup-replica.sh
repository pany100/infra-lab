#!/bin/bash
set -e

# Si ya hay datos, no hacemos nada (esto evita rehacer todo en cada restart)
if [ -f "$PGDATA/postgresql.conf" ]; then
  echo "Replica ya inicializada, salteando setup"
  exit 0
fi

echo "Esperando al primary..."
until PGPASSWORD=replicator_pass psql -h db-primary -U replicator -d postgres -c '\q' 2>/dev/null; do
  echo "Primary no disponible, esperando..."
  sleep 2
done

echo "Primary disponible. Copiando datos iniciales..."
rm -rf "$PGDATA"/*

PGPASSWORD=replicator_pass pg_basebackup \
  -h db-primary \
  -U replicator \
  -D "$PGDATA" \
  -Fp -Xs -P -R

echo "Setup de replica completado"