-- The role script from docs/setup.md, "How the roles are created", with the local database name.
-- Local logins have no password. docker-compose.yml uses trust auth on 127.0.0.1.

CREATE ROLE focusledger_migrate LOGIN;
CREATE ROLE focusledger_app     LOGIN;

CREATE ROLE ledger_reader  NOLOGIN;
CREATE ROLE ledger_writer  NOLOGIN;
CREATE ROLE account_reader NOLOGIN;
CREATE ROLE account_writer NOLOGIN;
GRANT ledger_reader  TO ledger_writer;
GRANT account_reader TO account_writer;

CREATE SCHEMA ledger  AUTHORIZATION focusledger_migrate;
CREATE SCHEMA account AUTHORIZATION focusledger_migrate;

GRANT CONNECT ON DATABASE focusledger TO ledger_reader, account_reader;
GRANT ledger_writer, account_writer TO focusledger_app;
