type TelegramUser = { id: number };

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
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

const BOT_TOKEN = requiredEnv("TELEGRAM_ADMIN_BOT_TOKEN");
const WEBHOOK_SECRET = requiredEnv("TELEGRAM_ADMIN_WEBHOOK_SECRET");
const SUPABASE_URL = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_IDS = new Set(
  requiredEnv("TELEGRAM_ADMIN_IDS").split(",").map(value => value.trim()).filter(Boolean),
);
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PROFILE_ID_PATTERN = /^DEMO-[A-Z0-9-]{4,40}$/;
const USERS_BUTTON = "👥 Пользователи";
const PROFILES_BUTTON = "🪪 Профили";
const SEARCH_BUTTON = "🔎 Найти профиль";
const HELP_BUTTON = "❓ Справка";
const MENU_BUTTON = "🏠 Главное меню";

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
  if (!response.ok) throw new Error(`Telegram API request failed: ${response.status}`);
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

async function configureWebhook(): Promise<void> {
  await telegram("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/telegram-admin-bot`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "Открыть главное меню" },
      { command: "users", description: "Последние пользователи" },
      { command: "profiles", description: "Все профили и режимы" },
      { command: "profile", description: "Найти профиль по DEMO-ID" },
      { command: "help", description: "Справка по боту" },
    ],
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
  if (!response.ok) throw new Error(`Profile lookup failed: ${response.status}`);
  const rows = await response.json() as ProfileVisual[];
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
  if (!response.ok) throw new Error(`Account lookup failed: ${response.status}`);
  const rows = await response.json() as ProfileAccount[];
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
  if (!response.ok) throw new Error(`Profile list failed: ${response.status}`);
  return await response.json() as ProfileVisual[];
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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profile_visuals?${query.toString()}`, {
    method: "PATCH",
    headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ watermark_mode: mode, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Profile update failed: ${response.status}`);
  const rows = await response.json() as ProfileVisual[];
  return rows[0] ?? null;
}

function profileKeyboard(profile: ProfileVisual): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        {
          text: `${profile.watermark_mode === 0 ? "✅ " : ""}0 · компактно`,
          callback_data: `visual|0|${profile.profile_id}`,
        },
        {
          text: `${profile.watermark_mode === 1 ? "✅ " : ""}1 · крупно`,
          callback_data: `visual|1|${profile.profile_id}`,
        },
      ],
      [
        { text: USERS_BUTTON, callback_data: "nav|users" },
        { text: PROFILES_BUTTON, callback_data: "nav|profiles" },
      ],
      [{ text: MENU_BUTTON, callback_data: "nav|menu" }],
    ],
  };
}

function adminMenuKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: USERS_BUTTON }, { text: PROFILES_BUTTON }],
      [{ text: SEARCH_BUTTON }, { text: HELP_BUTTON }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function accountListKeyboard(accounts: ProfileAccount[]): Record<string, unknown> {
  return {
    inline_keyboard: [
      ...accounts.map(account => [{
        text: `${account.profile_id} · ${accountName(account)}`.slice(0, 64),
        callback_data: `profile|${account.profile_id}`,
      }]),
      [
        { text: "🔄 Обновить", callback_data: "nav|users" },
        { text: MENU_BUTTON, callback_data: "nav|menu" },
      ],
    ],
  };
}

function profileListKeyboard(profiles: ProfileVisual[]): Record<string, unknown> {
  return {
    inline_keyboard: [
      ...profiles.map(profile => [{
        text: `${profile.profile_id} · режим ${profile.watermark_mode}`,
        callback_data: `profile|${profile.profile_id}`,
      }]),
      [
        { text: "🔄 Обновить", callback_data: "nav|profiles" },
        { text: MENU_BUTTON, callback_data: "nav|menu" },
      ],
    ],
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
  return value ? `${value.replace("T", " ").slice(0, 16)} UTC` : "ещё не входил";
}

function accountDetails(account: ProfileAccount): string {
  return [
    `Владелец: ${accountName(account)} (${accountUsername(account)})`,
    `Telegram ID: ${account.telegram_user_id}`,
    `Регистрация: ${compactDate(account.created_at)}`,
    `Последний вход: ${compactDate(account.last_login_at)}`,
  ].join("\n");
}

async function showProfile(chatId: number, profileId: string): Promise<void> {
  const [profile, account] = await Promise.all([getProfile(profileId), getAccountByProfileId(profileId)]);
  if (!profile) {
    await sendMessage(chatId, `Профиль ${profileId} не найден.`);
    return;
  }
  const details = account ? `\n\n${accountDetails(account)}` : "\n\nВладелец Telegram пока не привязан.";
  await sendMessage(chatId, `${profileText(profile)}${details}`, profileKeyboard(profile));
}

async function showAdminMenu(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "Панель администратора\n\nВыберите действие кнопкой ниже. Для быстрого открытия карточки можно также отправить DEMO-ID сообщением.",
    adminMenuKeyboard(),
  );
}

async function showUsers(chatId: number): Promise<void> {
  const accounts = await listAccounts();
  if (!accounts.length) {
    await sendMessage(chatId, "Пользователей пока нет.", accountListKeyboard([]));
    return;
  }
  await sendMessage(
    chatId,
    `Последние пользователи: ${accounts.length}\n\nНажмите на пользователя, чтобы открыть карточку и изменить режим.`,
    accountListKeyboard(accounts),
  );
}

async function showProfiles(chatId: number): Promise<void> {
  const profiles = await listProfiles();
  if (!profiles.length) {
    await sendMessage(chatId, "Профилей пока нет.", profileListKeyboard([]));
    return;
  }
  await sendMessage(
    chatId,
    `Профили: ${profiles.length}\n\nРежим 0 — компактная маркировка, режим 1 — крупная. Нажмите на профиль для управления.`,
    profileListKeyboard(profiles),
  );
}

async function showHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    [
      "Справка администратора",
      "",
      `• ${USERS_BUTTON} — последние зарегистрированные пользователи.`,
      `• ${PROFILES_BUTTON} — профили и текущие режимы 0/1.`,
      `• ${SEARCH_BUTTON} — поиск карточки по постоянному DEMO-ID.`,
      "• В карточке нажмите 0 или 1, чтобы изменить размер DEMO-маркировки.",
      "",
      "Изменение появляется в приложении после возврата на экран, фокуса или автоматического обновления.",
    ].join("\n"),
    adminMenuKeyboard(),
  );
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  if (!isAdmin(message.from?.id)) {
    await sendMessage(message.chat.id, "Доступ запрещён.");
    return;
  }

  const text = message.text?.trim() ?? "";
  if (/^\/start(?:@\w+)?$/i.test(text) || text === MENU_BUTTON) {
    await showAdminMenu(message.chat.id);
    return;
  }

  if (/^\/help(?:@\w+)?$/i.test(text) || text === HELP_BUTTON) {
    await showHelp(message.chat.id);
    return;
  }

  if (/^\/profiles(?:@\w+)?$/i.test(text) || text === PROFILES_BUTTON) {
    await showProfiles(message.chat.id);
    return;
  }

  if (/^\/users(?:@\w+)?$/i.test(text) || text === USERS_BUTTON) {
    await showUsers(message.chat.id);
    return;
  }

  if (/^\/profile(?:@\w+)?$/i.test(text) || text === SEARCH_BUTTON) {
    await sendMessage(
      message.chat.id,
      "Отправьте постоянный ID профиля сообщением, например: DEMO-BKZYHEDR",
      adminMenuKeyboard(),
    );
    return;
  }

  const profileArgument = text.replace(/^\/profile(?:@\w+)?\s+/i, "");
  const profileId = normalizeProfileId(profileArgument);
  if (!profileId) {
    await sendMessage(
      message.chat.id,
      "Не удалось распознать команду. Используйте кнопки меню или отправьте ID вида DEMO-BKZYHEDR.",
      adminMenuKeyboard(),
    );
    return;
  }
  await showProfile(message.chat.id, profileId);
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<void> {
  if (!isAdmin(callback.from.id)) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Доступ запрещён",
      show_alert: true,
    });
    return;
  }

  const [action, rawMode, rawProfileId] = callback.data?.split("|") ?? [];

  if (action === "profile") {
    const profileId = rawMode ? normalizeProfileId(rawMode) : null;
    if (!profileId || !callback.message) {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Профиль не найден",
        show_alert: true,
      });
      return;
    }
    await telegram("answerCallbackQuery", { callback_query_id: callback.id });
    await showProfile(callback.message.chat.id, profileId);
    return;
  }

  if (action === "nav") {
    if (!callback.message) return;
    await telegram("answerCallbackQuery", { callback_query_id: callback.id });
    if (rawMode === "users") await showUsers(callback.message.chat.id);
    else if (rawMode === "profiles") await showProfiles(callback.message.chat.id);
    else await showAdminMenu(callback.message.chat.id);
    return;
  }

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

  await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: `Режим ${mode} установлен` });
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
      return new Response("Admin bot webhook configured. You can close this page.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Webhook setup failed");
      return new Response("Webhook setup failed. Check Edge Function logs.", { status: 502 });
    }
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(suppliedSecret, WEBHOOK_SECRET)) return new Response("Unauthorized", { status: 401 });

  try {
    const update = await request.json() as TelegramUpdate;
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    return new Response("ok");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unhandled admin bot error");
    return new Response("ok");
  }
});
