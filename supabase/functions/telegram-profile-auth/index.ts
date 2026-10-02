type AccountRow = {
  profile_id: string;
  login_code_hash: string | null;
  login_code_expires_at: string | null;
};

const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function findAccount(field: 'login_code_hash' | 'session_token_hash', hash: string): Promise<AccountRow | null> {
  const query = new URLSearchParams({
    select: 'profile_id,login_code_hash,login_code_expires_at',
    [field]: `eq.${hash}`,
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query}`, {
    headers: headers(),
  });
  if (!response.ok) throw new Error(`Account lookup failed: ${response.status}`);
  const rows = await response.json() as AccountRow[];
  return rows[0] ?? null;
}

async function exchange(code: string): Promise<Response> {
  const normalized = code.trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) return json({ error: 'invalid-code' }, 400);
  const codeHash = await sha256(normalized);
  const account = await findAccount('login_code_hash', codeHash);
  if (!account || !account.login_code_expires_at || Date.parse(account.login_code_expires_at) <= Date.now()) {
    return json({ error: 'code-expired' }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const loginAt = new Date().toISOString();
  const query = new URLSearchParams({ login_code_hash: `eq.${codeHash}` });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query}`, {
    method: 'PATCH',
    headers: headers({ 'content-type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      session_token_hash: tokenHash,
      login_code_hash: null,
      login_code_expires_at: null,
      last_login_at: loginAt,
      updated_at: loginAt,
    }),
  });
  if (!response.ok) throw new Error(`Session update failed: ${response.status}`);
  const updated = await response.json() as AccountRow[];
  if (!updated[0]) return json({ error: 'code-already-used' }, 401);
  return json({ profile_id: account.profile_id, session_token: token });
}

async function resume(token: string): Promise<Response> {
  if (!TOKEN_PATTERN.test(token)) return json({ error: 'invalid-session' }, 401);
  const account = await findAccount('session_token_hash', await sha256(token));
  if (!account) return json({ error: 'invalid-session' }, 401);

  const loginAt = new Date().toISOString();
  const query = new URLSearchParams({ profile_id: `eq.${account.profile_id}` });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/telegram_profile_accounts?${query}`, {
    method: 'PATCH',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify({ last_login_at: loginAt, updated_at: loginAt }),
  });
  if (!response.ok) throw new Error(`Last login update failed: ${response.status}`);
  return json({ profile_id: account.profile_id });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  try {
    const body = await request.json() as { action?: unknown; code?: unknown; session_token?: unknown };
    if (body.action === 'exchange' && typeof body.code === 'string') return await exchange(body.code);
    if (body.action === 'resume' && typeof body.session_token === 'string') return await resume(body.session_token);
    return json({ error: 'invalid-request' }, 400);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Profile auth error');
    return json({ error: 'server-error' }, 500);
  }
});
