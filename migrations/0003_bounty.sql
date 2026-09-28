-- บอทบาวน์ตี้ · the bot bounty — bots send pictures, the keeper grades each
-- one by how motdang.net can use it, and the bot's keeper claims the money.

CREATE TABLE photo (
  id          INTEGER PRIMARY KEY,
  agent_id    INTEGER NOT NULL REFERENCES agent(id),
  r2_key      TEXT NOT NULL,
  sha256      TEXT NOT NULL UNIQUE,
  bytes       INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  make        TEXT,
  model       TEXT,
  taken       TEXT,                                -- camera clock, as written
  tz          TEXT,
  lat         REAL,
  lon         REAL,
  kind        TEXT NOT NULL,                       -- place | sign | phone | menu | hours | timetable | beautiful | other
  place       TEXT,                                -- <prov>/<slug> on motdang.net, when the bot names one
  caption     TEXT NOT NULL DEFAULT '',
  credit      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'waiting',     -- waiting | declined | owed | paid
  tier        TEXT,                                -- none | filed | data | page | featured
  amount      INTEGER NOT NULL DEFAULT 0,          -- baht
  note        TEXT,                                -- the keeper's word to the bot
  claim       TEXT UNIQUE,
  graded_at   TEXT,
  paid_at     TEXT
);
CREATE INDEX photo_agent ON photo(agent_id, created_at);
CREATE INDEX photo_status ON photo(status, created_at);
