-- 2026-10-17, Nan: "tasks that can be done by humans in america and other not-thailand places to
-- support motdang projects … automagically paid, and artist deals should apply. Calls to action.
-- Lure influencer experts and autistic people in need of steady respectful gig work."
-- people.mjs: /anthill/work. A person answers the same microtasks bots do, paid in US cents,
-- and may write account reviews; each Monday what they earned becomes a payout.

-- each person has an agent row and a payee row, so the microtask engine counts them as it counts bots;
-- their payee's state is 'abroad', which keeps them off the Revolut rail and the baht caps
CREATE TABLE person (
  id          INTEGER PRIMARY KEY,
  agent_id    INTEGER NOT NULL UNIQUE REFERENCES agent(id),
  payee_id    INTEGER NOT NULL REFERENCES micro_payee(id),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  rail        TEXT NOT NULL,                      -- paypal | venmo | wise
  handle      TEXT NOT NULL,
  thai        INTEGER NOT NULL DEFAULT 0,         -- reads Thai: gets same-place and name-match too
  key         TEXT NOT NULL,                      -- part of their link; a new one cancels the old link
  created_at  TEXT NOT NULL,
  ip_hash     TEXT
);
CREATE UNIQUE INDEX person_email ON person(email);

-- the money a lease is counted in: thb (satang, bots) or usd (cents, people)
ALTER TABLE micro_lease ADD COLUMN cur TEXT NOT NULL DEFAULT 'thb';
-- a person's answer paid before its task settled, or once it did
ALTER TABLE micro_answer ADD COLUMN ppay_id INTEGER;

-- work that is not a microtask: an account review, for now
CREATE TABLE person_job (
  id          INTEGER PRIMARY KEY,
  person_id   INTEGER NOT NULL REFERENCES person(id),
  kind        TEXT NOT NULL,                      -- review
  about       TEXT NOT NULL,                      -- which account
  body        TEXT NOT NULL,
  cents       INTEGER NOT NULL,
  month       TEXT NOT NULL,                      -- Bangkok YYYY-MM, for the places a month
  state       TEXT NOT NULL DEFAULT 'held',       -- held | no
  created_at  TEXT NOT NULL,
  payable_at  TEXT NOT NULL,                      -- unless someone marks it no before then
  ppay_id     INTEGER
);
CREATE INDEX person_job_person ON person_job(person_id, state);

CREATE TABLE person_payout (
  id          INTEGER PRIMARY KEY,
  person_id   INTEGER NOT NULL REFERENCES person(id),
  cents       INTEGER NOT NULL,
  week        TEXT NOT NULL,                      -- the Monday it was made, Bangkok date
  status      TEXT NOT NULL DEFAULT 'due',        -- due | sent
  created_at  TEXT NOT NULL,
  sent_at     TEXT,
  UNIQUE (person_id, week)
);

-- rates are rungs on people.mjs's ladders; the money a day is in cents
INSERT INTO micro_setting (k, v) VALUES ('usd_cap_cents_day', '1500'), ('usd_tap_rung', '2'), ('usd_check_rung', '2'),
  ('usd_review_rung', '2'), ('usd_reviews_month', '2'), ('usd_stepped_week', ''), ('usd_paid_week', ''), ('usd_review_stepped_month', '');
