# Подключение облака

Оба канала опциональны. Без ключей приложение работает как локальный журнал: все данные в
IndexedDB, доступны экспорт JSON и Excel.

## 1. Supabase и Яндекс ID

### 1.1 Проект и схема

1. Создайте проект на [supabase.com](https://supabase.com) (бесплатного тарифа достаточно).
2. В **SQL Editor** выполните целиком [`supabase/schema.sql`](../supabase/schema.sql). Скрипт
   идемпотентен: таблицы, индексы, RLS, триггеры и RPC `sync_upsert`.
3. Возьмите **Project URL** и **anon public key** в Settings → API. Service role key в браузер
   не попадает.

### 1.2 OAuth-приложение Яндекса

1. [oauth.yandex.ru](https://oauth.yandex.ru) → «Создать приложение».
2. Платформа — **Веб-сервисы**.
3. Redirect URI:

   ```
   https://<project-ref>.supabase.co/functions/v1/yandex-oauth/callback
   ```

4. Доступы: `login:email`, `login:info`.
5. Запомните Client ID и Client secret.

### 1.3 Edge Function

Из корня репозитория (нужен [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase login
supabase link --project-ref <project-ref>

supabase secrets set \
  YANDEX_CLIENT_ID=<client-id> \
  YANDEX_CLIENT_SECRET=<client-secret> \
  OAUTH_STATE_SECRET=<случайная строка 32+ символа> \
  APP_URL=https://ezy4me.github.io/web-gradebook/

# SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY функция получает от платформы.
supabase functions deploy yandex-oauth --no-verify-jwt
```

`APP_URL` — куда вернуть браузер после входа. Для локальной разработки:

```bash
supabase secrets set APP_URL=http://127.0.0.1:5173/web-gradebook/
```

### 1.4 Ключи сборки

Локально — `.env.local`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

На GitHub Pages — Settings → Secrets and variables → Actions → **Variables**:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_YANDEX_CLIENT_ID` (последний нужен только
для документации OAuth-приложения и в клиенте не используется).

### 1.5 Как это работает

- Вход: приложение открывает `/functions/v1/yandex-oauth/start`, функция ведёт в Яндекс, затем
  возвращает `#/auth?token_hash=…`; клиент вызывает `verifyOtp` и получает обычную сессию Supabase.
- Pull: чтение всех строк пользователя (RLS `auth.uid() = user_id`), слияние по `updatedAt`.
- Push: только «грязные» сторы через RPC `sync_upsert`; сервер обновляет строку, лишь если
  присланная версия новее.
- Удаление — soft-delete (`deletedAt`), поэтому уезжает в облако и не возвращается.
- PIN и тема не синхронизируются.

## 2. Google Drive

1. [Google Cloud Console](https://console.cloud.google.com) → новый проект.
2. APIs & Services → Library → включите **Google Drive API**.
3. OAuth consent screen: External, добавьте себя в Test users (или опубликуйте приложение).
4. Credentials → Create credentials → **OAuth client ID** → Web application.
5. Authorized JavaScript origins:

   ```
   https://ezy4me.github.io
   http://127.0.0.1:5173
   ```

   Redirect URI не нужен: используется token flow Google Identity Services.
6. Скопируйте Client ID в переменную сборки `VITE_GOOGLE_CLIENT_ID` (локально `.env.local`, на
   GitHub — Actions variable).

Приложение запрашивает только `https://www.googleapis.com/auth/drive.appdata`: доступны лишь
файлы в скрытой папке приложения, остальной Диск не виден. Токен живёт час и хранится в
`sessionStorage`; refresh-token в браузере не используется.

## 3. Проверка

```bash
npm run dev
```

- **Настройки → Supabase**: «войти» → Яндекс ID → после возврата статус «синхронизировано».
- **Настройки → Google Drive**: «Подключить» → выбор аккаунта → «Сохранить».
- Офлайн-проверка: отключите сеть, поставьте балл, включите сеть — статус вернётся в
  «синхронизировано», изменение уйдёт в облако.

Если Supabase отвечает ошибкой `function sync_upsert does not exist`, повторно выполните
`supabase/schema.sql`: в старых базах не хватает RPC и таблицы `group_members`.

## 4. Ограничения

- Часы устройств могут расходиться; LWW сравнивает клиентские `updated_at`, поэтому при сильном
  расхождении побеждает устройство с «будущим» временем.
- Google Drive — не канал синхронизации: файл перезаписывается целиком, при одновременной работе
  двух устройств побеждает последняя запись.
- Бесплатный Supabase засыпает после недели простоя; workflow
  `.github/workflows/supabase-keepalive.yml` будит его раз в сутки (нужны secrets
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`).
