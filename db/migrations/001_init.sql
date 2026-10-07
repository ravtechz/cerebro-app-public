-- 001_init.sql — schema de baza Cerebro (Faza 03).
--
-- Aplicat o singura data de db/migrate.sh. NU modifica acest fisier dupa ce a
-- rulat pe server: orice schimbare ulterioara intra intr-o migratie noua.
--
-- Fara seed de categorii aici — categoriile sunt per user si se creeaza la
-- provisioning, cu scripts/create_user.py.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  -- sha256(api_key). Cheia in clar se afiseaza o singura data, la creare,
  -- si nu se stocheaza niciodata.
  api_key_hash  TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'category',
  sort_order  INT NOT NULL DEFAULT 0,
  is_inbox    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- Invariantul "exact un Inbox per user" e adaugat in 002, nu aici: acest fisier
-- reproduce exact schema din plan, care a fost deja aplicata manual pe VM.

CREATE TABLE notes (
  uuid                UUID PRIMARY KEY,          -- generat pe telefon
  user_id             INT NOT NULL REFERENCES users(id),
  text                TEXT NOT NULL,
  category_id         INT NOT NULL REFERENCES categories(id),
  confidence          REAL,                      -- de la LLM; NULL daca n-a fost categorizata
  done                BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,               -- soft delete / trash
  created_at          TIMESTAMPTZ NOT NULL,      -- timestamp de pe telefon
  updated_at          TIMESTAMPTZ NOT NULL,      -- baza pentru last-write-wins
  server_received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_user_cat ON notes(user_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_trash    ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
