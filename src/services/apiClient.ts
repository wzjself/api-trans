const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function url(path: string) {
  return `${API_BASE}${path}`;
}

let authToken = localStorage.getItem('api_trans_token') || '';

export function setAuthToken(token: string | null) {
  authToken = token || '';
  if (authToken) localStorage.setItem('api_trans_token', authToken);
  else localStorage.removeItem('api_trans_token');
}

export function getAuthToken() {
  return authToken;
}

async function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

  const res = await fetch(url(path), { ...options, headers });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'error' in data ? (data as any).error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const apiClient = {
  get: (path: string) => request(path),
  post: (path: string, body?: any) => request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: (path: string, body?: any) => request(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: (path: string, body?: any) => request(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};
