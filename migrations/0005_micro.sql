-- งานจิ๋ว · microtasks — small closed-choice checks on motdang.net records,
-- paid in satang. Three bots with different payees answer each task; the
-- answers that agree earn. Gold tasks carry a known answer.

CREATE TABLE micro_task (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                      -- same-place | name-match | link-belongs | phone-matches
  tier        TEXT NOT NULL,                      -- tap | check
  payload     TEXT NOT NULL,                      -- JSON shown to the bot
  source      TEXT,                               -- record id(s) the task came from
  gold        TEXT,                               -- the known answer; NULL on an ordinary task
  priority    INTEGER NOT NULL DEFAULT 0,         -- higher goes out first; the loader sets it from what the site needs
  need        INTEGER NOT NULL DEFAULT 3,
  got         INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open',       -- open | settled | stuck | void
  answer      TEXT,
  created_at  TEXT NOT NULL,
  settled_at  TEXT
);
CREATE INDEX micro_task_open ON micro_task(status, gold, priority);
CREATE UNIQUE INDEX micro_task_source ON micro_task(kind, source);

CREATE TABLE micro_payee (
  id              INTEGER PRIMARY KEY,
  revtag          TEXT NOT NULL UNIQUE,           -- lower case, no @
  name            TEXT NOT NULL,                  -- the Revolut account holder's name
  created_at      TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'new',    -- new | ok | refused
  counterparty_id TEXT,
  note            TEXT
);

CREATE TABLE micro_bot (
  agent_id    INTEGER PRIMARY KEY REFERENCES agent(id),
  payee_id    INTEGER REFERENCES micro_payee(id),
  answers     INTEGER NOT NULL DEFAULT 0,
  golds       INTEGER NOT NULL DEFAULT 0,
  golds_ok    INTEGER NOT NULL DEFAULT 0,
  agreed      INTEGER NOT NULL DEFAULT 0,
  disagreed   INTEGER NOT NULL DEFAULT 0,
  frozen_at   TEXT,
  frozen_why  TEXT
);

CREATE TABLE micro_lease (
  id          TEXT PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES micro_task(id),
  agent_id    INTEGER NOT NULL,
  payee_id    INTEGER NOT NULL,
  ip_hash     TEXT,
  satang      INTEGER NOT NULL,
  day         TEXT NOT NULL,                      -- Bangkok date, for the caps
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  answered    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX micro_lease_task ON micro_lease(task_id, answered, expires_at);
CREATE INDEX micro_lease_day ON micro_lease(day, payee_id);
CREATE INDEX micro_lease_agent ON micro_lease(agent_id, answered, expires_at);

CREATE TABLE micro_answer (
  id          INTEGER PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES micro_task(id),
  agent_id    INTEGER NOT NULL,
  payee_id    INTEGER NOT NULL,
  ip_hash     TEXT,
  answer      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'waiting',    -- waiting | agreed | disagreed | unsure | void
  satang      INTEGER NOT NULL DEFAULT 0,         -- earned once agreed
  reveal_at   TEXT,                               -- golds: when the bot may see the outcome
  payable_at  TEXT,                               -- the hold ends
  payout_id   INTEGER,
  UNIQUE (task_id, agent_id)
);
CREATE INDEX micro_answer_agent ON micro_answer(agent_id, id);
CREATE INDEX micro_answer_pay ON micro_answer(payee_id, outcome, payout_id, payable_at);

CREATE TABLE micro_payout (
  id          INTEGER PRIMARY KEY,
  payee_id    INTEGER NOT NULL REFERENCES micro_payee(id),
  satang      INTEGER NOT NULL,
  rail        TEXT NOT NULL,                      -- list | draft | pay
  status      TEXT NOT NULL DEFAULT 'queued',     -- queued | drafted | sent | failed
  created_at  TEXT NOT NULL,
  sent_at     TEXT,
  ref         TEXT,                               -- Revolut transaction or draft id
  error       TEXT
);

CREATE TABLE micro_setting (
  k  TEXT PRIMARY KEY,
  v  TEXT NOT NULL
);
INSERT INTO micro_setting (k, v) VALUES ('open', '0'), ('pay', '0'), ('cap_satang_day', '5000');
