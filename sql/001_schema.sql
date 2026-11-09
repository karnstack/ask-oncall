-- The index: Postgres 18 with pgvector. `npm run db:reset` drops everything
-- and runs this file; `npm run ingest` fills it.
create extension if not exists vector;

-- One row per document the index has ever seen. A deleted document keeps its
-- row as a tombstone (deleted_at), and every search checks it.
create table if not exists documents (
  id             text primary key,        -- 'runbooks/postgres-failover.md@v2'
  source         text not null,           -- 'k8s-docs', 'runbooks', 'slack', 'wiki-export-2024', ...
  title          text not null,
  url            text not null,
  content_hash   text not null,           -- sha256 of the indexed text and front matter
  version        int,
  effective_at   date,
  superseded_by  text,
  is_current     boolean not null default true,
  allowed_groups text[] not null,         -- principals: groups, or user:<handle>
  scope          text,
  deleted_at     timestamptz,             -- the tombstone
  updated_at     timestamptz,
  indexed_at     timestamptz not null default now()
);

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
  breadcrumb     text not null default '',  -- the heading path, shown in citations
  context        text,                      -- model-written context for the word leg (optional)
  -- the word leg reads the context and the body; the vector leg reads the body only
  tsv            tsvector generated always as (to_tsvector('english', coalesce(context, '') || ' ' || body)) stored
);
create index if not exists chunks_tsv on chunks using gin (tsv);
create index if not exists chunks_doc_id on chunks (doc_id);
