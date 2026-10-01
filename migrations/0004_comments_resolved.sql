-- 0004: comentarios resueltos (estilo "resolver" de Google Docs)

ALTER TABLE comments ADD COLUMN resolved    INTEGER NOT NULL DEFAULT 0; -- 0=abierto, 1=resuelto
ALTER TABLE comments ADD COLUMN resolved_by TEXT;                       -- perfil que lo resolvió
ALTER TABLE comments ADD COLUMN resolved_at TEXT;
