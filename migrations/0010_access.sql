-- ทำงานแลกสิทธิ์อ่าน · work for access (Nan 2026-11-25). A bot takes one check
-- from the microtask pool, answers it and gets a key for motdang.net. No
-- joining, no payee; the key is the pay. Answers stay here, apart from micro_answer.

CREATE TABLE access_lease (
  id          TEXT PRIMARY KEY,                   -- al_<hex>
  task_id     INTEGER NOT NULL REFERENCES micro_task(id),
  ip_hash     TEXT,
  ua          TEXT,                               -- the asker's user agent, cut to 64
  issued_at   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  answered    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX access_lease_ip ON access_lease(ip_hash, issued_at);

CREATE TABLE access_answer (
  id          INTEGER PRIMARY KEY,
  lease_id    TEXT NOT NULL UNIQUE,
  task_id     INTEGER NOT NULL,
  ip_hash     TEXT,
  ua          TEXT,
  answer      TEXT NOT NULL,
  gold        INTEGER NOT NULL DEFAULT 0,         -- 1 when the check had a known answer
  right       INTEGER,                            -- golds: 1 right, 0 wrong; NULL otherwise
  key_given   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX access_answer_task ON access_answer(task_id, ip_hash);
