-- ราคา · prices. Nan 2026-10-18: "we need to shoupify our payouts to stay within our margins",
-- "we will be dynamically pricing everything, so everything needs to be relational", and
-- C221 (b): "build the price table with weekly Shoup steps for the Anthill payouts".
-- Every amount the Anthill pays is a program's base × an item's ratio; only the base moves,
-- one rung a week on its ladder (src/price.mjs). Opening rungs pay today's amounts, her
-- 1/10 of 2026-10-18: bounty ฿0 · 2 · 5 · 10 · 30, taps ฿0.01, checks ฿0.03, notes ฿5.

CREATE TABLE price_program (
  program      TEXT PRIMARY KEY,
  base_item    TEXT NOT NULL,                 -- the item whose amount is the base (ratio 1)
  unit         TEXT NOT NULL,                 -- baht | satang
  ladder       TEXT NOT NULL,                 -- JSON array of base amounts, low to high
  rung         INTEGER NOT NULL,              -- index into ladder, this week
  floor_rung   INTEGER NOT NULL,
  ceiling_rung INTEGER NOT NULL,
  measure      TEXT NOT NULL,                 -- slots (uses in price_use) | money (the daily cap taken)
  slots_week   INTEGER,                       -- measure = slots
  down_over    REAL NOT NULL DEFAULT 0.8,     -- last week used more than this share → a rung down
  up_under     REAL NOT NULL DEFAULT 0.6,     -- less than this share → a rung up
  step         TEXT NOT NULL DEFAULT 'weekly',-- weekly | off | template (copied for a new job)
  opened       TEXT NOT NULL,                 -- Monday (Bangkok) of the first week priced here
  stepped_week TEXT NOT NULL DEFAULT '',      -- Monday of the last step
  set_by       TEXT NOT NULL,
  set_on       TEXT NOT NULL,
  about        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE price_item (
  program    TEXT NOT NULL REFERENCES price_program(program),
  item       TEXT NOT NULL,
  ratio      REAL NOT NULL,                   -- amount = round(base × ratio), at least min unless ratio is 0
  min        INTEGER NOT NULL DEFAULT 0,
  slots_week INTEGER,                         -- this item's own share of the week's slots
  set_by     TEXT NOT NULL,
  set_on     TEXT NOT NULL,
  PRIMARY KEY (program, item)
);

CREATE TABLE price_step (
  program     TEXT NOT NULL REFERENCES price_program(program),
  week        TEXT NOT NULL,                  -- the Monday the new rung starts
  used        REAL NOT NULL,                  -- last week: uses, or satang taken
  of          REAL NOT NULL,                  -- slots, or 7 × the daily cap
  rung_before INTEGER NOT NULL,
  rung_after  INTEGER NOT NULL,
  base_before INTEGER NOT NULL,
  base_after  INTEGER NOT NULL,
  at          TEXT NOT NULL,
  PRIMARY KEY (program, week)
);

-- A slot taken: a bounty picture graded to pay, a change used on a job. Money-measured
-- programs (taps, checks, notes) keep their uses in micro_lease.
CREATE TABLE price_use (
  id      INTEGER PRIMARY KEY,
  program TEXT NOT NULL REFERENCES price_program(program),
  item    TEXT NOT NULL,
  ref     TEXT NOT NULL,                      -- photo-<id>, or the change's own reference
  who     TEXT NOT NULL DEFAULT '',
  week    TEXT NOT NULL,                      -- Monday of the week whose slot it takes
  amount  INTEGER NOT NULL,                   -- in the program's unit, at that week's rung
  at      TEXT NOT NULL,
  UNIQUE (program, ref)
);
CREATE INDEX price_use_week ON price_use(program, week);

-- Bounty: base = page, ladder ฿3 · 5 · 10 · 15, 20 paid pictures a week, 2 of them featured.
INSERT INTO price_program (program, base_item, unit, ladder, rung, floor_rung, ceiling_rung, measure, slots_week, opened, set_by, set_on, about) VALUES
  ('bounty', 'page', 'baht', '[3,5,10,15]', 2, 0, 3, 'slots', 20, '2026-10-19', 'Nan, C221 (b)', '2026-10-18', 'Bot bounty pictures, /bounty');
INSERT INTO price_item (program, item, ratio, min, slots_week, set_by, set_on) VALUES
  ('bounty', 'none',     0,   0, NULL, 'Nan 2026-09-28, 1/10 2026-10-18', '2026-10-18'),
  ('bounty', 'filed',    0.2, 1, NULL, 'Nan 2026-09-28, 1/10 2026-10-18', '2026-10-18'),
  ('bounty', 'data',     0.5, 1, NULL, 'Nan 2026-09-28, 1/10 2026-10-18', '2026-10-18'),
  ('bounty', 'page',     1,   1, NULL, 'Nan 2026-09-28, 1/10 2026-10-18', '2026-10-18'),
  ('bounty', 'featured', 3,   1, 2,    'Nan 2026-09-28, 1/10 2026-10-18', '2026-10-18');

-- Microtasks for bots: base = check, ladder 1 · 2 · 3 · 4 · 5 satang; taps follow at a third.
INSERT INTO price_program (program, base_item, unit, ladder, rung, floor_rung, ceiling_rung, measure, opened, set_by, set_on, about) VALUES
  ('micro', 'check', 'satang', '[1,2,3,4,5]', 2, 0, 4, 'money', '2026-10-19', 'Nan, C221 (b)', '2026-10-18', 'Microtask taps and checks for bots, /micro; money = micro_setting cap_satang_day');
INSERT INTO price_item (program, item, ratio, min, set_by, set_on) VALUES
  ('micro', 'tap',   1.0 / 3, 1, 'Nan 2026-10-03, 1/10 2026-10-18', '2026-10-18'),
  ('micro', 'check', 1,       1, 'Nan 2026-10-03, 1/10 2026-10-18', '2026-10-18');

-- Notes: their ฿1 · 2 · 3 · 5 · 10 ladder and Monday rule move in unchanged, at the price they hold.
INSERT INTO price_program (program, base_item, unit, ladder, rung, floor_rung, ceiling_rung, measure, opened, stepped_week, set_by, set_on, about)
  SELECT 'note', 'note', 'satang', '[100,200,300,500,1000]',
    CASE COALESCE((SELECT v FROM micro_setting WHERE k = 'note_satang'), '500') WHEN '100' THEN 0 WHEN '200' THEN 1 WHEN '300' THEN 2 WHEN '1000' THEN 4 ELSE 3 END,
    0, 4, 'money', '2026-10-12', COALESCE((SELECT v FROM micro_setting WHERE k = 'note_priced_day'), ''),
    'a session, 2026-10-16', '2026-10-18', 'Notes, /micro; money = micro_setting note_cap_satang_day';
INSERT INTO price_item (program, item, ratio, min, set_by, set_on) VALUES
  ('note', 'note', 1, 1, 'a session, 2026-10-16', '2026-10-18');

-- A job our ant posts opens on the roadworks rule (mot-dang importers/payout_shoup.py):
-- ฿10 on ฿1 · 2 · 3 · 5 · 10 · 15 · 20, 5 changes a week.
INSERT INTO price_program (program, base_item, unit, ladder, rung, floor_rung, ceiling_rung, measure, slots_week, step, opened, set_by, set_on, about) VALUES
  ('job', 'use', 'baht', '[1,2,3,5,10,15,20]', 4, 0, 6, 'slots', 5, 'template', '2026-10-19', 'Nan, C221 (b)', '2026-10-18', 'Copied as job-<id> for a job our ant posts');
INSERT INTO price_item (program, item, ratio, min, set_by, set_on) VALUES
  ('job', 'use', 1, 1, 'Nan, C221 (b)', '2026-10-18');
