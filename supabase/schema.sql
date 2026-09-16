-- =========================================================
-- Telegram Bot — Supabase Schema
-- Admin boshqaruvi alohida jadvalsiz, faqat .env ADMIN_IDS
-- orqali amalga oshiriladi (bot ichida tekshiriladi).
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- 1. users
-- ---------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  is_active boolean default true,
  started_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_users_telegram_id on users (telegram_id);
create index if not exists idx_users_is_active on users (is_active);
create index if not exists idx_users_created_at on users (created_at);

-- ---------------------------------------------------------
-- 2. start_messages
-- ---------------------------------------------------------
create table if not exists start_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel_id bigint not null,
  message_id bigint not null,
  is_active boolean default false,
  activated_at timestamptz,
  keyboard_buttons jsonb default '[]'::jsonb,
  caption_text text,
  content_type text,
  file_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_start_messages_is_active on start_messages (is_active);

-- ---------------------------------------------------------
-- 3. broadcasts
-- ---------------------------------------------------------
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  channel_id bigint not null,
  message_id bigint not null,
  status text not null default 'pending'
    constraint broadcasts_status_check
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  total_users integer default 0,
  success_count integer default 0,
  failed_count integer default 0,
  caption_text text,
  content_type text,
  file_id text,
  keyboard_buttons jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz,
  scheduled_at timestamptz
);

create index if not exists idx_broadcasts_status on broadcasts (status);
create index if not exists idx_broadcasts_created_at on broadcasts (created_at);

-- ---------------------------------------------------------
-- 4. broadcast_recipients
-- ---------------------------------------------------------
create table if not exists broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid references broadcasts(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  status text default 'pending'
    constraint broadcast_recipients_status_check
    check (status in ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  constraint uq_broadcast_recipient unique (broadcast_id, user_id)
);

create index if not exists idx_broadcast_recipients_broadcast_id on broadcast_recipients (broadcast_id);
create index if not exists idx_broadcast_recipients_user_id on broadcast_recipients (user_id);
create index if not exists idx_broadcast_recipients_status on broadcast_recipients (status);

-- ---------------------------------------------------------
-- 5. settings (kelajakda kengaytirish uchun)
-- ---------------------------------------------------------
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------
-- 6. updated_at avtomatik yangilanishi uchun trigger
-- ---------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

drop trigger if exists trg_start_messages_updated_at on start_messages;
create trigger trg_start_messages_updated_at
  before update on start_messages
  for each row execute function set_updated_at();

drop trigger if exists trg_settings_updated_at on settings;
create trigger trg_settings_updated_at
  before update on settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------
-- 7. Start message aktivlashtirish/tog'rlash RPC
--     Bir nechta start_message bir vaqtda aktiv bo'lishi mumkin
-- ---------------------------------------------------------
create or replace function activate_start_message(p_id uuid)
returns void as $$
begin
  update start_messages set is_active = true, activated_at = now() where id = p_id;
end;
$$ language plpgsql security definer;

create or replace function set_start_message_active(p_id uuid, p_active boolean)
returns void as $$
begin
  if p_active then
    update start_messages set is_active = true, activated_at = now() where id = p_id;
  else
    update start_messages set is_active = false, activated_at = null where id = p_id;
  end if;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------
-- 7b. Atomic broadcast counter increment (avoids read-modify-write races
--     when batches update the same broadcast row concurrently)
-- ---------------------------------------------------------
create or replace function increment_broadcast_counters(p_id uuid, p_success int, p_failed int)
returns void as $$
begin
  update broadcasts
  set success_count = success_count + p_success,
      failed_count = failed_count + p_failed
  where id = p_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------
-- 8. Row Level Security
-- Bot faqat SERVICE_ROLE_KEY bilan ishlaydi (RLS'ni bypass qiladi).
-- Anon/public kirish butunlay yopiq — hech qanday policy yaratilmaydi.
-- ---------------------------------------------------------
alter table users enable row level security;
alter table start_messages enable row level security;
alter table broadcasts enable row level security;
alter table broadcast_recipients enable row level security;
alter table settings enable row level security;

-- Policy yaratilmagani uchun anon/authenticated rollar hech narsaga
-- kira olmaydi. Faqat service_role (RLS'ni bypass qiladi) ishlay oladi.
