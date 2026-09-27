-- The role script from docs/setup.md, "How the roles are created", for the local database.
-- Local logins have no password.

REVOKE CONNECT, TEMPORARY ON DATABASE focusledger FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS citext;

CREATE ROLE focusledger_migrate LOGIN;
CREATE ROLE focusledger_app     LOGIN;

CREATE ROLE ledger_reader  NOLOGIN;
CREATE ROLE ledger_writer  NOLOGIN;
CREATE ROLE account_reader NOLOGIN;
CREATE ROLE account_writer NOLOGIN;
GRANT ledger_reader  TO ledger_writer;
GRANT account_reader TO account_writer;

GRANT focusledger_migrate TO focusledger_owner WITH INHERIT FALSE, SET TRUE;
CREATE SCHEMA ledger  AUTHORIZATION focusledger_migrate;
CREATE SCHEMA account AUTHORIZATION focusledger_migrate;

GRANT CONNECT ON DATABASE focusledger TO focusledger_migrate, ledger_reader, account_reader;
GRANT ledger_writer, account_writer TO focusledger_app;
