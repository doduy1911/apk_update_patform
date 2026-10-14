import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const api = vi.hoisted(() => ({
  getSession: vi.fn(), login: vi.fn(), logout: vi.fn(), listApps: vi.fn(), createApp: vi.fn(),
  listReleases: vi.fn(), uploadRelease: vi.fn(), withdrawRelease: vi.fn(),
}));
vi.mock('./api/client', () => api);

const session = { admin: { username: 'admin' }, csrfToken: 'csrf-token' };
const tubeLite = { id: 'app-1', name: 'TubeLite', packageName: 'com.tubelite', signingCertSha256: null };
const release = { id: 'release-1', versionCode: 3, versionName: '2.1.0', releaseNotes: 'Sửa lỗi',
  sizeBytes: 12_000_000, status: 'published', minSdk: 26, supportedAbis: ['arm64-v8a'],
  downloadUrl: 'https://updates.example.test/downloads/release-1/app.apk', createdAt: '2026-10-15T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  api.listApps.mockResolvedValue([]);
  api.listReleases.mockResolvedValue([]);
  api.uploadRelease.mockResolvedValue({ release, downloadUrl: release.downloadUrl });
  api.withdrawRelease.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openConsole(apps = [tubeLite], releases: typeof release[] = []) {
  api.getSession.mockResolvedValue(session);
  api.listApps.mockResolvedValue(apps);
  api.listReleases.mockResolvedValue(releases);
  render(<App />);
  await screen.findByRole('heading', { name: /ứng dụng của bạn/i });
}

describe('APK administration console', () => {
  it('shows loading while restoring the admin session', async () => {
    let finishSession!: (value: typeof session) => void;
    api.getSession.mockReturnValue(new Promise((resolve) => { finishSession = resolve; }));
    render(<App />);
    expect(screen.getByText('Đang kiểm tra phiên đăng nhập…')).toBeInTheDocument();
    finishSession(session);
    expect(await screen.findByRole('heading', { name: /ứng dụng của bạn/i })).toBeInTheDocument();
  });

  it('shows the login form when there is no existing session', async () => {
    api.getSession.mockRejectedValue(new Error('Unauthorized'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Đăng nhập quản trị' })).toBeInTheDocument();
    expect(screen.getByLabelText('Tên đăng nhập')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument();
  });

  it('shows a login error without leaving the form', async () => {
    api.getSession.mockRejectedValue(new Error('Unauthorized'));
    api.login.mockRejectedValue(new Error('Tên đăng nhập hoặc mật khẩu không đúng.'));
    render(<App />);
    await screen.findByLabelText('Tên đăng nhập');
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tên đăng nhập hoặc mật khẩu không đúng.');
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('returns to login when the server expires an admin session', async () => {
    await openConsole();
    api.listReleases.mockRejectedValueOnce(Object.assign(new Error('Phiên quản trị đã hết hạn.'), { status: 401 }));
    fireEvent.click(screen.getByRole('button', { name: /tubelite/i }));
    expect(await screen.findByRole('heading', { name: 'Đăng nhập quản trị' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Phiên quản trị đã hết hạn.');
  });

  it('shows the empty state and creates an app once', async () => {
    await openConsole([]);
    expect(screen.getByText('Chưa có ứng dụng nào')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo ứng dụng' }));
    fireEvent.change(screen.getByLabelText('Tên ứng dụng'), { target: { value: 'TubeLite' } });
    fireEvent.change(screen.getByLabelText('Package name'), { target: { value: 'com.tubelite' } });
    api.createApp.mockResolvedValue({ app: tubeLite });
    api.listApps.mockResolvedValue([tubeLite]);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu ứng dụng' }));
    expect(await screen.findByRole('button', { name: /tubelite/i })).toBeInTheDocument();
    expect(api.createApp).toHaveBeenCalledWith({ name: 'TubeLite', packageName: 'com.tubelite' }, 'csrf-token');
  });

  it('shows upload progress and prevents a second submission while uploading', async () => {
    await openConsole();
    fireEvent.click(screen.getByRole('button', { name: /tubelite/i }));
    await screen.findByText('Chưa có bản phát hành');
    let finishUpload!: (result: { release: typeof release; downloadUrl: string }) => void;
    api.uploadRelease.mockImplementation((_appId, _file, _notes, _csrf, onProgress) => {
      onProgress(50);
      return new Promise((resolve) => { finishUpload = resolve; });
    });
    const file = new File(['apk-data'], 'tubelite.apk', { type: 'application/vnd.android.package-archive' });
    fireEvent.change(screen.getByLabelText('File APK'), { target: { files: [file] } });
    expect(screen.getByText('tubelite.apk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phát hành APK' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành APK' }));
    expect(api.uploadRelease).toHaveBeenCalled();
    expect(await screen.findByText('Đang tải lên 50%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang tải APK…' })).toBeDisabled();
    finishUpload({ release, downloadUrl: release.downloadUrl });
    expect(await screen.findByRole('link', { name: 'Mở link APK' })).toHaveAttribute('href', release.downloadUrl);
  });

  it('keeps a failed upload in error state without showing a success link', async () => {
    await openConsole();
    fireEvent.click(screen.getByRole('button', { name: /tubelite/i }));
    await screen.findByText('Chưa có bản phát hành');
    api.uploadRelease.mockRejectedValueOnce(new Error('Chữ ký APK không hợp lệ.'));
    const file = new File(['fake-apk'], 'broken.apk', { type: 'application/vnd.android.package-archive' });
    fireEvent.change(screen.getByLabelText('File APK'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành APK' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chữ ký APK không hợp lệ.');
    expect(screen.queryByRole('link', { name: 'Mở link APK' })).not.toBeInTheDocument();
  });

  it('asks before withdrawal and refreshes status after confirmation', async () => {
    await openConsole();
    api.listReleases.mockResolvedValueOnce([release]).mockResolvedValueOnce([{ ...release, status: 'withdrawn' }]);
    fireEvent.click(screen.getByRole('button', { name: /tubelite/i }));
    await screen.findByText('Version 3 · 2.1.0');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(screen.getByTestId('release-release-1')).getByRole('button', { name: 'Thu hồi' }));
    expect(api.withdrawRelease).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(within(screen.getByTestId('release-release-1')).getByRole('button', { name: 'Thu hồi' }));
    await waitFor(() => expect(api.withdrawRelease).toHaveBeenCalledWith('release-1', 'csrf-token'));
    expect(await within(screen.getByTestId('release-release-1')).findByText('Đã thu hồi')).toBeInTheDocument();
  });
});
