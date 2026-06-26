-- ultimatum-site — Brevo double opt-in schema.
-- Run once in Supabase SQL editor. Idempotent; safe to re-run. Existing rows stay valid.

-- ── book_waitlist: add DOI columns ─────────────────────────────
create table if not exists book_waitlist(
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'md',
  created_at timestamptz default now(),
  unique(email, source)
);

alter table book_waitlist add column if not exists status text not null default 'pending';
alter table book_waitlist add column if not exists confirmed_at timestamptz;
alter table book_waitlist add column if not exists brevo_contact_id bigint;

-- backfill any legacy nulls so old rows remain valid
update book_waitlist set status = 'pending' where status is null;

alter table book_waitlist drop constraint if exists book_waitlist_status_chk;
alter table book_waitlist add constraint book_waitlist_status_chk
  check (status in ('pending','confirmed'));

-- ── waitlists: per-source Brevo config ─────────────────────────
create table if not exists waitlists(
  source          text primary key,
  brevo_list_id   int  not null,
  doi_template_id int  not null,
  redirect_url    text not null,
  lang            text not null
);

insert into waitlists(source, brevo_list_id, doi_template_id, redirect_url, lang) values
  ('ultimatum-en', 3, 1, '/confirmed',    'en'),
  ('me',           3, 1, '/confirmed',    'en'),
  ('ultimatum-ru', 4, 2, '/ru/confirmed', 'ru'),
  ('md',           4, 2, '/ru/confirmed', 'ru')
on conflict (source) do update set
  brevo_list_id   = excluded.brevo_list_id,
  doi_template_id = excluded.doi_template_id,
  redirect_url    = excluded.redirect_url,
  lang            = excluded.lang;

-- ── RLS ────────────────────────────────────────────────────────
-- The public form still inserts via anon. All server-side writes
-- (upsert status, config lookup, webhook confirm) use the service-role
-- key, which bypasses RLS. No anon update/select is granted.
alter table book_waitlist enable row level security;
drop policy if exists "anon insert" on book_waitlist;
create policy "anon insert" on book_waitlist for insert to anon with check (true);

alter table waitlists enable row level security;  -- service-role only; no anon policy
