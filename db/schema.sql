CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE focus_mode AS ENUM ('deep_focus', 'execution', 'shallow');

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- app_user
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id         uuid        PRIMARY KEY,
  email      citext      NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------

CREATE TABLE user_settings (
  user_id               uuid        PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  deep_focus_minutes    int         NOT NULL DEFAULT 90 CHECK (deep_focus_minutes BETWEEN 1 AND 480),
  execution_minutes     int         NOT NULL DEFAULT 50 CHECK (execution_minutes BETWEEN 1 AND 480),
  shallow_minutes       int         NOT NULL DEFAULT 25 CHECK (shallow_minutes BETWEEN 1 AND 480),
  break_minutes         int         NOT NULL DEFAULT 5  CHECK (break_minutes BETWEEN 1 AND 60),
  sound_enabled         boolean     NOT NULL DEFAULT true,
  notifications_enabled boolean     NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_settings_updated_at BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- node
-- ---------------------------------------------------------------------------

CREATE TABLE node (
  user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  id         uuid        NOT NULL,
  parent_id  uuid,
  name       text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  -- Fractional-index key. "C" collation makes the sort byte order, which the key format assumes.
  position   text        COLLATE "C" NOT NULL,
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  -- Composite key: a parent must belong to the same user.
  FOREIGN KEY (user_id, parent_id) REFERENCES node (user_id, id),
  CHECK (parent_id <> id)
);

CREATE INDEX node_children ON node (user_id, parent_id, position);

CREATE FUNCTION node_reject_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT n.id, n.parent_id FROM node n
      WHERE n.user_id = NEW.user_id AND n.id = NEW.parent_id
      UNION ALL
      SELECT n.id, n.parent_id FROM node n
      JOIN ancestors a ON n.user_id = NEW.user_id AND n.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'node % cannot move under its own descendant', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER node_reject_cycle BEFORE UPDATE OF parent_id ON node
  FOR EACH ROW EXECUTE FUNCTION node_reject_cycle();

CREATE TRIGGER node_updated_at BEFORE UPDATE ON node
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- cycle
-- ---------------------------------------------------------------------------

CREATE TABLE cycle (
  user_id    uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  id         uuid        NOT NULL,
  node_id    uuid,
  mode       focus_mode  NOT NULL,
  started_at timestamptz NOT NULL,
  minutes    int         NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  tz         text        NOT NULL,
  local_date date        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, node_id) REFERENCES node (user_id, id)
);

CREATE INDEX cycle_rollup ON cycle (user_id, local_date)
  INCLUDE (node_id, mode, minutes, started_at)
  WHERE deleted_at IS NULL;

CREATE INDEX cycle_node ON cycle (user_id, node_id);

-- local_date is the day in the user's zone at start. It is set once, so a later trip does not move the cycle to another day.
CREATE FUNCTION cycle_set_local_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.local_date := (NEW.started_at AT TIME ZONE NEW.tz)::date;
  RETURN NEW;
END $$;

CREATE TRIGGER cycle_set_local_date BEFORE INSERT ON cycle
  FOR EACH ROW EXECUTE FUNCTION cycle_set_local_date();

-- A written cycle allows exactly three changes: filing an unfiled cycle once,
-- adding minutes from a bell extension, and a soft delete.
CREATE FUNCTION cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cycle % is deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.user_id, NEW.id, NEW.mode, NEW.started_at, NEW.tz, NEW.local_date, NEW.created_at)
     IS DISTINCT FROM
     (OLD.user_id, OLD.id, OLD.mode, OLD.started_at, OLD.tz, OLD.local_date, OLD.created_at) THEN
    RAISE EXCEPTION 'cycle % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.node_id IS NOT NULL AND NEW.node_id IS DISTINCT FROM OLD.node_id THEN
    RAISE EXCEPTION 'cycle % is already filed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.minutes < OLD.minutes THEN
    RAISE EXCEPTION 'cycle % minutes can only grow', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER cycle_guard BEFORE UPDATE ON cycle
  FOR EACH ROW EXECUTE FUNCTION cycle_guard();

-- ---------------------------------------------------------------------------
-- estimate
-- ---------------------------------------------------------------------------

CREATE TABLE estimate (
  user_id       uuid        NOT NULL,
  node_id       uuid        NOT NULL,
  mode          focus_mode  NOT NULL,
  cycle_minutes int         NOT NULL CHECK (cycle_minutes BETWEEN 1 AND 480),
  cycle_count   int         NOT NULL CHECK (cycle_count >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id, mode),
  FOREIGN KEY (user_id, node_id) REFERENCES node (user_id, id) ON DELETE CASCADE
);

CREATE TRIGGER estimate_updated_at BEFORE UPDATE ON estimate
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- active_cycle
-- ---------------------------------------------------------------------------

CREATE TABLE active_cycle (
  user_id         uuid        PRIMARY KEY REFERENCES app_user (id) ON DELETE CASCADE,
  cycle_id        uuid        NOT NULL,
  node_id         uuid,
  mode            focus_mode  NOT NULL,
  started_at      timestamptz NOT NULL,
  planned_minutes int         NOT NULL CHECK (planned_minutes BETWEEN 1 AND 1440),
  paused_at       timestamptz,
  paused_seconds  int         NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
  tz              text        NOT NULL,
  -- True when cycle_id is already in the cycle table and Stop adds minutes to it.
  is_extension    boolean     NOT NULL DEFAULT false,
  FOREIGN KEY (user_id, node_id) REFERENCES node (user_id, id)
);
