const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export type AdminSession = { admin: { username: string }; csrfToken: string };
export type AppRecord = { id: string; name: string; packageName: string; signingCertSha256: string | null };
export type ReleaseRecord = {
  id: string; appId: string; packageName?: string; versionCode: number; versionName: string;
  releaseNotes: string | null; minSdk: number; supportedAbis: string[]; sha256: string;
  signingCertSha256: string; sizeBytes: number; status: 'published' | 'withdrawn';
  createdAt: string; downloadUrl: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...(init.headers ?? {}) },
  });
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function responseError(response: Response) {
  let body: { error?: { message?: string; code?: string } } = {};
  try { body = await response.json() as typeof body; } catch { /* Use generic fallback below. */ }
  return new ApiError(body.error?.message || 'Không thể kết nối máy chủ. Vui lòng thử lại.', response.status, body.error?.code);
}

export function getSession() {
  return request<AdminSession>('/admin/auth/me');
}

export function login(username: string, password: string) {
  return request<AdminSession>('/admin/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
}

export function logout(csrfToken: string) {
  return request<void>('/admin/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
}

export async function listApps() {
  return (await request<{ apps: AppRecord[] }>('/admin/apps')).apps;
}

export function createApp(value: { name: string; packageName: string }, csrfToken: string) {
  return request<{ app: AppRecord }>('/admin/apps', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(value),
  });
}

export async function listReleases(appId: string) {
  return (await request<{ releases: ReleaseRecord[] }>(`/admin/apps/${encodeURIComponent(appId)}/releases`)).releases;
}

export function uploadRelease(
  appId: string,
  file: File,
  releaseNotes: string,
  csrfToken: string,
  onProgress: (percent: number) => void,
) {
  return new Promise<{ release: ReleaseRecord; downloadUrl: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/admin/apps/${encodeURIComponent(appId)}/releases`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.floor(event.loaded / event.total * 100)));
    };
    xhr.onerror = () => reject(new ApiError('Mất kết nối khi upload. File chưa được xác nhận phát hành.', 0));
    xhr.onabort = () => reject(new ApiError('Upload đã bị hủy.', 0));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as { release: ReleaseRecord; downloadUrl: string }); }
        catch { reject(new ApiError('Máy chủ trả về dữ liệu không hợp lệ.', xhr.status)); }
        return;
      }
      let body: { error?: { message?: string; code?: string } } = {};
      try { body = JSON.parse(xhr.responseText) as typeof body; } catch { /* Use generic fallback below. */ }
      reject(new ApiError(body.error?.message || 'Upload thất bại. Vui lòng thử lại.', xhr.status, body.error?.code));
    };
    const form = new FormData();
    form.append('apk', file, file.name);
    form.append('releaseNotes', releaseNotes);
    xhr.send(form);
  });
}

export function withdrawRelease(releaseId: string, csrfToken: string) {
  return request<void>(`/admin/releases/${encodeURIComponent(releaseId)}/withdraw`, {
    method: 'POST', headers: { 'X-CSRF-Token': csrfToken },
  });
}
