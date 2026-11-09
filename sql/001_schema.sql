-- The index: Postgres 18 with pgvector. `npm run db:reset` drops everything
-- and runs this file; `npm run ingest` fills it.
create extension if not exists vector;

-- One row per chunk: its text, its vector, and its document's front matter.
create table if not exists chunks (
  id             text primary key,        -- doc id + '::' + position
  doc_id         text not null,
  n              int not null,
  title          text not null,
  url            text not null,
  body           text not null,           -- breadcrumb line + text: embedded, searched, sent
  embedding      vector(1536) not null,
  start_char     int not null,            -- the range of the document it covers (for labels)
  end_char       int not null,
  source         text not null,
  type           text not null,
  version        int,
  is_current     boolean not null default true,
  superseded_by  text,
  allowed_groups text[] not null,
  scope          text,
  service        text[] not null default '{}',
  effective_at   date,
  updated_at     timestamptz,
  tsv            tsvector generated always as (to_tsvector('english', body)) stored
);
create index if not exists chunks_tsv on chunks using gin (tsv);
