-- LookBlog keeps every record (a user, a post, a message…) as one JSON document.
-- seq goes up on every write, so each server can fetch only what changed since it last looked.
create sequence if not exists public.docs_seq;

create table if not exists public.docs (
  coll    text    not null,             -- the collection: users, posts, messages…
  id      text    not null,             -- the record's id inside it
  data    jsonb,                         -- the record (null once deleted)
  deleted boolean not null default false,
  seq     bigint  not null default 0,
  primary key (coll, id)
);
create index if not exists docs_seq_idx on public.docs (seq);

create or replace function public.docs_bump() returns trigger language plpgsql as $$
begin
  new.seq := nextval('public.docs_seq');
  return new;
end $$;
drop trigger if exists docs_bump on public.docs;
create trigger docs_bump before insert or update on public.docs for each row execute function public.docs_bump();

-- Only the LookBlog server (secret key) can read or write. Nobody else, not even with the public key.
alter table public.docs enable row level security;
revoke all on public.docs from anon, authenticated;
