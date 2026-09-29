# Визуал для каждого профиля

Приложение читает отдельную строку `public.profile_visuals` для ID текущего демонстрационного профиля:

- `watermark_mode = 1` — крупная отметка;
- `watermark_mode = 0` — компактная отметка;
- если строки для профиля нет, база или сеть недоступна — автоматически используется `1`.

Имя человека в привязке не используется: оно может измениться. Стабильным ключом служит локальный ID вида `DEMO-12345678`, который показан в настройках приложения.

Оба режима оставляют на карточке, полном просмотре и PDF видимое предупреждение, что это демонстрация, а не официальный документ.

## 1. Создание таблицы

В Supabase откройте **SQL Editor**, создайте новый запрос и выполните:

```sql
create table if not exists public.profile_visuals (
  profile_id text primary key,
  watermark_mode smallint not null default 1 check (watermark_mode in (0, 1)),
  updated_at timestamptz not null default now(),
  check (profile_id like 'DEMO-%')
);

alter table public.profile_visuals enable row level security;

drop policy if exists "public read profile visuals" on public.profile_visuals;

create policy "public read profile visuals"
on public.profile_visuals for select
to anon
using (profile_id like 'DEMO-%');
```

Политика разрешает приложению только чтение DEMO-настроек. Публичную запись не включайте. Старая строка `app_config/main` больше не используется; удалять её необязательно.

## 2. Добавление людей

Для каждого профиля добавьте отдельную строку. Подставьте ID, показанный в **Меню → Налаштування → Демонстраційний режим**:

```sql
insert into public.profile_visuals (profile_id, watermark_mode)
values
  ('DEMO-12345678', 1),
  ('DEMO-87654321', 0)
on conflict (profile_id) do update
set watermark_mode = excluded.watermark_mode,
    updated_at = now();
```

В примере у первого человека крупный визуал, у второго — компактный. Замените примерные ID на реальные ID профилей.

## 3. Подключение к публикации

Существующие секреты GitHub остаются теми же:

- `NEXT_PUBLIC_SUPABASE_URL` — Project URL из Supabase вида `https://PROJECT_REF.supabase.co` (без `/rest/v1`);
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — публичный **Publishable key** (`sb_publishable_…`) или старый публичный `anon` key.

Никогда не используйте здесь `service_role` key. После публикации обновлённого кода дополнительные секреты не нужны.

Приложение отправляет публичный ключ только в заголовке `apikey`. Новый Publishable key не является JWT, поэтому его нельзя дублировать в `Authorization: Bearer` — Supabase отклонит такой запрос как `Invalid JWT`.

## 4. Как менять визуал человека

В Supabase откройте **Table Editor → profile_visuals**, найдите строку по `profile_id`, измените `watermark_mode` на `1` или `0` и сохраните. Открытое приложение перечитает значение при возвращении на экран, фокусе окна или автоматически в течение 30 секунд.
