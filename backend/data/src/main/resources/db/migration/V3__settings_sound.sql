-- Every user setting lives on the server (docs/schema.md, "user_settings").
-- Existing rows take the defaults.

ALTER TABLE account.user_settings
  ADD COLUMN bell_sound          text    NOT NULL DEFAULT 'bowl'  CHECK (bell_sound IN ('bowl', 'wood', 'chime')),
  ADD COLUMN bell_volume         int     NOT NULL DEFAULT 70      CHECK (bell_volume BETWEEN 0 AND 100),
  ADD COLUMN bell_repeat         int     NOT NULL DEFAULT 3       CHECK (bell_repeat BETWEEN 1 AND 5),
  ADD COLUMN ring_after_break    boolean NOT NULL DEFAULT true,
  ADD COLUMN focus_sound         text    NOT NULL DEFAULT 'none'  CHECK (focus_sound IN ('none', 'ticking_fast', 'ticking_slow', 'white_noise', 'brown_noise')),
  ADD COLUMN focus_sound_volume  int     NOT NULL DEFAULT 40      CHECK (focus_sound_volume BETWEEN 0 AND 100);
