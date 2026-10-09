#!/usr/bin/env bash
# Recria o banco de teste local e aplica o shim do Supabase + todas as migrations.
set -euo pipefail
DB="${TEST_DB:-crm_test}"
PSQL=(psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54329}" -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q)
cd "$(dirname "$0")/../.."
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f tests/db/supabase-shim.sql >/dev/null
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" 2>&1 | { grep -v NOTICE || true; }
done
echo "ok: $DB"
