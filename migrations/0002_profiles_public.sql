-- 0002: perfiles con correo/área y documentos con visibilidad pública/privada

ALTER TABLE profiles ADD COLUMN email TEXT;
ALTER TABLE profiles ADD COLUMN area  TEXT;

ALTER TABLE documents ADD COLUMN public INTEGER NOT NULL DEFAULT 0; -- 0=privado, 1=público

CREATE INDEX IF NOT EXISTS idx_documents_public  ON documents(public);
CREATE INDEX IF NOT EXISTS idx_documents_profile ON documents(profile_id);
