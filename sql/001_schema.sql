-- The index: Postgres 18 with pgvector. `npm run db:reset` drops everything
-- and runs this file; `npm run ingest` fills it.
create extension if not exists vector;

-- One row per chunk: its text and its vector.
create table if not exists chunks (
  id             text primary key,        -- doc id + '::' + position
  doc_id         text not null,
  title          text not null,
  url            text not null,
  body           text not null,           -- embedded, searched, sent
  embedding      vector(1536) not null
);
