-- GeoID membership schema.
--
-- Run this once in the Supabase SQL editor. It creates the `memberships`
-- table that mirrors Stripe subscription state per user.
--
-- One row per user; the row is upserted by the Stripe webhook on every
-- subscription event. The viewer paywall reads from this table via the
-- anon role (read-only) so the frontend can answer "is this user paid?".

-- ─────────────────────────────────────────────────────────────────────────
-- 1. memberships table
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.memberships (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  email                text,
  stripe_customer_id   text unique,
  stripe_subscription_id text,
  status               text,                  -- raw Stripe status: active, trialing, past_due, canceled, etc.
  active               boolean not null default false,  -- derived: status in ('active','trialing')
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at           timestamptz not null default now()
);

comment on table public.memberships is 'GeoID member subscription state, mirrored from Stripe via webhook.';

create index if not exists memberships_email_idx     on public.memberships (email);
create index if not exists memberships_customer_idx  on public.memberships (stripe_customer_id);
create index if not exists memberships_active_idx    on public.memberships (active);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Row-level security
-- ─────────────────────────────────────────────────────────────────────────
alter table public.memberships enable row level security;

-- Users may read only their own row. The frontend uses the anon key + the
-- signed-in session JWT, so auth.uid() resolves to the logged-in user.
drop policy if exists "members read own row" on public.memberships;
create policy "members read own row"
  on public.memberships for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy → only the service role (used by the
-- Stripe webhook Edge Function) can mutate this table. The anon role
-- cannot fabricate membership rows from the browser.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Auto-create a placeholder row when a user signs up
-- ─────────────────────────────────────────────────────────────────────────
-- This makes the front-end query simpler (`maybeSingle` is fine, but a row
-- always exists). The webhook later upserts real Stripe data into the
-- same row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.memberships (user_id, email, active)
  values (new.id, new.email, false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Touch updated_at on any change
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists memberships_touch_updated_at on public.memberships;
create trigger memberships_touch_updated_at
  before update on public.memberships
  for each row execute procedure public.touch_updated_at();
