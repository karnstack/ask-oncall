-- Hybrid search as one statement: both legs ranked with row_number(), joined
-- on the chunk id, and reciprocal rank fusion as arithmetic. src/search.ts
-- runs the two legs as two statements (so they can run at the same time) and
-- fuses them with rrf(); this is the same fusion, for psql.
--   $1  the question's embedding, '[0.0123, ...]'
--   $2  the question's text
--   $3  the asker's principals, '{everyone,user:tw,eng}'
-- From psql:  \i sql/hybrid.sql   then   execute hybrid('[...]', 'question', '{everyone}');
-- tools/hybrid-sql.ts runs it next to the code path for one question.
prepare hybrid(vector, text, text[]) as
with vector_leg as (
  select id, row_number() over (order by embedding <=> $1) as rank
    from chunks
   where is_current and allowed_groups && $3
   order by embedding <=> $1
   limit 50
),
word_leg as (
  select c.id, row_number() over (order by ts_rank(c.tsv, q.q, 1) desc, c.id) as rank
    from chunks c,
         (select to_tsquery('simple', coalesce(string_agg(quote_literal(lexeme), ' | '), '')) as q
            from unnest(to_tsvector('english', $2))) as q
   where c.tsv @@ q.q and c.is_current and c.allowed_groups && $3
   order by ts_rank(c.tsv, q.q, 1) desc, c.id
   limit 50
)
select coalesce(v.id, w.id) as id,
       coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + w.rank), 0) as score,
       v.rank as vector_rank,
       w.rank as word_rank
  from vector_leg v
  full outer join word_leg w on v.id = w.id
 order by score desc
 limit 50;
