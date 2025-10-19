CREATE TABLE IF NOT EXISTS druzyny (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  miasto TEXT NOT NULL,
  rok_zalozenia INTEGER NOT NULL,
  budzet_mln REAL NOT NULL,
  data_rejestracji TEXT NOT NULL DEFAULT (date('now'))
);
