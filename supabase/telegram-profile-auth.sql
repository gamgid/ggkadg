create table if not exists public.telegram_profile_accounts (
  telegram_user_id bigint primary key,
  profile_id text not null unique references public.profile_visuals(profile_id) on delete cascade,
  telegram_first_name text,
  telegram_last_name text,
  telegram_username text,
  login_code_hash text,
  login_code_expires_at timestamptz,
  session_token_hash text unique,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (profile_id like 'DEMO-%'),
  check (login_code_hash is null or login_code_hash ~ '^[0-9a-f]{64}$'),
  check (session_token_hash is null or session_token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.telegram_profile_accounts
  add column if not exists telegram_first_name text,
  add column if not exists telegram_last_name text,
  add column if not exists telegram_username text,
  add column if not exists last_login_at timestamptz;

create index if not exists telegram_profile_accounts_login_code_hash_idx
  on public.telegram_profile_accounts(login_code_hash)
  where login_code_hash is not null;

alter table public.telegram_profile_accounts enable row level security;

-- No anon/authenticated policies are created intentionally. Only Edge Functions
-- using SUPABASE_SERVICE_ROLE_KEY may read or change Telegram links and hashes.
