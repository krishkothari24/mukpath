import { API_URL, REQUEST_TIMEOUT_MS } from '@/lib/config';
import type { Goal, ProgressRow, Text, User, VerseApiRow } from '@/lib/types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // Offline, wrong LAN IP, backend not running — all land here. The screens
    // fall back to the SQLite cache, so this needs to be legible, not fatal.
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : 'unreachable';
    throw new ApiError(0, `Can't reach the server at ${API_URL} (${reason})`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  const payload = text ? safeParse(text) : null;

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: { name, email, password },
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  // The response also carries a `kids` array; the app ignores it. See the
  // note in lib/auth.tsx — one account, one learner.
  me: (token: string) => request<User>('/me', { token }),

  // Content is public — no token needed. There is no /sections endpoint;
  // sections arrive joined onto each verse row.
  texts: () => request<Text[]>('/texts'),

  verses: (textId: string) =>
    request<VerseApiRow[]>(`/texts/${encodeURIComponent(textId)}/verses`),

  // Practice. All of these are per-learner, so all of them need a token.
  progress: (token: string) => request<ProgressRow[]>('/progress', { token }),

  /**
   * Flush graded reviews. Sends the events, not the schedule the phone
   * computed — the server recomputes and returns the canonical rows, which
   * the phone then adopts. See lib/scheduler.ts.
   */
  submitReviews: (
    token: string,
    reviews: { verse_id: string; grade: string; reviewed_on: string }[],
  ) =>
    request<{ progress: ProgressRow[] }>('/progress', {
      method: 'POST',
      token,
      body: { reviews },
    }),

  goals: (token: string, date: string) =>
    request<Goal[]>(`/goals?date=${encodeURIComponent(date)}`, { token }),

  /** Distinct days this learner has practised, per the server's log. */
  practiceDays: (token: string) => request<string[]>('/practice/days', { token }),

  createGoal: (
    token: string,
    goal: { target_type: 'text' | 'section'; target_id: string; target_date: string; today: string },
  ) => request<Goal>('/goals', { method: 'POST', token, body: goal }),

  deleteGoal: (token: string, id: string) =>
    request<null>(`/goals/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
};
