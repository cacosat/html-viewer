-- 0003: comentarios por documento

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  author      TEXT,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(document_id, created_at);
