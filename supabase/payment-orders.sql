create extension if not exists pgcrypto;

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  telegram_user_id bigint not null references public.telegram_profile_accounts(telegram_user_id) on delete cascade,
  profile_id text not null references public.profile_visuals(profile_id) on delete cascade,
  plan_months smallint,
  amount_uah integer,
  status text not null default 'waiting_operator',
  operator_telegram_user_id bigint,
  receipt_received_at timestamptz,
  receipt_kind text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  details_sent_at timestamptz,
  payment_reported_at timestamptz,
  confirmed_at timestamptz,
  subscription_started_at timestamptz,
  subscription_expires_at timestamptz,
  rejected_at timestamptz,
  check (order_code ~ '^PAY-[A-Z2-9]{8}$'),
  constraint payment_orders_plan_price_check check (
    (plan_months is null and amount_uah is null)
    or (plan_months = 1 and amount_uah = 1200)
    or (plan_months = 2 and amount_uah = 2200)
    or (plan_months = 6 and amount_uah = 6000)
    or (plan_months = 12 and amount_uah = 11500)
  ),
  check (status in ('waiting_operator', 'waiting_payment', 'payment_reported', 'approved', 'rejected', 'cancelled')),
  check (receipt_kind is null or receipt_kind in ('photo', 'pdf', 'image'))
);

-- Идемпотентное обновление уже созданной таблицы. Старые закрытые заявки
-- остаются без тарифа, а все новые заявки создаются только после выбора.
alter table public.payment_orders add column if not exists plan_months smallint;
alter table public.payment_orders add column if not exists amount_uah integer;
alter table public.payment_orders add column if not exists subscription_started_at timestamptz;
alter table public.payment_orders add column if not exists subscription_expires_at timestamptz;

-- Срок подписки также хранится на профиле: приложение использует его как
-- точную границу доступа и не полагается на приблизительный фоновый cron.
alter table public.profile_visuals add column if not exists subscription_started_at timestamptz;
alter table public.profile_visuals add column if not exists subscription_expires_at timestamptz;

-- Незавершённые заявки переводятся на новые цены. Закрытые заявки сохраняют
-- историческую сумму, чтобы отчётность не переписывалась задним числом.
alter table public.payment_orders drop constraint if exists payment_orders_plan_price_check;

update public.payment_orders
set amount_uah = case plan_months when 2 then 2200 when 6 then 6000 else amount_uah end,
    updated_at = now()
where status in ('waiting_operator', 'waiting_payment', 'payment_reported')
  and ((plan_months = 2 and amount_uah = 2300) or (plan_months = 6 and amount_uah = 6800));

alter table public.payment_orders
  add constraint payment_orders_plan_price_check check (
    (plan_months is null and amount_uah is null)
    or (plan_months = 1 and amount_uah = 1200)
    or (plan_months = 2 and amount_uah = 2200)
    or (plan_months = 6 and amount_uah = 6000)
    or (plan_months = 12 and amount_uah = 11500)
    or (status in ('approved', 'rejected', 'cancelled') and plan_months = 2 and amount_uah = 2300)
    or (status in ('approved', 'rejected', 'cancelled') and plan_months = 6 and amount_uah = 6800)
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_orders'::regclass
      and conname = 'payment_orders_subscription_window_check'
  ) then
    alter table public.payment_orders
      add constraint payment_orders_subscription_window_check check (
        (subscription_started_at is null and subscription_expires_at is null)
        or (subscription_started_at is not null and subscription_expires_at is not null
            and subscription_expires_at > subscription_started_at)
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profile_visuals'::regclass
      and conname = 'profile_visuals_subscription_window_check'
  ) then
    alter table public.profile_visuals
      add constraint profile_visuals_subscription_window_check check (
        (subscription_started_at is null and subscription_expires_at is null)
        or (subscription_started_at is not null and subscription_expires_at is not null
            and subscription_expires_at > subscription_started_at)
      );
  end if;
end
$$;

create unique index if not exists payment_orders_one_active_per_user_idx
  on public.payment_orders(telegram_user_id)
  where status in ('waiting_operator', 'waiting_payment', 'payment_reported');

create index if not exists payment_orders_status_created_idx
  on public.payment_orders(status, created_at desc);

-- Публичное приложение читает эффективный режим через представление. Оно
-- использует серверное время PostgreSQL, поэтому уже истёкший режим 0 наружу
-- не возвращается даже при неверных часах на устройстве.
create or replace view public.profile_visuals_effective
with (security_invoker = true)
as
select
  profile_id,
  case
    when watermark_mode = 0
      and subscription_expires_at is not null
      and subscription_expires_at <= clock_timestamp()
    then 1
    else watermark_mode
  end as watermark_mode,
  subscription_expires_at
from public.profile_visuals;

grant select on public.profile_visuals_effective to anon, authenticated;

alter table public.payment_orders enable row level security;

-- Подтверждение выполняется одной транзакцией: заявка закрывается и режим
-- профиля меняется на компактный одновременно.
drop function if exists public.approve_payment_order(text, bigint);

create or replace function public.approve_payment_order(
  p_order_code text,
  p_operator_telegram_user_id bigint
)
returns table (
  order_code text,
  telegram_user_id bigint,
  profile_id text,
  plan_months smallint,
  amount_uah integer,
  status text,
  confirmed_at timestamptz,
  subscription_started_at timestamptz,
  subscription_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_order public.payment_orders%rowtype;
  approved_at timestamptz := date_trunc('second', clock_timestamp());
  expires_at timestamptz;
begin
  select * into selected_order
  from public.payment_orders
  where payment_orders.order_code = upper(trim(p_order_code))
  for update;

  if not found or selected_order.status <> 'payment_reported' then
    return;
  end if;

  if selected_order.receipt_received_at is null then
    raise exception 'Payment receipt is required before approval';
  end if;

  if selected_order.plan_months not in (1, 2, 6, 12) then
    raise exception 'Payment order has no valid subscription plan';
  end if;

  -- Календарный месяц считается от секунды подтверждения оператором:
  -- например, 09.10.2026 18:45:12 + 1 месяц = 09.11.2026 18:45:12.
  expires_at := (
    (approved_at at time zone 'Europe/Kyiv')
    + make_interval(months => selected_order.plan_months::integer)
  ) at time zone 'Europe/Kyiv';

  update public.profile_visuals
  set watermark_mode = 0,
      subscription_started_at = approved_at,
      subscription_expires_at = expires_at,
      updated_at = approved_at
  where profile_visuals.profile_id = selected_order.profile_id;

  if not found then
    raise exception 'Profile for payment order was not found';
  end if;

  update public.payment_orders
  set status = 'approved',
      operator_telegram_user_id = p_operator_telegram_user_id,
      confirmed_at = approved_at,
      subscription_started_at = approved_at,
      subscription_expires_at = expires_at,
      updated_at = approved_at
  where payment_orders.id = selected_order.id;

  return query
  select p.order_code, p.telegram_user_id, p.profile_id, p.plan_months, p.amount_uah, p.status,
         p.confirmed_at, p.subscription_started_at, p.subscription_expires_at
  from public.payment_orders p
  where p.id = selected_order.id;
end;
$$;

revoke all on table public.payment_orders from anon, authenticated;
grant select, insert, update, delete on table public.payment_orders to service_role;
revoke all on function public.approve_payment_order(text, bigint) from public, anon, authenticated;
grant execute on function public.approve_payment_order(text, bigint) to service_role;

-- Таблица закрыта для клиента. Её читают только Edge Functions с service role.
