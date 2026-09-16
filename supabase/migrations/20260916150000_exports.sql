-- Goedkeuring vóór publicatie: enkel wat de gebruiker aanvinkt, verlaat de tool. Elke export wordt gelogd.
create table public.exports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  search      text not null,
  item_count  integer not null check (item_count > 0),
  items       jsonb not null
);
alter table public.exports enable row level security;
create policy "lezen" on public.exports for select to anon, authenticated using (true);
create policy "export toevoegen" on public.exports for insert to anon, authenticated with check (true);
