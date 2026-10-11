type TelegramUser = { id: number };

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type?: string };
  text?: string;
  reply_to_message?: { text?: string };
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
  operator_telegram_user_id: number | null;
  receipt_received_at: string | null;
  receipt_kind: string | null;
  created_at: string;
  details_sent_at: string | null;
  payment_reported_at: string | null;
  confirmed_at: string | null;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  rejected_at: string | null;
};

type ProfileAccount = {
  telegram_user_id: number;
  profile_id: string;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  telegram_username: string | null;
};

const BOT_TOKEN = requiredEnv("TELEGRAM_PAYMENT_BOT_TOKEN");
const USER_BOT_TOKEN = requiredEnv("TELEGRAM_BOT_TOKEN");
const WEBHOOK_SECRET = requiredEnv("TELEGRAM_PAYMENT_WEBHOOK_SECRET");
const SUPABASE_URL = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const OPERATOR_IDS = new Set(
  requiredEnv("TELEGRAM_PAYMENT_OPERATOR_IDS").split(",").map(value => value.trim()).filter(Boolean),
);
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const USER_TELEGRAM_API = `https://api.telegram.org/bot${USER_BOT_TOKEN}`;
const ORDER_CODE_PATTERN = /^PAY-[A-Z2-9]{8}$/;

const NEW_BUTTON = "🆕 Новые заявки";
const WAITING_BUTTON = "⏳ Ожидают оплату";
const REVIEW_BUTTON = "🔎 На проверке";
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
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function isOperator(userId: number | undefined): boolean {
  return userId !== undefined && OPERATOR_IDS.has(String(userId));
}

function supabaseHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function botRequest(api: string, method: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram API request failed: ${response.status}`);
}

async function telegram(method: string, body: Record<string, unknown>): Promise<void> {
  await botRequest(TELEGRAM_API, method, body);
}

async function userTelegram(method: string, body: Record<string, unknown>): Promise<void> {
  await botRequest(USER_TELEGRAM_API, method, body);
}

async function sendMessage(chatId: number, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  await telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

function menuKeyboard(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: NEW_BUTTON }, { text: WAITING_BUTTON }],
      [{ text: REVIEW_BUTTON }, { text: HELP_BUTTON }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function configureWebhook(): Promise<void> {
  await telegram("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/telegram-payment-bot`,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "start", description: "Открыть панель оплаты" },
      { command: "new", description: "Новые заявки" },
      { command: "waiting", description: "Ожидают оплату" },
      { command: "review", description: "Оплата на проверке" },
      { command: "help", description: "Справка" },
    ],
  });
}

function orderSelect(): string {
  return "order_code,telegram_user_id,profile_id,plan_months,amount_uah,status,operator_telegram_user_id,receipt_received_at,receipt_kind,created_at,details_sent_at,payment_reported_at,confirmed_at,subscription_started_at,subscription_expires_at,rejected_at";
}

async function getOrder(orderCode: string): Promise<PaymentOrder | null> {
  const query = new URLSearchParams({ select: orderSelect(), order_code: `eq.${orderCode}`, limit: "1" });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`Payment order lookup failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

async function getAccount(telegramUserId: number): Promise<ProfileAccount | null> {
  const query = new URLSearchParams({
    select: "telegram_user_id,profile_id,telegram_first_name,telegram_last_name,telegram_username",
    telegram_user_id: `eq.${telegramUserId}`,
    limit: "1",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query}`, {
    headers: supabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Account lookup failed: ${response.status}`);
  const rows = await response.json() as ProfileAccount[];
  return rows[0] ?? null;
}

async function listOrders(status: PaymentStatus): Promise<PaymentOrder[]> {
  const query = new URLSearchParams({
    select: orderSelect(),
    status: `eq.${status}`,
    order: "created_at.asc",
    limit: "20",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`Payment order list failed: ${response.status}`);
  return await response.json() as PaymentOrder[];
}

async function patchOrder(
  orderCode: string,
  expectedStatus: PaymentStatus,
  changes: Record<string, unknown>,
  extraFilter?: Record<string, string>,
): Promise<PaymentOrder | null> {
  const query = new URLSearchParams({
    order_code: `eq.${orderCode}`,
    status: `eq.${expectedStatus}`,
    ...(extraFilter ?? {}),
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/payment_orders?${query}`, {
    method: "PATCH",
    headers: supabaseHeaders({ "content-type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Payment order update failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

function accountName(account: ProfileAccount | null): string {
  if (!account) return "Имя не найдено";
  return [account.telegram_first_name, account.telegram_last_name].filter(Boolean).join(" ").trim() || "Имя не указано";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
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

function statusName(status: PaymentStatus): string {
  if (status === "waiting_operator") return "ожидает реквизиты";
  if (status === "waiting_payment") return "ожидает оплату";
  if (status === "payment_reported") return "на проверке";
  if (status === "approved") return "подтверждена";
  if (status === "rejected") return "отклонена";
  return "отменена";
}

function paymentPlanText(order: PaymentOrder): string {
  if (!order.plan_months || !order.amount_uah) return "Тариф: не указан (старая заявка)";
  const monthWord = order.plan_months === 1 ? "месяц" : order.plan_months < 5 ? "месяца" : "месяцев";
  return `Тариф: ${order.plan_months} ${monthWord} · ${order.amount_uah} грн`;
}

function subscriptionWindowText(order: PaymentOrder): string | null {
  if (!order.subscription_started_at || !order.subscription_expires_at) return null;
  return `Подписка: ${formatDate(order.subscription_started_at)} → ${formatDate(order.subscription_expires_at)} (Киев)`;
}

function orderKeyboard(order: PaymentOrder): Record<string, unknown> {
  const rows: Array<Array<Record<string, string>>> = [];
  if (order.status === "waiting_operator") {
    rows.push([{ text: "💳 Отправить реквизиты", callback_data: `order|details|${order.order_code}` }]);
    rows.push([{ text: "❌ Отклонить", callback_data: `order|reject|${order.order_code}` }]);
  } else if (order.status === "waiting_payment") {
    rows.push([{ text: "❌ Отклонить", callback_data: `order|reject|${order.order_code}` }]);
  } else if (order.status === "payment_reported") {
    if (order.receipt_received_at) {
      rows.push([
        { text: "✅ Подтвердить", callback_data: `order|approve|${order.order_code}` },
        { text: "❌ Отклонить", callback_data: `order|reject|${order.order_code}` },
      ]);
    } else {
      rows.push([{ text: "❌ Отклонить", callback_data: `order|reject|${order.order_code}` }]);
    }
  }
  rows.push([{ text: MENU_BUTTON, callback_data: "nav|menu" }]);
  return { inline_keyboard: rows };
}

async function orderText(order: PaymentOrder): Promise<string> {
  const account = await getAccount(order.telegram_user_id);
  return [
    `Заявка: ${order.order_code}`,
    `Статус: ${statusName(order.status)}`,
    paymentPlanText(order),
    `Пользователь: ${accountName(account)}`,
    `DEMO-ID: ${order.profile_id}`,
    `Telegram ID: ${order.telegram_user_id}`,
    `Создана: ${formatDate(order.created_at)}`,
    `Чек: ${order.receipt_received_at ? `получен (${order.receipt_kind ?? "файл"})` : "не приложен"}`,
    subscriptionWindowText(order),
  ].filter((line): line is string => line !== null).join("\n");
}

async function showOrder(chatId: number, orderCode: string): Promise<void> {
  const order = await getOrder(orderCode);
  if (!order) {
    await sendMessage(chatId, `Заявка ${orderCode} не найдена.`, menuKeyboard());
    return;
  }
  await sendMessage(chatId, await orderText(order), orderKeyboard(order));
}

async function showMenu(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "Панель оплаты\n\nЗдесь можно отправить пользователю реквизиты, увидеть отметку об оплате и подтвердить результат.",
    menuKeyboard(),
  );
}

function listKeyboard(orders: PaymentOrder[], refreshAction: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      ...orders.map(order => [{
        text: `${order.order_code} · ${order.plan_months ?? "?"} мес · ${order.amount_uah ?? "?"} грн`.slice(0, 64),
        callback_data: `order|open|${order.order_code}`,
      }]),
      [
        { text: "🔄 Обновить", callback_data: `nav|${refreshAction}` },
        { text: MENU_BUTTON, callback_data: "nav|menu" },
      ],
    ],
  };
}

async function showList(chatId: number, status: PaymentStatus): Promise<void> {
  const orders = await listOrders(status);
  const heading = status === "waiting_operator"
    ? "Новые заявки"
    : status === "waiting_payment"
    ? "Ожидают оплату"
    : "Оплата на проверке";
  const action = status === "waiting_operator" ? "new" : status === "waiting_payment" ? "waiting" : "review";
  await sendMessage(
    chatId,
    orders.length ? `${heading}: ${orders.length}\n\nВыберите заявку.` : `${heading}: список пуст.`,
    listKeyboard(orders, action),
  );
}

async function showHelp(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    [
      "Справка по оплате",
      "",
      "1. Откройте новую заявку и нажмите «Отправить реквизиты».",
      "2. Ответьте на сообщение-подсказку текстом с реквизитами.",
      "3. Пользователь получит текст в пользовательском боте и нажмёт «Я оплатил».",
      "4. Дождитесь обязательной квитанции: без неё подтверждение недоступно.",
      "5. Нажмите «Подтвердить» только после фактической проверки перевода.",
      "",
      "Размер DEMO-маркировки меняется с 1 на 0 только после подтверждения.",
    ].join("\n"),
    menuKeyboard(),
  );
}

async function claimOrderForDetails(order: PaymentOrder, operatorId: number): Promise<PaymentOrder | null> {
  if (order.operator_telegram_user_id === operatorId) return order;
  if (order.operator_telegram_user_id !== null) return null;
  return await patchOrder(
    order.order_code,
    "waiting_operator",
    { operator_telegram_user_id: operatorId },
    { operator_telegram_user_id: "is.null" },
  );
}

function detailsPromptOrderCode(message: TelegramMessage): string | null {
  const prompt = message.reply_to_message?.text ?? "";
  const match = prompt.match(/Введите реквизиты для (PAY-[A-Z2-9]{8})\./);
  return match?.[1] ?? null;
}

async function sendPaymentDetails(message: TelegramMessage, orderCode: string, details: string): Promise<void> {
  const order = await getOrder(orderCode);
  if (!order || order.status !== "waiting_operator" || order.operator_telegram_user_id !== message.from?.id) {
    await sendMessage(message.chat.id, "Заявка уже обработана или назначена другому оператору.", menuKeyboard());
    return;
  }
  const normalized = details.trim();
  if (normalized.length < 4 || normalized.length > 500) {
    await sendMessage(message.chat.id, "Реквизиты должны содержать от 4 до 500 символов. Ответьте ещё раз на подсказку.");
    return;
  }

  await userTelegram("sendMessage", {
    chat_id: order.telegram_user_id,
    text: `💳 Реквизиты по заявке ${order.order_code}\n${paymentPlanText(order)}\n\nК оплате: ${order.amount_uah ?? "уточните у оператора"} грн\n\n${normalized}\n\nПосле перевода нажмите «✅ Я оплатил» и обязательно отправьте квитанцию фото, изображением или PDF. Без квитанции оплата не подтверждается.`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Я оплатил", callback_data: `payment|reported|${order.order_code}` }],
        [{ text: "❌ Отменить заявку", callback_data: `payment|cancel|${order.order_code}` }],
      ],
    },
  });

  const updated = await patchOrder(order.order_code, "waiting_operator", {
    status: "waiting_payment",
    details_sent_at: new Date().toISOString(),
  });
  if (!updated) throw new Error("Payment details were sent but order state was not updated");
  await sendMessage(message.chat.id, `✅ Реквизиты по заявке ${order.order_code} отправлены пользователю.`, menuKeyboard());
}

async function approveOrder(orderCode: string, operatorId: number): Promise<PaymentOrder | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approve_payment_order`, {
    method: "POST",
    headers: supabaseHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ p_order_code: orderCode, p_operator_telegram_user_id: operatorId }),
  });
  if (!response.ok) throw new Error(`Payment approval failed: ${response.status}`);
  const rows = await response.json() as PaymentOrder[];
  return rows[0] ?? null;
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  if (!isOperator(message.from?.id)) {
    await sendMessage(message.chat.id, "Доступ запрещён.");
    return;
  }
  if (message.chat.type && message.chat.type !== "private") {
    await sendMessage(message.chat.id, "Используйте бота оплаты только в личном чате.");
    return;
  }

  const text = message.text?.trim() ?? "";
  const promptOrderCode = detailsPromptOrderCode(message);
  if (promptOrderCode && text) {
    await sendPaymentDetails(message, promptOrderCode, text);
    return;
  }
  if (/^\/start(?:@\w+)?$/i.test(text) || text === MENU_BUTTON) {
    await showMenu(message.chat.id);
    return;
  }
  if (/^\/new(?:@\w+)?$/i.test(text) || text === NEW_BUTTON) {
    await showList(message.chat.id, "waiting_operator");
    return;
  }
  if (/^\/waiting(?:@\w+)?$/i.test(text) || text === WAITING_BUTTON) {
    await showList(message.chat.id, "waiting_payment");
    return;
  }
  if (/^\/review(?:@\w+)?$/i.test(text) || text === REVIEW_BUTTON) {
    await showList(message.chat.id, "payment_reported");
    return;
  }
  if (/^\/help(?:@\w+)?$/i.test(text) || text === HELP_BUTTON) {
    await showHelp(message.chat.id);
    return;
  }
  const orderCode = text.toUpperCase();
  if (ORDER_CODE_PATTERN.test(orderCode)) {
    await showOrder(message.chat.id, orderCode);
    return;
  }
  await sendMessage(message.chat.id, "Выберите действие в меню или отправьте номер заявки вида PAY-ABCDEFGH.", menuKeyboard());
}

async function answerCallback(callbackId: string, text = "", showAlert = false): Promise<void> {
  await telegram("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
    ...(showAlert ? { show_alert: true } : {}),
  });
}

async function handleCallback(callback: TelegramCallbackQuery): Promise<void> {
  if (!isOperator(callback.from.id)) {
    await answerCallback(callback.id, "Доступ запрещён", true);
    return;
  }
  const [action, event, orderCode] = callback.data?.split("|") ?? [];
  if (action === "nav" && callback.message) {
    await answerCallback(callback.id);
    if (event === "new") await showList(callback.message.chat.id, "waiting_operator");
    else if (event === "waiting") await showList(callback.message.chat.id, "waiting_payment");
    else if (event === "review") await showList(callback.message.chat.id, "payment_reported");
    else await showMenu(callback.message.chat.id);
    return;
  }
  if (action !== "order" || !event || !orderCode || !ORDER_CODE_PATTERN.test(orderCode) || !callback.message) {
    await answerCallback(callback.id, "Команда устарела", true);
    return;
  }
  const order = await getOrder(orderCode);
  if (!order) {
    await answerCallback(callback.id, "Заявка не найдена", true);
    return;
  }
  if (event === "open") {
    await answerCallback(callback.id);
    await showOrder(callback.message.chat.id, order.order_code);
    return;
  }
  if (event === "details" && order.status === "waiting_operator") {
    const claimed = await claimOrderForDetails(order, callback.from.id);
    if (!claimed) {
      await answerCallback(callback.id, "Заявку уже взял другой оператор", true);
      return;
    }
    await answerCallback(callback.id, "Введите реквизиты ответом");
    await sendMessage(
      callback.message.chat.id,
      `Введите реквизиты для ${order.order_code}.\n${paymentPlanText(order)}\n\nОтветьте именно на это сообщение. Текст будет без изменений отправлен пользователю.`,
      { force_reply: true, selective: true, input_field_placeholder: "Номер карты или другие реквизиты" },
    );
    return;
  }
  if (event === "approve" && order.status === "payment_reported") {
    if (!order.receipt_received_at) {
      await answerCallback(callback.id, "Сначала пользователь должен отправить квитанцию", true);
      return;
    }
    const approved = await approveOrder(order.order_code, callback.from.id);
    if (!approved) {
      await answerCallback(callback.id, "Заявка уже обработана", true);
      return;
    }
    let userNotified = true;
    try {
      await userTelegram("sendMessage", {
        chat_id: approved.telegram_user_id,
        text: `✅ Оплата по заявке ${approved.order_code} подтверждена.\n${paymentPlanText(approved)}\n${subscriptionWindowText(approved) ?? ""}\n\nДля профиля ${approved.profile_id} включена компактная DEMO-маркировка (режим 0). После указанной секунды автоматически вернётся режим 1.`,
      });
    } catch {
      userNotified = false;
      console.error("Approved payment user notification failed");
    }
    await answerCallback(callback.id, "Оплата подтверждена");
    await sendMessage(
      callback.message.chat.id,
      `✅ Заявка ${approved.order_code} подтверждена.\n${paymentPlanText(approved)}\n${subscriptionWindowText(approved) ?? ""}\nРежим профиля изменён 1 → 0; по окончании срока автоматически действует режим 1.${userNotified ? "" : " Уведомление пользователю не доставлено."}`,
      menuKeyboard(),
    );
    return;
  }
  if (event === "reject" && ["waiting_operator", "waiting_payment", "payment_reported"].includes(order.status)) {
    const rejected = await patchOrder(order.order_code, order.status, {
      status: "rejected",
      operator_telegram_user_id: callback.from.id,
      rejected_at: new Date().toISOString(),
    });
    if (!rejected) {
      await answerCallback(callback.id, "Заявка уже обработана", true);
      return;
    }
    let userNotified = true;
    try {
      await userTelegram("sendMessage", {
        chat_id: rejected.telegram_user_id,
        text: `❌ Заявка ${rejected.order_code} отклонена оператором.\n${paymentPlanText(rejected)}\n\nРазмер DEMO-маркировки не изменён. Для уточнения свяжитесь с поддержкой или создайте новую заявку.`,
      });
    } catch {
      userNotified = false;
      console.error("Rejected payment user notification failed");
    }
    await answerCallback(callback.id, "Заявка отклонена");
    await sendMessage(
      callback.message.chat.id,
      `Заявка ${rejected.order_code} отклонена.${userNotified ? "" : " Уведомление пользователю не доставлено."}`,
      menuKeyboard(),
    );
    return;
  }
  await answerCallback(callback.id, "Заявка уже обработана или кнопка устарела", true);
}

Deno.serve(async request => {
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("setup") === "webhook") {
    try {
      await configureWebhook();
      return new Response("Payment bot webhook configured. You can close this page.");
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
    console.error(error instanceof Error ? error.message : "Unhandled payment bot error");
    return new Response("ok");
  }
});
