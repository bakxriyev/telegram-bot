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
  created_at timestamptz default now(),
  source text
);

create index if not exists idx_users_telegram_id on users (telegram_id);
create index if not exists idx_users_is_active on users (is_active);
create index if not exists idx_users_created_at on users (created_at);
create index if not exists idx_users_source on users (source);

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
  source text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_start_messages_is_active on start_messages (is_active);
create index if not exists idx_start_messages_source on start_messages (source);

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

-- ---------------------------------------------------------
-- 9. progrev_messages — /start dan keyin interval bilan yuboriladigan
--    "progrev" (drip) postlar. Har bir user O'ZINING start vaqtidan
--    nisbatan oladi: scheduled_at = user_start + delay.
--    Faqat nisbiy vaqt (kun/soat/daqiqa) — aniq sana YO'Q.
-- ---------------------------------------------------------
create table if not exists progrev_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel_id bigint not null,
  message_id bigint not null,
  delay_days integer not null default 0
    constraint progrev_messages_delay_days_check
    check (delay_days >= 0 and delay_days <= 365),
  delay_hours integer not null default 0
    constraint progrev_messages_delay_hours_check
    check (delay_hours >= 0 and delay_hours <= 23),
  delay_minutes integer not null default 0
    constraint progrev_messages_delay_minutes_check
    check (delay_minutes >= 0 and delay_minutes <= 59),
  is_active boolean default true,
  keyboard_buttons jsonb default '[]'::jsonb,
  caption_text text,
  content_type text,
  file_id text,
  source text not null,
  sent_count integer default 0,
  failed_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_progrev_messages_is_active on progrev_messages (is_active);
create index if not exists idx_progrev_messages_created_at on progrev_messages (created_at);
create index if not exists idx_progrev_messages_source on progrev_messages (source);

-- ---------------------------------------------------------
-- 10. progrev_sends — qaysi userga qaysi progrev qachon yuborilishi.
--     Bot restart bo'lsa ham yo'qolmaydi: scheduler scheduled_at
--     o'tgan pending'larni keyingi tick'da yuboradi.
-- ---------------------------------------------------------
create table if not exists progrev_sends (
  id uuid primary key default gen_random_uuid(),
  progrev_id uuid references progrev_messages(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  status text default 'pending'
    constraint progrev_sends_status_check
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  attempts integer default 0,
  error_message text,
  created_at timestamptz default now(),
  constraint uq_progrev_send unique (progrev_id, user_id)
);

create index if not exists idx_progrev_sends_status_scheduled on progrev_sends (status, scheduled_at);
create index if not exists idx_progrev_sends_user_id on progrev_sends (user_id);
create index if not exists idx_progrev_sends_progrev_id on progrev_sends (progrev_id);

drop trigger if exists trg_progrev_messages_updated_at on progrev_messages;
create trigger trg_progrev_messages_updated_at
  before update on progrev_messages
  for each row execute function set_updated_at();

alter table progrev_messages enable row level security;
alter table progrev_sends enable row level security;

-- ---------------------------------------------------------
-- 11. Progrev interval o'zgarganda kutilayotgan rejalarni siljitish.
--     Har bir send uchun: scheduled_at = scheduled_at + delta.
--     Bitta atomar so'rov — 50 ming qator bo'lsa ham tez.
-- ---------------------------------------------------------
create or replace function shift_progrev_pending_schedule(p_progrev_id uuid, p_delta_ms bigint)
returns integer as $$
declare
  v_count integer;
begin
  update progrev_sends
  set scheduled_at = scheduled_at + make_interval(secs => (p_delta_ms::double precision / 1000))
  where progrev_id = p_progrev_id and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------
-- 12. SOURCE bo'yicha ajratish (VSL1-VSL10 + Instagram)
--     Mavjud bazaga xavfsiz migratsiya: ustun bo'lmasa qo'shadi.
--     Supabase SQL Editor'da shu faylni to'liq qayta yurgizsangiz ham
--     xatolik bermaydi (IF NOT EXISTS).
-- ---------------------------------------------------------
alter table users add column if not exists source text;
alter table start_messages add column if not exists source text not null default 'instagram';
alter table progrev_messages add column if not exists source text not null default 'instagram';

-- Default'ni olib tashlamaymiz (yangi qatorlar uchun qulay), lekin
-- eski qatorlarda source bo'sh bo'lsa instagram deb hisoblaymiz:
update users set source = 'instagram' where source is null;

create index if not exists idx_users_source on users (source);
create index if not exists idx_start_messages_source on start_messages (source);
create index if not exists idx_progrev_messages_source on progrev_messages (source);

-- ---------------------------------------------------------
-- 13. VSL guruhlash: vsl1..vsl10 → bitta 'vsl'
--     Endi atigi 2 xil source bor: 'vsl' va 'instagram'.
--     Hamma VSL linklar uchun bitta start xabar + bitta progrev.
-- ---------------------------------------------------------
update users set source = 'vsl' where lower(source) like 'vsl%';
update start_messages set source = 'vsl' where lower(source) like 'vsl%';
update progrev_messages set source = 'vsl' where lower(source) like 'vsl%';
