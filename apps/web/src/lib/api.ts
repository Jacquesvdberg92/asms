const TOKEN_KEY = 'asms.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode - session lives in memory only */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent('asms:unauthorized'));
    throw new ApiError('Session expired - sign in again', 401);
  }
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const message = (payload as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T,>(path: string) => request<T>('DELETE', path),
};

/**
 * Start a download.
 *
 * A plain navigation cannot carry an Authorization header, so this used to put
 * the session token in the query string — where it lands in access logs,
 * browser history and any proxy in between. Instead the server issues a ticket
 * that is good for this one path, once, for a minute.
 */
export async function download(path: string): Promise<void> {
  const url = await downloadUrl(path);
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** The ticketed URL for a download, for cases that need the string itself. */
export async function downloadUrl(path: string): Promise<string> {
  const base = `/api${path}`;
  if (!getToken()) return base;
  // The ticket is issued for the path the server will see, query string and all.
  const { ticket } = await api.post<{ ticket: string }>('/auth/ticket', { path: base.split('?')[0] });
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}ticket=${encodeURIComponent(ticket)}`;
}

/** A one-shot ticket for the websocket handshake, which cannot send headers either. */
export async function socketTicket(): Promise<string | null> {
  if (!getToken()) return null;
  try {
    const { ticket } = await api.post<{ ticket: string }>('/auth/ticket', { path: '/ws' });
    return ticket;
  } catch {
    return null;
  }
}
