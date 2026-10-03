type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  from?: TelegramUser;
  chat: { id: number };
  text?: string;
};

type TelegramUpdate = {
  message?: TelegramMessage;
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
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
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

async function sendMessage(chatId: number, text: string): Promise<void> {
  await telegram("sendMessage", { chat_id: chatId, text });
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
    allowed_updates: ["message"],
  });
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const text = message.text?.trim() ?? "";
  if (!/^\/(start|help)(?:@\w+)?$/i.test(text)) {
    await sendMessage(message.chat.id, "Отправьте /start, чтобы получить новый одноразовый код для входа.");
    return;
  }
  if (!message.from?.id) return;

  const { account, code } = await issueLoginCode(message.from);
  await sendMessage(
    message.chat.id,
    `Ваш одноразовый код для входа:\n\n${code}\n\nВведите его в приложении в течение 10 минут. Ваш постоянный ID профиля: ${account.profile_id}.`,
  );
}

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("setup") === "webhook") {
    try {
      await configureWebhook();
      return new Response("User bot webhook configured. You can close this page.");
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
    if (update.message) await handleMessage(update.message);
    return new Response("ok");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unhandled user bot error");
    return new Response("ok");
  }
});
