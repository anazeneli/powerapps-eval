const STORAGE_KEY = 'kyc.userId';

let userId = localStorage.getItem(STORAGE_KEY) ?? 'u-taylor';

export function getUserId(): string {
  return userId;
}

export function setUserId(id: string): void {
  userId = id;
  localStorage.setItem(STORAGE_KEY, id);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'x-user-id': userId, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res;
}

export async function get<T>(path: string): Promise<T> {
  return (await request(path)).json();
}

export async function post<T>(path: string, body: unknown = {}): Promise<T> {
  return (await request(path, { method: 'POST', body: JSON.stringify(body) })).json();
}

export async function download(path: string, filename: string): Promise<void> {
  const blob = await (await request(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
