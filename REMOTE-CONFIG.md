# Удалённый переключатель водяного знака

Приложение читает одну строку `public.app_config` в Supabase:

- `watermark_mode = 1` — крупная отметка;
- `watermark_mode = 0` — компактная отметка;
- если база или сеть недоступна — автоматически используется `1`.

Оба режима оставляют на карточке, полном просмотре и PDF видимое предупреждение, что это демонстрация, а не официальный документ.

## 1. Создание таблицы

В Supabase откройте **SQL Editor**, создайте новый запрос и выполните:

```sql
create table if not exists public.app_config (
  id text primary key,
  watermark_mode smallint not null default 1 check (watermark_mode in (0, 1)),
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists "public read main app config" on public.app_config;

create policy "public read main app config"
on public.app_config for select
to anon
using (id = 'main');

insert into public.app_config (id, watermark_mode)
values ('main', 1)
on conflict (id) do update
set watermark_mode = excluded.watermark_mode,
    updated_at = now();
```

Политика разрешает приложению только чтение строки `main`. Публичную запись не включайте.

## 2. Подключение к публикации

В репозитории GitHub откройте **Settings → Secrets and variables → Actions → New repository secret** и создайте:

- `NEXT_PUBLIC_SUPABASE_URL` — Project URL из Supabase;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — только публичный `anon` key.

Никогда не используйте здесь `service_role` key. После добавления значений повторно запустите **Actions → Publish demo to Pages → Run workflow**.

## 3. Как менять размер

В Supabase откройте **Table Editor → app_config → main**, измените `watermark_mode` на `1` или `0` и сохраните. При следующем полном открытии приложения значение загрузится из базы. Если веб-приложение уже открыто, закройте его и откройте снова.
