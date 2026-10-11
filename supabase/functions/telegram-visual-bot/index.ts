type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat: { id: number; type?: string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
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

type ProfileAccount = {
  telegram_user_id: number;
  profile_id: string;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_username: string | null;
  created_at: string;
  last_login_at: string | null;
};

type ProfileVisual = {
  watermark_mode: 0 | 1;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
};

type PaymentStatus =
  | "waiting_operator"
  | "waiting_payment"
  | "payment_reported"
  | "approved"
  | "rejected"
  | "cancelled";

type PaymentOrder = {
  order_code: string;
  telegram_user_id: number;
  profile_id: string;
  plan_months: number | null;
  amount_uah: number | null;
  status: PaymentStatus;
  receipt_received_at: string | null;
  created_at: string;
  confirmed_at: string | null;
};

const BOT_TOKEN = requiredEnv("TELEGRAM_BOT_TOKEN");
const PAYMENT_BOT_TOKEN = requiredEnv("TELEGRAM_PAYMENT_BOT_TOKEN");
const WEBHOOK_SECRET = requiredEnv("TELEGRAM_WEBHOOK_SECRET");
const SUPABASE_URL = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PAYMENT_OPERATOR_IDS = requiredEnv("TELEGRAM_PAYMENT_OPERATOR_IDS").split(",").map(value => value.trim()).filter(Boolean);
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TELEGRAM_FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`;
const PAYMENT_TELEGRAM_API = `https://api.telegram.org/bot${PAYMENT_BOT_TOKEN}`;
const LOGIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const APP_URL = "https://gamgid.github.io/ggkadg/";
const TUTORIAL_IMAGE_URLS = [
  `${APP_URL}tutorial/01-open-and-login.png`,
  `${APP_URL}tutorial/02-local-pin.png`,
  `${APP_URL}tutorial/03-ready-app.png`,
] as const;
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const PAYMENT_PLANS = [
  { months: 1, amountUah: 1200 },
  { months: 2, amountUah: 2200 },
  { months: 6, amountUah: 6000 },
  { months: 12, amountUah: 11500 },
] as const;

const MAIN_MENU = {
  keyboard: [
    [{ text: "🔑 Код для входа" }, { text: "👤 Мой профиль" }],
    [{ text: "💳 Оплата" }, { text: "⚙️ Настройки" }],
    [{ text: "📖 Инструкция" }, { text: "🌐 Открыть приложение" }],
    [{ text: "🆘 Помощь" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  one_time_keyboard: false,
  input_field_placeholder: "Выберите действие",
};

function paymentPlan(monthsValue: string | number): typeof PAYMENT_PLANS[number] | null {
  const months = Number(monthsValue);
  return PAYMENT_PLANS.find(plan => plan.months === months) ?? null;
}

function paymentPlanText(order: PaymentOrder): string {
  if (!order.plan_months || !order.amount_uah) return "Тариф: не указан (старая заявка)";
  const monthWord = order.plan_months === 1 ? "месяц" : order.plan_months < 5 ? "месяца" : "месяцев";
  return `Тариф: ${order.plan_months} ${monthWord} · ${order.amount_uah} грн`;
}

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

async function paymentTelegram(method: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${PAYMENT_TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Payment Telegram API request failed: ${response.status}`);
}

async function telegramResult<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram API request failed: ${response.status}`);
  const payload = await response.json() as { ok: boolean; result?: T };
  if (!payload.ok || payload.result === undefined) throw new Error("Telegram API returned no result");
  return payload.result;
}

async function sendMessage(
  chatId: number,
  text: string,
  options: Record<string, unknown> = {},
): Promise<void> {
  await telegram("sendMessage", { chat_id: chatId, text, ...options });
}

async function sendTutorialAlbum(chatId: number): Promise<void> {
  await telegram("sendMediaGroup", {
    chat_id: chatId,
    media: [
      {
        type: "photo",
        media: TUTORIAL_IMAGE_URLS[0],
        caption: "1️⃣ Получите одноразовый ID в боте, откройте приложение и введите его на первом экране. ID действует 10 минут и используется один раз.",
      },
      {
        type: "photo",
        media: TUTORIAL_IMAGE_URLS[1],
        caption: "2️⃣ Создайте четырёхзначный PIN. Он остаётся только на этом устройстве и нужен для следующих запусков.",
      },
      {
        type: "photo",
        media: TUTORIAL_IMAGE_URLS[2],
        caption: "3️⃣ После входа откроется главный экран DEMO-приложения. Статус подписки и срок проверяйте в разделе «Мой профиль» бота.",
      },
    ],
  });
  await sendMessage(chatId, "Готово. Начните с получения нового кода:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔑 Получить новый код", callback_data: "profile|login|now" }],
        [{ text: "🌐 Открыть приложение", url: APP_URL }],
        [{ text: "⬅️ Все шаги", callback_data: "guide|main|open" }],
      ],
    },
  });
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

async function getProfileVisual(profileId: string): Promise<ProfileVisual | null> {
  const query = new URLSearchParams({
    select: "watermark_mode,subscription_started_at,subscription_expires_at",
    profile_id: `eq.${profileId}`,
    limit: "1",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/profile_visuals?${query.toString()}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Profile visual lookup failed: ${response.status}`);
  const rows = await response.json() as ProfileVisual[];
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

function formatDate(value: string | null): string {
  if (!value) return "ещё не выполнялся";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function remainingTimeText(expiresAt: string): string {
  const remainingSeconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} дн.`);
  if (hours > 0 || days > 0) parts.push(`${hours} ч.`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes} мин.`);
  parts.push(`${seconds} сек.`);
  return parts.join(" ");
}

function paymentStatusLabel(status: PaymentStatus): string {
  if (status === "waiting_operator") return "ожидает реквизитов";
  if (status === "waiting_payment") return "ожидает оплаты";
  if (status === "payment_reported") return "оплата проверяется";
  if (status === "approved") return "подтверждена";
  if (status === "rejected") return "отклонена";
  return "отменена";
}

function profileKeyboard(hasSubscription: boolean): Record<string, unknown> {
  return {
    inline_keyboard: [
      [{
        text: hasSubscription ? "🔄 Продлить подписку" : "💳 Оформить подписку",
        callback_data: "profile|renew|now",
      }],
      [{ text: "🔑 Получить код", callback_data: "profile|login|now" }],
      [{ text: "🌐 Открыть приложение", url: APP_URL }],
      [{ text: "🔄 Обновить профиль", callback_data: "profile|refresh|now" }],
    ],
  };
}

function displayName(account: ProfileAccount): string {
  const name = [account.telegram_first_name, account.telegram_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || "не указано в Telegram";
}

async function showMainMenu(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "Главное меню\n\nЗдесь можно получить код для входа, посмотреть профиль и открыть пошаговую инструкцию.",
    { reply_markup: MAIN_MENU },
  );
}

async function showLoginCode(chatId: number, user: TelegramUser): Promise<void> {
  const { account, code } = await issueLoginCode(user);
  await sendMessage(
    chatId,
    `Ваш одноразовый код для входа:\n\n${code}\n\nКод действует 10 минут и используется один раз.\nПостоянный ID профиля: ${account.profile_id}`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: "🌐 Открыть приложение", url: APP_URL }]],
      },
    },
  );
}

async function syncAccountIdentity(account: ProfileAccount, user: TelegramUser): Promise<ProfileAccount> {
  const identity = telegramIdentity(user);
  if (
    account.telegram_first_name === identity.telegram_first_name &&
    account.telegram_last_name === identity.telegram_last_name &&
    account.telegram_username === identity.telegram_username
  ) return account;

  const query = new URLSearchParams({ telegram_user_id: `eq.${user.id}` });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query}`, {
    method: "PATCH",
    headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ ...identity, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Account identity update failed: ${response.status}`);
  const rows = await response.json() as ProfileAccount[];
  return rows[0] ?? { ...account, ...identity };
}

async function getLatestPaymentOrder(
  telegramUserId: number,
  status?: PaymentStatus,
): Promise<PaymentOrder | null> {
  const query = new URLSearchParams({
    select: "order_code,telegram_user_id,profile_id,plan_months,amount_uah,status,receipt_received_at,created_at,confirmed_at",
    telegram_user_id: `eq.${telegramUserId}`,
    order: status === "approved" ? "confirmed_at.desc.nullslast" : "created_at.desc",
    limit: "1",
  });
  if (status) query.set("status", `eq.${status}`);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Latest payment order lookup failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

async function showProfile(chatId: number, user: TelegramUser): Promise<void> {
  try {
    const storedAccount = await getAccount(user.id) ?? await createAccount(user);
    const account = await syncAccountIdentity(storedAccount, user);
    const [visual, latestOrder, latestApprovedOrder] = await Promise.all([
      getProfileVisual(account.profile_id),
      getLatestPaymentOrder(account.telegram_user_id),
      getLatestPaymentOrder(account.telegram_user_id, "approved"),
    ]);
    const username = account.telegram_username ? `@${account.telegram_username}` : "не указан";
    const startedAt = visual?.subscription_started_at ?? null;
    const expiresAt = visual?.subscription_expires_at ?? null;
    const isActive = Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
    const hasSubscription = Boolean(startedAt || expiresAt || latestApprovedOrder);
    const plan = latestApprovedOrder?.plan_months
      ? `${latestApprovedOrder.plan_months} ${latestApprovedOrder.plan_months === 1 ? "месяц" : latestApprovedOrder.plan_months < 5 ? "месяца" : "месяцев"}`
      : "не указан";
    const subscriptionLines = !hasSubscription
      ? ["Статус: не оформлена", "Тариф: —", "Начало: —", "Окончание: —", "Осталось: —"]
      : !startedAt || !expiresAt
      ? [
        "Статус: ⚠️ данные срока отсутствуют",
        `Тариф: ${plan}`,
        `Начало: ${startedAt ? `${formatDate(startedAt)} (Киев)` : "нет данных"}`,
        `Окончание: ${expiresAt ? `${formatDate(expiresAt)} (Киев)` : "нет данных"}`,
        "Осталось: нет данных",
      ]
      : [
        `Статус: ${isActive ? "✅ активна" : "⌛ истекла"}`,
        `Тариф: ${plan}`,
        `Начало: ${formatDate(startedAt)} (Киев)`,
        `Окончание: ${formatDate(expiresAt)} (Киев)`,
        `Осталось: ${isActive ? remainingTimeText(expiresAt) : "0 сек."}`,
      ];
    const latestOrderLines = latestOrder
      ? [
        `Заявка: ${latestOrder.order_code}`,
        `Статус: ${paymentStatusLabel(latestOrder.status)}`,
        paymentPlanText(latestOrder),
        `Создана: ${formatDate(latestOrder.created_at)} (Киев)`,
      ]
      : ["Заявок пока нет."];

    await sendMessage(
      chatId,
      [
        "👤 Мой профиль",
        "",
        `Имя: ${displayName(account)}`,
        `Username: ${username}`,
        `DEMO-ID: ${account.profile_id}`,
        `Регистрация: ${formatDate(account.created_at)} (Киев)`,
        `Последний вход: ${formatDate(account.last_login_at)}${account.last_login_at ? " (Киев)" : ""}`,
        "",
        "📅 Подписка",
        ...subscriptionLines,
        "",
        "🧾 Последняя заявка",
        ...latestOrderLines,
        "",
        "Учебный DEMO-профиль, не связанный с государственными системами.",
      ].join("\n"),
      { reply_markup: profileKeyboard(hasSubscription) },
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Profile loading failed");
    await sendMessage(
      chatId,
      "Не удалось загрузить профиль. Данные не потеряны — попробуйте ещё раз через несколько секунд.",
      { reply_markup: MAIN_MENU },
    );
  }
}

async function getActivePaymentOrder(telegramUserId: number): Promise<PaymentOrder | null> {
  const query = new URLSearchParams({
    select: "order_code,telegram_user_id,profile_id,plan_months,amount_uah,status,receipt_received_at,created_at,confirmed_at",
    telegram_user_id: `eq.${telegramUserId}`,
    status: "in.(waiting_operator,waiting_payment,payment_reported)",
    order: "created_at.desc",
    limit: "1",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Payment order lookup failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

async function getPaymentOrder(orderCode: string, telegramUserId: number): Promise<PaymentOrder | null> {
  const query = new URLSearchParams({
    select: "order_code,telegram_user_id,profile_id,plan_months,amount_uah,status,receipt_received_at,created_at,confirmed_at",
    order_code: `eq.${orderCode}`,
    telegram_user_id: `eq.${telegramUserId}`,
    limit: "1",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Payment order lookup failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

async function createPaymentOrder(
  account: ProfileAccount,
  plan: typeof PAYMENT_PLANS[number],
): Promise<{ order: PaymentOrder; created: boolean }> {
  const active = await getActivePaymentOrder(account.telegram_user_id);
  if (active) return { order: active, created: false };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const orderCode = `PAY-${randomCharacters(8)}`;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders`, {
      method: "POST",
      headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({
        order_code: orderCode,
        telegram_user_id: account.telegram_user_id,
        profile_id: account.profile_id,
        plan_months: plan.months,
        amount_uah: plan.amountUah,
      }),
    });
    if (response.ok) {
      const rows = await response.json() as PaymentOrder[];
      if (rows[0]) return { order: rows[0], created: true };
    }
    if (response.status === 409) {
      const existing = await getActivePaymentOrder(account.telegram_user_id);
      if (existing) return { order: existing, created: false };
      continue;
    }
    throw new Error(`Payment order creation failed: ${response.status}`);
  }
  throw new Error("Could not allocate a unique payment order code");
}

function paymentStatusText(order: PaymentOrder): string {
  if (order.status === "waiting_operator") return "Оператор ещё готовит реквизиты.";
  if (order.status === "waiting_payment") return "Реквизиты уже отправлены. После перевода нажмите «Я оплатил».";
  return order.receipt_received_at
    ? "Оплата отмечена, чек получен и ожидает проверки."
    : "Оплата отмечена. Для проверки обязательно отправьте квитанцию: фото, изображение или PDF.";
}

function userPaymentKeyboard(order: PaymentOrder): Record<string, unknown> | undefined {
  if (order.status === "waiting_operator") {
    return {
      inline_keyboard: [[{ text: "❌ Отменить заявку", callback_data: `payment|cancel|${order.order_code}` }]],
    };
  }
  if (order.status === "waiting_payment") {
    return {
      inline_keyboard: [
        [{ text: "✅ Я оплатил", callback_data: `payment|reported|${order.order_code}` }],
        [{ text: "❌ Отменить заявку", callback_data: `payment|cancel|${order.order_code}` }],
      ],
    };
  }
  return undefined;
}

async function notifyPaymentOperatorsNewOrder(order: PaymentOrder, account: ProfileAccount, user: TelegramUser): Promise<number> {
  const notification = [
    "🆕 Новая заявка на оплату",
    "",
    `Заявка: ${order.order_code}`,
    paymentPlanText(order),
    `DEMO-ID: ${account.profile_id}`,
    `Telegram ID: ${user.id}`,
    `Время: ${formatDate(new Date().toISOString())}`,
    "",
    "Нажмите кнопку и отправьте реквизиты ответом на сообщение бота.",
  ].join("\n");

  const results = await Promise.allSettled(
    PAYMENT_OPERATOR_IDS.map(chatId => paymentTelegram("sendMessage", {
      chat_id: chatId,
      text: notification,
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Отправить реквизиты", callback_data: `order|details|${order.order_code}` }],
          [{ text: "❌ Отклонить", callback_data: `order|reject|${order.order_code}` }],
        ],
      },
    })),
  );
  results.forEach(result => {
    if (result.status === "rejected") console.error("New payment order notification failed");
  });
  return results.filter(result => result.status === "fulfilled").length;
}

async function showPayment(chatId: number, user: TelegramUser): Promise<void> {
  const account = await getAccount(user.id) ?? await createAccount(user);
  const order = await getActivePaymentOrder(account.telegram_user_id);
  if (!order) {
    await sendMessage(
      chatId,
      "💳 Оплата\n\nВыберите тариф. Заявка будет создана только после выбора срока:",
      {
        reply_markup: {
          inline_keyboard: PAYMENT_PLANS.map(plan => [{
            text: `${plan.months} ${plan.months === 1 ? "месяц" : plan.months === 2 ? "месяца" : "месяцев"} · ${plan.amountUah} грн`,
            callback_data: `payment|plan|${plan.months}`,
          }]),
        },
      },
    );
    return;
  }
  await sendMessage(
    chatId,
    `💳 Оплата\n\nЗаявка: ${order.order_code}\n${paymentPlanText(order)}\n${paymentStatusText(order)}\n\nПожалуйста, подождите — ответственный за оплату свяжется с вами в этом боте. Не переводите деньги, пока здесь не появятся реквизиты.`,
    { reply_markup: userPaymentKeyboard(order) ?? MAIN_MENU },
  );
}

async function patchPaymentOrder(
  orderCode: string,
  expectedStatus: PaymentStatus,
  changes: Record<string, unknown>,
): Promise<PaymentOrder | null> {
  const query = new URLSearchParams({ order_code: `eq.${orderCode}`, status: `eq.${expectedStatus}` });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, {
    method: "PATCH",
    headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Payment order update failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

async function notifyPaymentReported(order: PaymentOrder): Promise<void> {
  const text = [
    "💰 Пользователь отметил оплату",
    "",
    `Заявка: ${order.order_code}`,
    paymentPlanText(order),
    `DEMO-ID: ${order.profile_id}`,
    "Ожидается обязательная квитанция. Подтверждение станет доступно после её получения.",
  ].join("\n");
  await Promise.allSettled(PAYMENT_OPERATOR_IDS.map(chatId => paymentTelegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [[{ text: "❌ Отклонить", callback_data: `order|reject|${order.order_code}` }]],
    },
  })));
}

async function forwardReceiptToPaymentOperators(
  order: PaymentOrder,
  source: { fileId: string; kind: "photo" | "pdf" | "image"; fileSize?: number; fileName?: string },
): Promise<number> {
  if (source.fileSize && source.fileSize > MAX_RECEIPT_BYTES) throw new Error("Receipt is too large");
  const file = await telegramResult<{ file_path?: string }>("getFile", { file_id: source.fileId });
  if (!file.file_path) throw new Error("Telegram receipt path was not returned");
  const download = await fetch(`${TELEGRAM_FILE_API}/${file.file_path}`);
  if (!download.ok) throw new Error(`Receipt download failed: ${download.status}`);
  const blob = await download.blob();
  if (blob.size > MAX_RECEIPT_BYTES) throw new Error("Receipt is too large");

  const method = source.kind === "photo" ? "sendPhoto" : "sendDocument";
  const field = source.kind === "photo" ? "photo" : "document";
  const fallbackName = source.kind === "pdf" ? `${order.order_code}.pdf` : `${order.order_code}.jpg`;
  const results = await Promise.allSettled(PAYMENT_OPERATOR_IDS.map(async chatId => {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", `Чек по заявке ${order.order_code}\n${paymentPlanText(order)}\nDEMO-ID: ${order.profile_id}`);
    form.set(field, blob, source.fileName || fallbackName);
    const response = await fetch(`${PAYMENT_TELEGRAM_API}/${method}`, { method: "POST", body: form });
    if (!response.ok) throw new Error(`Receipt delivery failed: ${response.status}`);
  }));
  return results.filter(result => result.status === "fulfilled").length;
}

async function handleReceipt(message: TelegramMessage): Promise<boolean> {
  if (!message.from) return false;
  const largestPhoto = message.photo?.[message.photo.length - 1];
  const document = message.document;
  if (!largestPhoto && !document) return false;
  const active = await getActivePaymentOrder(message.from.id);
  if (!active || active.status !== "payment_reported") {
    await sendMessage(message.chat.id, "Сначала откройте «💳 Оплата» и нажмите «✅ Я оплатил».", { reply_markup: MAIN_MENU });
    return true;
  }
  if (active.receipt_received_at) {
    await sendMessage(message.chat.id, "Чек по этой заявке уже получен. Ожидайте решения оператора.", { reply_markup: MAIN_MENU });
    return true;
  }

  let source: { fileId: string; kind: "photo" | "pdf" | "image"; fileSize?: number; fileName?: string };
  if (largestPhoto) {
    source = { fileId: largestPhoto.file_id, kind: "photo", fileSize: largestPhoto.file_size };
  } else {
    const mime = document?.mime_type?.toLowerCase() ?? "";
    if (mime !== "application/pdf" && !mime.startsWith("image/")) {
      await sendMessage(message.chat.id, "Можно отправить только фото, изображение или PDF-файл.");
      return true;
    }
    source = {
      fileId: document!.file_id,
      kind: mime === "application/pdf" ? "pdf" : "image",
      fileSize: document!.file_size,
      fileName: document!.file_name,
    };
  }
  if (source.fileSize && source.fileSize > MAX_RECEIPT_BYTES) {
    await sendMessage(message.chat.id, "Файл слишком большой. Максимальный размер чека — 10 МБ.");
    return true;
  }
  let delivered = 0;
  try {
    delivered = await forwardReceiptToPaymentOperators(active, source);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Receipt is too large";
    await sendMessage(
      message.chat.id,
      tooLarge
        ? "Файл слишком большой. Максимальный размер чека — 10 МБ."
        : "Не удалось переслать квитанцию оператору. Попробуйте ещё раз.",
      { reply_markup: MAIN_MENU },
    );
    return true;
  }
  if (delivered === 0) {
    await sendMessage(message.chat.id, "Не удалось доставить квитанцию оператору. Попробуйте ещё раз.", {
      reply_markup: MAIN_MENU,
    });
    return true;
  }
  const updated = await patchPaymentOrder(active.order_code, "payment_reported", {
    receipt_received_at: new Date().toISOString(),
    receipt_kind: source.kind,
  });
  if (!updated) {
    await sendMessage(message.chat.id, "Заявка уже обработана оператором. Откройте «💳 Оплата», чтобы увидеть актуальный статус.", {
      reply_markup: MAIN_MENU,
    });
    return true;
  }
  await Promise.allSettled(PAYMENT_OPERATOR_IDS.map(chatId => paymentTelegram("sendMessage", {
    chat_id: chatId,
    text: `✅ Обязательная квитанция по заявке ${active.order_code} получена. Заявку можно подтвердить.`,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Подтвердить", callback_data: `order|approve|${active.order_code}` },
        { text: "❌ Отклонить", callback_data: `order|reject|${active.order_code}` },
      ]],
    },
  })));
  await sendMessage(message.chat.id, "✅ Квитанция отправлена оператору. Ожидайте подтверждения оплаты.", { reply_markup: MAIN_MENU });
  return true;
}

async function showTutorial(chatId: number, section = "main"): Promise<void> {
  if (section === "screens") {
    await sendTutorialAlbum(chatId);
    return;
  }
  const pages: Record<string, string> = {
    main: "📖 Инструкция\n\nВыберите нужный этап. Здесь можно пройти весь путь: от получения кода до активации подписки.",
    login: "🔑 Вход в приложение\n\n1. Нажмите «Получить новый код».\n2. Скопируйте код формата ABCD-EFGH.\n3. Откройте приложение.\n4. Введите код в течение 10 минут.\n\nКод одноразовый: после успешного входа или окончания 10 минут он больше не действует.",
    pin: "📱 PIN и повторный вход\n\nПосле одноразового кода приложение попросит создать четырёхзначный PIN. Он хранится только на вашем устройстве и боту не передаётся.\n\nПри следующих запусках обычно достаточно PIN. Если вы его забыли, выберите в приложении «Не пам’ятаю код для входу» и получите новый одноразовый код здесь.",
    payment: "💳 Оплата и подписка\n\n1. Откройте «Оплата» и выберите тариф.\n2. Дождитесь реквизитов от оператора.\n3. После перевода нажмите «Я оплатил».\n4. Обязательно отправьте квитанцию: фото, изображение или PDF до 10 МБ.\n5. После подтверждения подписка начнётся с точностью до секунды.\n\nБез квитанции оплата не подтверждается. Не переводите деньги до появления реквизитов в боте.",
    status: "👤 Где смотреть результат\n\nВ разделе «Мой профиль» отображаются тариф, точные начало и окончание подписки, оставшееся время и последняя заявка. Кнопка «Обновить профиль» загружает актуальные данные.",
  };
  const text = pages[section] ?? pages.main;
  const inlineKeyboard = section === "main"
    ? [
      [{ text: "🖼 Показать со скриншотами", callback_data: "guide|screens|open" }],
      [{ text: "1️⃣ Вход по коду", callback_data: "guide|login|open" }],
      [{ text: "2️⃣ PIN и повторный вход", callback_data: "guide|pin|open" }],
      [{ text: "3️⃣ Оплата и подписка", callback_data: "guide|payment|open" }],
      [{ text: "4️⃣ Проверка статуса", callback_data: "guide|status|open" }],
      [{ text: "🌐 Открыть приложение", url: APP_URL }],
    ]
    : [
      [{ text: "🔑 Получить новый код", callback_data: "profile|login|now" }],
      [{ text: "🌐 Открыть приложение", url: APP_URL }],
      [{ text: "⬅️ Все шаги", callback_data: "guide|main|open" }],
    ];
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
}

async function showSettings(chatId: number, section = "main"): Promise<void> {
  const pages: Record<string, string> = {
    main: "⚙️ Настройки\n\nВыберите раздел. Здесь можно обновить данные Telegram, проверить безопасность входа и открыть настройки оплаты.",
    security: "🛡 Безопасность входа\n\n• Профиль привязан к вашему Telegram-аккаунту.\n• Одноразовый код действует 10 минут и сгорает после входа.\n• Не отправляйте код другим людям.\n• Четырёхзначный PIN хранится только на вашем устройстве и не передаётся боту.\n• Бот никогда не просит пароль от Telegram или банковские данные.",
    telegram: "👤 Данные Telegram\n\nИмя и @username синхронизируются из вашего текущего профиля Telegram при открытии профиля или получении нового кода.\n\nСначала измените данные в Telegram, затем нажмите кнопку обновления ниже.",
    payment: "💳 Оплата и квитанции\n\nРеквизиты появляются только после ответа оператора. До этого переводить деньги не нужно. Квитанция обязательна; поддерживаются фото, изображения и PDF до 10 МБ. Без квитанции оператор не сможет подтвердить оплату. Статус последней заявки виден в профиле.",
  };
  const text = pages[section] ?? pages.main;
  const inlineKeyboard = section === "main"
    ? [
      [{ text: "👤 Мои данные", callback_data: "settings|telegram|open" }],
      [{ text: "🛡 Безопасность входа", callback_data: "settings|security|open" }],
      [{ text: "💳 Оплата и чеки", callback_data: "settings|payment|open" }],
      [{ text: "🔄 Обновить профиль", callback_data: "profile|refresh|now" }],
      [{ text: "📖 Инструкция", callback_data: "guide|main|open" }],
    ]
    : [
      [{ text: "👤 Открыть профиль", callback_data: "profile|refresh|now" }],
      [{ text: "🔑 Получить новый код", callback_data: "profile|login|now" }],
      [{ text: "⬅️ Все настройки", callback_data: "settings|main|open" }],
    ];
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
}

async function showHelp(chatId: number, section = "main"): Promise<void> {
  const pages: Record<string, string> = {
    main: "🆘 Помощь\n\nВыберите, с чем возникла проблема. Бот покажет короткую проверку и нужные действия.",
    login: "🔑 Не получается войти\n\n• Получите новый код: старый мог истечь или уже использоваться.\n• Введите код без лишних пробелов.\n• Убедитесь, что открыли приложение по кнопке этого бота.\n• Если забыли PIN, выберите в приложении «Не пам’ятаю код для входу» и войдите заново.",
    payment: "💳 Вопрос по оплате\n\nОткройте «Мой профиль» и проверьте последнюю заявку. Если она ожидает оператора — дождитесь реквизитов. Если оплата отмечена — дождитесь проверки. Не создавайте повторную заявку, пока текущая активна.",
    subscription: "⏱ Подписка не обновилась\n\nСначала откройте профиль и нажмите «Обновить профиль». Подписка включается только после подтверждения оператором. В профиле должны появиться точные даты начала и окончания. Если заявка ещё на проверке, дождитесь решения.",
  };
  const text = pages[section] ?? pages.main;
  const inlineKeyboard = section === "main"
    ? [
      [{ text: "🔑 Не получается войти", callback_data: "help|login|open" }],
      [{ text: "💳 Вопрос по оплате", callback_data: "help|payment|open" }],
      [{ text: "⏱ Подписка не обновилась", callback_data: "help|subscription|open" }],
      [{ text: "👤 Проверить профиль", callback_data: "profile|refresh|now" }],
      [{ text: "📖 Открыть инструкцию", callback_data: "guide|main|open" }],
    ]
    : [
      [{ text: "👤 Проверить профиль", callback_data: "profile|refresh|now" }],
      [{ text: "🔑 Получить новый код", callback_data: "profile|login|now" }],
      [{ text: "⬅️ Все вопросы", callback_data: "help|main|open" }],
    ];
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
}

async function configureWebhook(): Promise<void> {
  await telegram("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/telegram-visual-bot`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "Начать и получить код" },
      { command: "menu", description: "Главное меню" },
      { command: "login", description: "Новый код для входа" },
      { command: "profile", description: "Мой профиль" },
      { command: "payment", description: "Заявка на оплату" },
      { command: "guide", description: "Как пользоваться" },
      { command: "settings", description: "Настройки" },
      { command: "help", description: "Помощь" },
    ],
  });
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const text = message.text?.trim() ?? "";
  if (!message.from?.id) return;
  if (message.chat.type && message.chat.type !== "private") {
    await sendMessage(message.chat.id, "Для безопасности используйте этого бота только в личном чате.");
    return;
  }
  if (await handleReceipt(message)) return;

  if (/^\/start(?:@\w+)?$/i.test(text)) {
    await showMainMenu(message.chat.id);
    await showLoginCode(message.chat.id, message.from);
    return;
  }
  if (/^\/menu(?:@\w+)?$/i.test(text)) {
    await showMainMenu(message.chat.id);
    return;
  }
  if (/^\/login(?:@\w+)?$/i.test(text) || text === "🔑 Код для входа") {
    await showLoginCode(message.chat.id, message.from);
    return;
  }
  if (/^\/profile(?:@\w+)?$/i.test(text) || text === "👤 Мой профиль") {
    await showProfile(message.chat.id, message.from);
    return;
  }
  if (/^\/payment(?:@\w+)?$/i.test(text) || text === "💳 Оплата") {
    await showPayment(message.chat.id, message.from);
    return;
  }
  if (/^\/guide(?:@\w+)?$/i.test(text) || text === "📖 Инструкция") {
    await showTutorial(message.chat.id);
    return;
  }
  if (/^\/settings(?:@\w+)?$/i.test(text) || text === "⚙️ Настройки") {
    await showSettings(message.chat.id);
    return;
  }
  if (text === "🌐 Открыть приложение") {
    await sendMessage(message.chat.id, "Откройте приложение кнопкой ниже:", {
      reply_markup: { inline_keyboard: [[{ text: "🌐 Открыть приложение", url: APP_URL }]] },
    });
    return;
  }
  if (/^\/help(?:@\w+)?$/i.test(text) || text === "🆘 Помощь") {
    await showHelp(message.chat.id);
    return;
  }
  await sendMessage(message.chat.id, "Не нашёл такую команду. Выберите действие в меню ниже.", {
    reply_markup: MAIN_MENU,
  });
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<void> {
  const [action, event, value] = callback.data?.split("|") ?? [];
  const allowedActions = ["payment", "profile", "settings", "guide", "help"];
  if (!event || !value || !callback.message || !allowedActions.includes(action)) {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Команда устарела",
      show_alert: true,
    });
    return;
  }
  if (callback.message.chat.type && callback.message.chat.type !== "private") {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Кнопки доступны только в личном чате",
      show_alert: true,
    });
    return;
  }
  if (action === "settings" || action === "guide" || action === "help") {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: "Открываю раздел",
    });
    if (action === "settings") await showSettings(callback.message.chat.id, event);
    if (action === "guide") await showTutorial(callback.message.chat.id, event);
    if (action === "help") await showHelp(callback.message.chat.id, event);
    return;
  }
  if (action === "profile") {
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: event === "login" ? "Создаю новый код" : event === "renew" ? "Открываю тарифы" : "Обновляю профиль",
    });
    if (event === "login") {
      await showLoginCode(callback.message.chat.id, callback.from);
      return;
    }
    if (event === "renew") {
      await showPayment(callback.message.chat.id, callback.from);
      return;
    }
    if (event === "refresh") {
      await showProfile(callback.message.chat.id, callback.from);
      return;
    }
    return;
  }
  if (event === "plan") {
    const plan = paymentPlan(value);
    if (!plan) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Тариф не найден", show_alert: true });
      return;
    }
    const account = await getAccount(callback.from.id) ?? await createAccount(callback.from);
    const { order, created } = await createPaymentOrder(account, plan);
    if (created) {
      const notified = await notifyPaymentOperatorsNewOrder(order, account, callback.from);
      if (notified === 0) {
        await patchPaymentOrder(order.order_code, "waiting_operator", {
          status: "cancelled",
          rejected_at: new Date().toISOString(),
        });
        await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Оператор недоступен", show_alert: true });
        await sendMessage(callback.message.chat.id, "Не удалось доставить заявку оператору. Попробуйте позже.", {
          reply_markup: MAIN_MENU,
        });
        return;
      }
    }
    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: created ? "Тариф выбран, заявка создана" : "У вас уже есть активная заявка",
    });
    await telegram("editMessageReplyMarkup", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    await sendMessage(
      callback.message.chat.id,
      `💳 Оплата\n\nЗаявка: ${order.order_code}\n${paymentPlanText(order)}\n${paymentStatusText(order)}\n\nНе переводите деньги, пока здесь не появятся реквизиты.`,
      { reply_markup: userPaymentKeyboard(order) ?? MAIN_MENU },
    );
    return;
  }
  const orderCode = value;
  if (!/^PAY-[A-Z2-9]{8}$/.test(orderCode)) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Команда устарела", show_alert: true });
    return;
  }
  const order = await getPaymentOrder(orderCode, callback.from.id);
  if (!order) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Заявка не найдена", show_alert: true });
    return;
  }

  if (event === "reported" && order.status === "waiting_payment") {
    const updated = await patchPaymentOrder(order.order_code, "waiting_payment", {
      status: "payment_reported",
      payment_reported_at: new Date().toISOString(),
    });
    if (!updated) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Заявка уже обработана", show_alert: true });
      return;
    }
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Оплата отмечена" });
    await telegram("editMessageReplyMarkup", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    await notifyPaymentReported(updated);
    await sendMessage(
      callback.message.chat.id,
      `✅ Вы отметили оплату по заявке ${updated.order_code}.\n\nТеперь обязательно отправьте квитанцию: фото, скриншот или PDF до 10 МБ. Без квитанции оператор не сможет подтвердить оплату.`,
      { reply_markup: userPaymentKeyboard(updated) ?? MAIN_MENU },
    );
    return;
  }

  if (event === "cancel" && (order.status === "waiting_operator" || order.status === "waiting_payment")) {
    const cancelled = await patchPaymentOrder(order.order_code, order.status, {
      status: "cancelled",
      rejected_at: new Date().toISOString(),
    });
    if (!cancelled) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Заявка уже обработана", show_alert: true });
      return;
    }
    await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Заявка отменена" });
    await telegram("editMessageReplyMarkup", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    await Promise.allSettled(PAYMENT_OPERATOR_IDS.map(chatId => paymentTelegram("sendMessage", {
      chat_id: chatId,
      text: `Заявка ${order.order_code} отменена пользователем.`,
    })));
    await sendMessage(callback.message.chat.id, `Заявка ${order.order_code} отменена.`, { reply_markup: MAIN_MENU });
    return;
  }

  await telegram("answerCallbackQuery", {
    callback_query_id: callback.id,
    text: "Заявка уже обработана или кнопка устарела",
    show_alert: true,
  });
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
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    return new Response("ok");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unhandled user bot error");
    return new Response("ok");
  }
});
