#!/bin/bash
# Runs once, on an empty volume. The role script runs as a non-superuser owner, as it does on Neon.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE focusledger_owner LOGIN CREATEROLE CREATEDB NOSUPERUSER;
ALTER DATABASE focusledger OWNER TO focusledger_owner;
SQL

psql -v ON_ERROR_STOP=1 --username focusledger_owner --dbname "$POSTGRES_DB" --file /focusledger/roles.sql
