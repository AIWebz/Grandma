-- ============================================================================
-- Grandma AI — Supabase database setup
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Every table uses Row Level Security so each person can only reach their own
-- data (or their household's shared data). Plans can only be written by the
-- server (the Cloudflare Worker's payment webhooks), never by the browser.
-- ============================================================================

-- ---------- Personal data: one JSON document per collection ----------
create table if not exists public.user_data (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;

drop policy if exists "user_data: read own" on public.user_data;
drop policy if exists "user_data: insert own" on public.user_data;
drop policy if exists "user_data: update own" on public.user_data;
drop policy if exists "user_data: delete own" on public.user_data;
create policy "user_data: read own"   on public.user_data for select to authenticated using (auth.uid() = user_id);
create policy "user_data: insert own" on public.user_data for insert to authenticated with check (auth.uid() = user_id);
create policy "user_data: update own" on public.user_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_data: delete own" on public.user_data for delete to authenticated using (auth.uid() = user_id);

-- ---------- Subscriptions (read-only for users; written by webhooks) ----------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  period                 text,
  status                 text not null default 'active',
  current_period_end     timestamptz,
  source                 text,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own" on public.subscriptions for select to authenticated using (auth.uid() = user_id);
-- No insert/update/delete policies: only the service role (the worker) can write.

-- ---------- Households (Grandma Pro sharing) ----------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_data (
  household_id uuid        not null references public.households (id) on delete cascade,
  key          text        not null,
  value        jsonb       not null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, key)
);

create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid());
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_data enable row level security;

drop policy if exists "households: members read" on public.households;
create policy "households: members read" on public.households for select to authenticated using (public.is_household_member(id));

drop policy if exists "household_members: members read" on public.household_members;
create policy "household_members: members read" on public.household_members for select to authenticated using (public.is_household_member(household_id));

drop policy if exists "household_data: members read" on public.household_data;
drop policy if exists "household_data: members insert" on public.household_data;
drop policy if exists "household_data: members update" on public.household_data;
drop policy if exists "household_data: members delete" on public.household_data;
create policy "household_data: members read"   on public.household_data for select to authenticated using (public.is_household_member(household_id));
create policy "household_data: members insert" on public.household_data for insert to authenticated with check (public.is_household_member(household_id));
create policy "household_data: members update" on public.household_data for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "household_data: members delete" on public.household_data for delete to authenticated using (public.is_household_member(household_id));

-- Create a household (Grandma Pro only). Returns the new household.
create or replace function public.create_household(p_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare
  h public.households;
  code text;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  if not exists (
    select 1 from public.subscriptions
    where user_id = auth.uid() and plan = 'pro' and status in ('active', 'trialing')
      and (current_period_end is null or current_period_end > now() - interval '3 days')
  ) then
    raise exception 'Households are part of Grandma Pro.';
  end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'You are already in a household.';
  end if;
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  insert into public.households (name, owner_id, invite_code) values (trim(p_name), auth.uid(), code) returning * into h;
  insert into public.household_members (household_id, user_id, role) values (h.id, auth.uid(), 'owner');
  return h;
end;
$$;

-- Join with an invite code.
create or replace function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  select id into hid from public.households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'Invite code not found.'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'You are already in a household.';
  end if;
  if (select count(*) from public.household_members where household_id = hid) >= 8 then
    raise exception 'This household is full.';
  end if;
  insert into public.household_members (household_id, user_id, role) values (hid, auth.uid(), 'member');
  return hid;
end;
$$;

-- Leave; ownership passes on, and an empty household is removed.
create or replace function public.leave_household()
returns void language plpgsql security definer set search_path = public as $$
declare hid uuid; next_owner uuid;
begin
  select household_id into hid from public.household_members where user_id = auth.uid();
  if hid is null then return; end if;
  delete from public.household_members where household_id = hid and user_id = auth.uid();
  select user_id into next_owner from public.household_members where household_id = hid order by joined_at limit 1;
  if next_owner is null then
    delete from public.households where id = hid;
  else
    update public.household_members set role = 'owner' where household_id = hid and user_id = next_owner;
    update public.households set owner_id = next_owner where id = hid;
  end if;
end;
$$;

-- Delete my account (required by the App Store for apps with sign-up).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Please sign in.'; end if;
  perform public.leave_household();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.leave_household() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Photo storage (recipe cards, family photos) ----------
insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media: own or household read" on storage.objects;
drop policy if exists "media: own or household write" on storage.objects;
drop policy if exists "media: own or household update" on storage.objects;
drop policy if exists "media: own or household delete" on storage.objects;

create policy "media: own or household read" on storage.objects for select to authenticated using (
  bucket_id = 'media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'h' and public.is_household_member(((storage.foldername(name))[2])::uuid))
  )
);
create policy "media: own or household write" on storage.objects for insert to authenticated with check (
  bucket_id = 'media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'h' and public.is_household_member(((storage.foldername(name))[2])::uuid))
  )
);
create policy "media: own or household update" on storage.objects for update to authenticated using (
  bucket_id = 'media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'h' and public.is_household_member(((storage.foldername(name))[2])::uuid))
  )
);
create policy "media: own or household delete" on storage.objects for delete to authenticated using (
  bucket_id = 'media' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or ((storage.foldername(name))[1] = 'h' and public.is_household_member(((storage.foldername(name))[2])::uuid))
  )
);
