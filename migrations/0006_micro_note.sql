-- งานจิ๋ว · notes: a question about a place nobody owns, answered by going
-- there or calling. Paid from its own daily money at a price that moves on a
-- ladder each week (runNotePrice): most of the week's note money taken, a
-- step down; little of it taken, a step up.
ALTER TABLE micro_lease ADD COLUMN tier TEXT;
INSERT OR IGNORE INTO micro_setting (k, v) VALUES ('note_cap_satang_day', '10000'), ('note_satang', '500'), ('note_priced_day', '');
