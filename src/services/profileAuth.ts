export type ProfileSession = {
  profileId: string;
  token: string;
};

type AuthResponse = {
  profile_id?: unknown;
  session_token?: unknown;
  error?: unknown;
};

const SESSION_KEY = 'oblik-demo-profile-session-v1';

function authUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) return null;
  try {
    return `${new URL(value).origin}/functions/v1/telegram-profile-auth`;
  } catch {
    return null;
  }
}

function isProfileId(value: unknown): value is string {
  return typeof value === 'string' && /^DEMO-[A-Z0-9-]{4,40}$/.test(value);
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,200}$/.test(value);
}

export function loadProfileSession(): ProfileSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<ProfileSession> | null;
    return parsed && isProfileId(parsed.profileId) && isToken(parsed.token)
      ? { profileId: parsed.profileId, token: parsed.token }
      : null;
  } catch {
    return null;
  }
}

export function saveProfileSession(session: ProfileSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearProfileSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

async function requestAuth(body: Record<string, string>): Promise<AuthResponse> {
  const url = authUrl();
  if (!url) throw new Error('missing-config');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({})) as AuthResponse;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'request-failed');
  return data;
}

export async function exchangeTelegramCode(code: string): Promise<ProfileSession> {
  const data = await requestAuth({ action: 'exchange', code: code.trim().toUpperCase() });
  if (!isProfileId(data.profile_id) || !isToken(data.session_token)) throw new Error('invalid-response');
  const session = { profileId: data.profile_id, token: data.session_token };
  saveProfileSession(session);
  return session;
}

export async function resumeProfileSession(session: ProfileSession): Promise<string> {
  const data = await requestAuth({ action: 'resume', session_token: session.token });
  if (!isProfileId(data.profile_id)) throw new Error('invalid-session');
  return data.profile_id;
}
