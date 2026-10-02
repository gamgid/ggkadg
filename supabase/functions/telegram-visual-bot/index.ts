type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type ProfileVisual = {
  profile_id: string;
  watermark_mode: 0 | 1;
};

type ProfileAccount = {
  telegram_user_id: number;
  profile_id: string;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_username: string | null;
  created_at: string;
  last_login_at: string | null;
};

const BOT_TOKEN = requiredEnv("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = requiredEnv("TELEGRAM_WEBHOOK_SECRET");
const SUPABASE_URL = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_IDS = new Set(
  requiredEnv("TELEGRAM_ADMIN_IDS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PROFILE_ID_PATTERN = /^DEMO-[A-Z0-9-]{4,40}$/;
const LOGIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function isAdmin(userId: number | undefined): boolean {
  return userId !== undefined && ADMIN_IDS.has(String(userId));
}

function normalizeProfileId(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return PROFILE_ID_PATTERN.test(normalized) ? normalized : null;
}

function supabaseHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function telegram(method: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Telegram API request failed: ${response.status}`);
  }
}

function randomCharacters(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => LOGIN_ALPHABET[byte % LOGIN_ALPHABET.length]).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function getAccount(telegramUserId: number): Promise<ProfileAccount | null> {
  const query = new URLSearchParams({
    select: "telegram_user_id,profile_id,telegram_first_name,telegram_last_name,telegram_username,created_at,last_login_at",
    telegram_user_id: `eq.${telegramUserId}`,
    limit: "1",
  });
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query.toString()}`,
    { headers: supabaseHeaders() },
  );
  if (!response.ok) throw new Error(`Account lookup failed: ${response.status}`);
  const rows = await response.json() as ProfileAccount[];
  return rows[0] ?? null;
}

async function getAccountByProfileId(profileId: string): Promise<ProfileAccount | null> {
  const query = new URLSearchParams({
    select: "telegram_user_id,profile_id,telegram_first_name,telegram_last_name,telegram_username,created_at,last_login_at",
    profile_id: `eq.${profileId}`,
    limit: "1",
  });
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query.toString()}`,
    { headers: supabaseHeaders() },
  );
  if (!response.ok) throw new Error(`Account profile lookup failed: ${response.status}`);
  const rows = await response.json() as ProfileAccount[];
  return rows[0] ?? null;
}

function telegramIdentity(user: TelegramUser): Record<string, string | null> {
  return {
    telegram_first_name: user.first_name?.trim() || null,
    telegram_last_name: user.last_name?.trim() || null,
    telegram_username: user.username?.trim() || null,
  };
}

async function createAccount(user: TelegramUser): Promise<ProfileAccount> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const profileId = `DEMO-${randomCharacters(8)}`;
    const visualResponse = await fetch(`${SUPABASE_URL}/rest/v1/profile_visuals`, {
      method: "POST",
      headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ profile_id: profileId, watermark_mode: 1 }),
    });
    if (visualResponse.status === 409) continue;
    if (!visualResponse.ok) throw new Error(`Profile creation failed: ${visualResponse.status}`);

    const accountResponse = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts`, {
      method: "POST",
      headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ telegram_user_id: user.id, profile_id: profileId, ...telegramIdentity(user) }),
    });
    if (accountResponse.ok) {
      const rows = await accountResponse.json() as ProfileAccount[];
      if (rows[0]) return rows[0];
    }

    await fetch(`${SUPABASE_URL}/rest/v1/profile_visuals?profile_id=eq.${profileId}`, {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    if (accountResponse.status === 409) {
      const existing = await getAccount(user.id);
      if (existing) return existing;
    }
    throw new Error(`Account creation failed: ${accountResponse.status}`);
  }
  throw new Error("Could not allocate a unique profile ID");
}

async function issueLoginCode(user: TelegramUser): Promise<{ account: ProfileAccount; code: string }> {
  const account = await getAccount(user.id) ?? await createAccount(user);
  const raw = randomCharacters(8);
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const query = new URLSearchParams({ telegram_user_id: `eq.${user.id}` });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query.toString()}`, {
    method: "PATCH",
    headers: supabaseHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      login_code_hash: await sha256(code),
      login_code_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      ...telegramIdentity(user),
    }),
  });
  if (!response.ok) throw new Error(`Login code update failed: ${response.status}`);
  return { account, code };
}

async function configureWebhook(): Promise<void> {
  await telegram("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/telegram-visual-bot`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
}

async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  await telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function getProfile(profileId: string): Promise<ProfileVisual | null> {
  const query = new URLSearchParams({
    select: "profile_id,watermark_mode",
    profile_id: `eq.${profileId}`,
    limit: "1",
  });
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profile_visuals?${query.toString()}`,
    { headers: supabaseHeaders() },
  );

  if (!response.ok) throw new Error(`Supabase profile lookup failed: ${response.status}`);
  const rows = (await response.json()) as ProfileVisual[];
  return rows[0] ?? null;
}

async function listProfiles(): Promise<ProfileVisual[]> {
  const query = new URLSearchParams({
    select: "profile_id,watermark_mode",
    order: "profile_id.asc",
    limit: "25",
  });
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profile_visuals?${query.toString()}`,
    { headers: supabaseHeaders() },
  );

  if (!response.ok) throw new Error(`Supabase profile list failed: ${response.status}`);
  return (await response.json()) as ProfileVisual[];
}

async function listAccounts(): Promise<ProfileAccount[]> {
  const query = new URLSearchParams({
    select: "telegram_user_id,profile_id,telegram_first_name,telegram_last_name,telegram_username,created_at,last_login_at",
    order: "created_at.desc",
    limit: "20",
  });
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query.toString()}`,
    { headers: supabaseHeaders() },
  );
  if (!response.ok) throw new Error(`Account list failed: ${response.status}`);
  return await response.json() as ProfileAccount[];
}

async function setProfileMode(profileId: string, mode: 0 | 1): Promise<ProfileVisual | null> {
  const query = new URLSearchParams({ profile_id: `eq.${profileId}` });
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profile_visuals?${query.toString()}`,
    {
      method: "PATCH",
      headers: supabaseHeaders({
        "content-type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify({ watermark_mode: mode, updated_at: new Date().toISOString() }),
    },
  );

  if (!response.ok) throw new Error(`Supabase profile update failed: ${response.status}`);
  const rows = (await response.json()) as ProfileVisual[];
  return rows[0] ?? null;
}

function profileKeyboard(profile: ProfileVisual): Record<string, unknown> {
  return {
    inline_keyboard: [[
      {
        text: `${profile.watermark_mode === 0 ? "✅ " : ""}0 · компактно`,
        callback_data: `visual|0|${profile.profile_id}`,
      },
      {
        text: `${profile.watermark_mode === 1 ? "✅ " : ""}1 · крупно`,
        callback_data: `visual|1|${profile.profile_id}`,
      },
    ]],
  };
}

function profileText(profile: ProfileVisual, changed = false): string {
  const modeName = profile.watermark_mode === 0 ? "компактная маркировка" : "крупная маркировка";
  return `${changed ? "Изменено" : "Профиль"}: ${profile.profile_id}\nРежим: ${profile.watermark_mode} — ${modeName}`;
}

function accountName(account: ProfileAccount): string {
  const fullName = [account.telegram_first_name, account.telegram_last_name].filter(Boolean).join(" ");
  return fullName.slice(0, 80) || "Имя не указано";
}

function accountUsername(account: ProfileAccount): string {
  return account.telegram_username ? `@${account.telegram_username}` : "без @username";
}

function compactDate(value: string | null): string {
  return value ? value.replace("T", " ").slice(0, 16) + " UTC" : "ещё не входил";
}

function accountDetails(account: ProfileAccount): string {
  return [
    `Владелец: ${accountName(account)} (${accountUsername(account)})`,
    `Telegram ID: ${account.telegram_user_id}`,
    `Регистрация: ${compactDate(account.created_at)}`,
    `Последний вход: ${compactDate(account.last_login_at)}`,
  ].join("\n");
}

function accountListLine(account: ProfileAccount): string {
  return `${account.profile_id} — ${accountName(account)} (${accountUsername(account)}) — вход: ${compactDate(account.last_login_at)}`;
}

async function showProfile(chatId: number, profileId: string): Promise<void> {
  const [profile, account] = await Promise.all([getProfile(profileId), getAccountByProfileId(profileId)]);
  if (!profile) {
    await sendMessage(chatId, `Профиль ${profileId} не найден в profile_visuals.`);
    return;
  }
  const details = account ? `\n\n${accountDetails(account)}` : "\n\nВладелец Telegram пока не привязан.";
  await sendMessage(chatId, `${profileText(profile)}${details}`, profileKeyboard(profile));
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const text = message.text?.trim() ?? "";
  if (/^\/(start|help)(?:@\w+)?$/i.test(text)) {
    if (!message.from?.id) return;
    const { account, code } = await issueLoginCode(message.from);
    await sendMessage(
      message.chat.id,
      `Ваш одноразовый код для входа:\n\n${code}\n\nВведите его в приложении в течение 10 минут. Ваш постоянный ID профиля: ${account.profile_id}.${isAdmin(message.from.id) ? "\n\nДля управления пришлите ID профиля. /users — пользователи, /profiles — все профили." : ""}`,
    );
    return;
  }

  if (!isAdmin(message.from?.id)) {
    await sendMessage(message.chat.id, "Отправьте /start, чтобы получить новый одноразовый код для входа.");
    return;
  }

  if (/^\/profiles(?:@\w+)?$/i.test(text)) {
    const profiles = await listProfiles();
    const lines = profiles.map((profile) => `${profile.profile_id} — ${profile.watermark_mode}`);
    await sendMessage(
      message.chat.id,
      lines.length ? `Профили:\n${lines.join("\n")}` : "В profile_visuals пока нет профилей.",
    );
    return;
  }

  if (/^\/users(?:@\w+)?$/i.test(text)) {
    const accounts = await listAccounts();
    const lines = accounts.map(accountListLine);
    await sendMessage(
      message.chat.id,
      lines.length ? `Пользователи (до 20 последних):\n\n${lines.join("\n")}` : "Пользователей пока нет.",
    );
    return;
  }

  const profileArgument = text.replace(/^\/profile(?:@\w+)?\s+/i, "");
  const profileId = normalizeProfileId(profileArgument);
  if (!profileId) {
    await sendMessage(message.chat.id, "Нужен ID вида DEMO-57392817.");
    return;
  }

  await showProfile(message.chat.id, profileId);
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<void> {
  if (!isAdmin(callback.from.id)) return;

  const [action, rawMode, rawProfileId] = callback.data?.split("|") ?? [];
  const profileId = rawProfileId ? normalizeProfileId(rawProfileId) : null;
  const mode = rawMode === "0" ? 0 : rawMode === "1" ? 1 : null;
  if (action !== "visual" || mode === null || !profileId) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Некорректная команда",
      show_alert: true,
    });
    return;
  }

  const updated = await setProfileMode(profileId, mode);
  if (!updated) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Профиль не найден",
      show_alert: true,
    });
    return;
  }

  await telegram("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: `Режим ${mode} установлен`,
  });

  if (callback.message) {
    const account = await getAccountByProfileId(updated.profile_id);
    const details = account ? `\n\n${accountDetails(account)}` : "\n\nВладелец Telegram пока не привязан.";
    await telegram("editMessageText", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: `${profileText(updated, true)}${details}`,
      reply_markup: profileKeyboard(updated),
    });
  }
}

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("setup") === "webhook") {
    try {
      await configureWebhook();
      return new Response("Telegram webhook configured. You can close this page.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Webhook setup failed");
      return new Response("Webhook setup failed. Check Edge Function logs.", { status: 502 });
    }
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(suppliedSecret, WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    return new Response("ok");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unhandled bot error");
    return new Response("ok");
  }
});
