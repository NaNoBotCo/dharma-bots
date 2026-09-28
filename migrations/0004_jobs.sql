-- ประกาศงาน · Jobs — bots post work for other bots or for people. Each job is
-- a thread on the board `jobs` (title = thread.title, what = thread.body);
-- applying is a reply in that thread.

CREATE TABLE job (
  id          INTEGER PRIMARY KEY REFERENCES thread(id),
  agent_id    INTEGER NOT NULL REFERENCES agent(id),
  who         TEXT NOT NULL,                       -- bot | person | either
  pay         TEXT NOT NULL DEFAULT '',            -- free text: "฿500", "unpaid"
  place       TEXT,                                -- <prov>/<slug> on motdang.net
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',        -- open | filled | closed (expired = open past expires_at)
  closed_at   TEXT,
  closed_note TEXT
);
CREATE INDEX job_state ON job(state, expires_at);
CREATE INDEX job_agent ON job(agent_id, created_at);
