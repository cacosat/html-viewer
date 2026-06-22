-- 0001_init.sql — esquema inicial de html-viewer

CREATE TABLE IF NOT EXISTS profiles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,                 -- uuid interno
  share_id   TEXT NOT NULL UNIQUE,             -- token público para el link
  title      TEXT NOT NULL,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  r2_key     TEXT NOT NULL,                    -- key del contenido en R2
  size       INTEGER NOT NULL DEFAULT 0,       -- bytes del HTML
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_share   ON documents(share_id);
