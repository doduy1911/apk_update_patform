import { useEffect, useState, type FormEvent } from 'react';
import {
  createApp, getSession, listApps, listReleases, login, logout, uploadRelease, withdrawRelease,
  type AdminSession, type AppRecord, type ReleaseRecord,
} from './api/client';
import './app.css';

type View = 'checking' | 'login' | 'console';

function displaySize(size: number) {
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  return `${(size / 1024 ** 2).toFixed(size >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

export default function App() {
  const [view, setView] = useState<View>('checking');
  const [session, setSession] = useState<AdminSession | null>(null);
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppRecord | null>(null);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [isAppsLoading, setAppsLoading] = useState(false);
  const [isReleasesLoading, setReleasesLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isUploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [showAppForm, setShowAppForm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [appName, setAppName] = useState('');
  const [packageName, setPackageName] = useState('');
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [releaseNotes, setReleaseNotes] = useState('');
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleProtectedError(caught: unknown) {
    if (statusOf(caught) === 401) {
      setSession(null); setApps([]); setSelectedApp(null); setReleases([]); setView('login');
    }
    setError(messageOf(caught));
  }

  async function refreshReleases(appId: string) {
    setReleasesLoading(true);
    try { setReleases(await listReleases(appId)); }
    catch (caught) { handleProtectedError(caught); }
    finally { setReleasesLoading(false); }
  }

  useEffect(() => {
    let active = true;
    getSession().then(async (currentSession) => {
      if (!active) return;
      setSession(currentSession);
      setView('console');
      setAppsLoading(true);
      try { setApps(await listApps()); }
      catch (caught) { if (active) handleProtectedError(caught); }
      finally { if (active) setAppsLoading(false); }
    }).catch((caught) => {
      if (!active) return;
      setView('login');
      if (statusOf(caught) !== 401) setError(messageOf(caught));
    });
    return () => { active = false; };
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setSubmitting(true); setError(null);
    try {
      const createdSession = await login(username.trim(), password);
      setSession(createdSession);
      setView('console');
      setPassword('');
      setAppsLoading(true);
      try { setApps(await listApps()); }
      catch (caught) { handleProtectedError(caught); }
      finally { setAppsLoading(false); }
    } catch (caught) { handleProtectedError(caught); }
    finally { setSubmitting(false); }
  }

  async function handleCreateApp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || isSubmitting) return;
    setSubmitting(true); setError(null);
    try {
      const result = await createApp({ name: appName.trim(), packageName: packageName.trim() }, session.csrfToken);
      const created = result.app;
      setApps((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedApp(created); setReleases([]); setShowAppForm(false); setAppName(''); setPackageName('');
    } catch (caught) { handleProtectedError(caught); }
    finally { setSubmitting(false); }
  }

  async function selectApp(app: AppRecord) {
    setSelectedApp(app); setError(null); setSuccessUrl(null); setNotice(null);
    await refreshReleases(app.id);
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedApp || !apkFile || isUploading) return;
    setUploading(true); setProgress(0); setError(null); setSuccessUrl(null); setNotice(null);
    try {
      const result = await uploadRelease(selectedApp.id, apkFile, releaseNotes.trim(), session.csrfToken, setProgress);
      setSuccessUrl(result.downloadUrl);
      setNotice(`Đã phát hành version ${result.release.versionCode} · ${result.release.versionName}`);
      setApkFile(null); setReleaseNotes('');
      const input = document.getElementById('apk-file') as HTMLInputElement | null;
      if (input) input.value = '';
      await refreshReleases(selectedApp.id);
    } catch (caught) { handleProtectedError(caught); }
    finally { setUploading(false); }
  }

  async function handleWithdraw(release: ReleaseRecord) {
    if (!session || withdrawingId || release.status !== 'published') return;
    const confirmed = window.confirm(`Thu hồi version ${release.versionCode} · ${release.versionName}? Thiết bị chưa tải sẽ không nhận được bản này nữa.`);
    if (!confirmed) return;
    setWithdrawingId(release.id); setError(null); setNotice(null);
    try {
      await withdrawRelease(release.id, session.csrfToken);
      setNotice(`Đã thu hồi version ${release.versionCode}.`);
      await refreshReleases(release.appId);
    } catch (caught) { handleProtectedError(caught); }
    finally { setWithdrawingId(null); }
  }

  async function handleLogout() {
    if (!session) return;
    setSubmitting(true); setError(null);
    try {
      await logout(session.csrfToken);
      setSession(null); setApps([]); setSelectedApp(null); setReleases([]); setView('login');
    } catch (caught) { handleProtectedError(caught); }
    finally { setSubmitting(false); }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Đã sao chép link APK.');
    } catch { setError('Không thể sao chép link trên trình duyệt này.'); }
  }

  if (view === 'checking') {
    return <main className="boot-screen"><span className="brand-mark">A</span><p>Đang kiểm tra phiên đăng nhập…</p></main>;
  }

  if (view === 'login') {
    return (
      <main className="auth-layout">
        <section className="auth-aside">
          <a className="brand" href="/" aria-label="APK Update trang chủ"><span className="brand-mark">A</span><span>APK Update</span></a>
          <div className="auth-pitch">
            <span className="eyebrow">RELEASE CONTROL</span>
            <h1>Phát hành bản cập nhật<br /><em>một cách an tâm.</em></h1>
            <p>Một nơi quản lý phiên bản APK, chữ ký và đường tải cho tất cả ứng dụng của bạn.</p>
          </div>
          <span className="aside-foot">BẢNG ĐIỀU KHIỂN QUẢN TRỊ · V1</span>
        </section>
        <section className="auth-main">
          <form className="login-card" onSubmit={handleLogin}>
            <span className="form-kicker">CHÀO MỪNG TRỞ LẠI</span>
            <h2>Đăng nhập quản trị</h2>
            <p className="muted">Nhập tài khoản quản trị để tiếp tục.</p>
            {error && <div className="alert error" role="alert">{error}</div>}
            <label className="field-label" htmlFor="admin-username">Tên đăng nhập</label>
            <input id="admin-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
            <label className="field-label" htmlFor="admin-password">Mật khẩu</label>
            <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button className="button primary full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'} <span aria-hidden="true">→</span>
            </button>
            <p className="login-foot">Phiên đăng nhập được bảo vệ bằng cookie an toàn.</p>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="APK Update"><span className="brand-mark">A</span><span>APK Update</span></a>
        <div className="topbar-right">
          <span className="secure-label"><span className="secure-dot" /> Hệ thống sẵn sàng</span>
          <span className="user-chip"><span className="avatar">{session?.admin.username.slice(0, 1).toUpperCase()}</span><span>{session?.admin.username}</span></span>
          <button className="button text-button" onClick={handleLogout} disabled={isSubmitting}>Đăng xuất</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="app-rail">
          <div className="rail-heading"><div><span className="section-label">WORKSPACE</span><h2>Ứng dụng</h2></div><span className="count-pill">{apps.length}</span></div>
          <button className="button primary create-trigger" onClick={() => { setShowAppForm((show) => !show); setError(null); }}>
            <span aria-hidden="true">＋</span> Tạo ứng dụng
          </button>

          {showAppForm && <form className="app-create-form" onSubmit={handleCreateApp}>
            <label className="field-label" htmlFor="new-app-name">Tên ứng dụng</label>
            <input id="new-app-name" value={appName} onChange={(event) => setAppName(event.target.value)} required maxLength={120} placeholder="TubeLite" />
            <label className="field-label" htmlFor="new-app-package">Package name</label>
            <input id="new-app-package" value={packageName} onChange={(event) => setPackageName(event.target.value)} required placeholder="com.example.app" pattern="[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+" />
            <div className="form-actions"><button type="button" className="button text-button" onClick={() => setShowAppForm(false)}>Hủy</button><button className="button primary" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Đang lưu…' : 'Lưu ứng dụng'}</button></div>
          </form>}

          <div className="app-list" aria-label="Danh sách ứng dụng">
            {isAppsLoading ? <p className="rail-empty">Đang tải danh sách…</p> : apps.length === 0 ? <div className="rail-empty"><span className="empty-icon">◈</span><strong>Chưa có ứng dụng nào</strong><span>Tạo ứng dụng đầu tiên để bắt đầu phát hành APK.</span></div> : apps.map((item) => (
              <button key={item.id} className={`app-nav-item${selectedApp?.id === item.id ? ' active' : ''}`} onClick={() => void selectApp(item)}>
                <span className="app-icon">{item.name.slice(0, 1).toUpperCase()}</span><span className="app-nav-copy"><strong>{item.name}</strong><small>{item.packageName}</small></span><span className="nav-chevron">›</span>
              </button>
            ))}
          </div>
          <div className="rail-tip"><span aria-hidden="true">✦</span><p>Package name và chữ ký phải khớp với APK khi phát hành.</p></div>
        </aside>

        <section className="main-panel">
          <div className="page-heading">
            <div><span className="section-label">RELEASE MANAGEMENT</span><h1>Ứng dụng của bạn</h1><p>Quản lý ứng dụng và phân phối các phiên bản APK an toàn.</p></div>
            <div className="heading-mark" aria-hidden="true">↗</div>
          </div>
          {error && <div className="alert error" role="alert"><span aria-hidden="true">!</span>{error}<button aria-label="Đóng thông báo" onClick={() => setError(null)}>×</button></div>}
          {notice && <div className="alert success" role="status"><span aria-hidden="true">✓</span>{notice}<button aria-label="Đóng thông báo" onClick={() => setNotice(null)}>×</button></div>}
          {successUrl && <div className="published-banner"><div><span className="published-check">✓</span><div><strong>APK đã sẵn sàng để tải</strong><small>{successUrl}</small></div></div><div className="published-actions"><button className="button secondary" onClick={() => void copyUrl(successUrl)}>Sao chép link</button><a className="button primary" href={successUrl} target="_blank" rel="noreferrer">Mở link APK</a></div></div>}

          {!selectedApp ? <section className="welcome-panel"><span className="welcome-art" aria-hidden="true">APK</span><span className="section-label">BẮT ĐẦU</span><h2>Chọn ứng dụng để quản lý</h2><p>Thêm ứng dụng của bạn vào workspace, sau đó phát hành APK và chia sẻ link tải.</p>{apps.length === 0 && <button className="button primary" onClick={() => setShowAppForm(true)}>Tạo ứng dụng đầu tiên <span aria-hidden="true">→</span></button>}</section> : (
            <div className="release-workspace">
              <section className="app-summary-card">
                <span className="app-icon large">{selectedApp.name.slice(0, 1).toUpperCase()}</span>
                <div className="app-summary-copy"><span className="section-label">ANDROID APPLICATION</span><h2>{selectedApp.name}</h2><code>{selectedApp.packageName}</code></div>
                <div className="signing-status"><span className={`status-dot${selectedApp.signingCertSha256 ? ' verified' : ''}`} /><span>{selectedApp.signingCertSha256 ? 'Đã khóa chứng thư ký' : 'Chưa khóa chứng thư ký'}</span></div>
              </section>

              <section className="upload-card">
                <div className="card-heading"><div><span className="section-label">NEW RELEASE</span><h2>Phát hành phiên bản mới</h2></div><span className="upload-icon" aria-hidden="true">↑</span></div>
                <p className="card-description">Tải lên APK đầy đủ. Máy chủ sẽ tự kiểm tra package, version và chữ ký trước khi phát hành.</p>
                <form onSubmit={handleUpload}>
                  <label className={`file-drop${apkFile ? ' has-file' : ''}`} htmlFor="apk-file">
                    <span className="file-icon" aria-hidden="true">⇧</span><span className="file-copy"><strong>{apkFile ? apkFile.name : 'Chọn hoặc kéo thả file APK'}</strong><small>{apkFile ? displaySize(apkFile.size) : 'Định dạng .apk · Tối đa 512 MB'}</small></span><span className="button secondary browse-button">Chọn file</span>
                    <input id="apk-file" aria-label="File APK" type="file" accept=".apk,application/vnd.android.package-archive" onChange={(event) => setApkFile(event.target.files?.[0] ?? null)} />
                  </label>
                  <label className="field-label" htmlFor="release-notes">Ghi chú phát hành <span className="optional">Không bắt buộc</span></label>
                  <textarea id="release-notes" value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} maxLength={4000} rows={3} placeholder="Mô tả những thay đổi trong phiên bản này…" />
                  {isUploading && <div className="upload-progress"><div className="progress-copy"><span>Đang tải lên {progress ?? 0}%</span><span>{apkFile ? displaySize(apkFile.size) : ''}</span></div><div className="progress-track"><span style={{ width: `${progress ?? 0}%` }} /></div></div>}
                  <div className="upload-footer"><span className="security-note"><span aria-hidden="true">⌑</span> Chữ ký APK sẽ được xác minh tự động</span><button className="button primary publish-button" type="submit" disabled={!apkFile || isUploading}>{isUploading ? 'Đang tải APK…' : 'Phát hành APK'} <span aria-hidden="true">→</span></button></div>
                </form>
              </section>

              <section className="release-card">
                <div className="card-heading release-list-heading"><div><span className="section-label">VERSION HISTORY</span><h2>Lịch sử phiên bản</h2></div><span className="count-pill">{releases.length}</span></div>
                {isReleasesLoading ? <div className="loading-row">Đang tải lịch sử phiên bản…</div> : releases.length === 0 ? <div className="release-empty"><span className="empty-icon">◷</span><strong>Chưa có bản phát hành</strong><span>Phiên bản đầu tiên sẽ xuất hiện ở đây sau khi APK được xác minh.</span></div> : <div className="release-table-wrap"><table><thead><tr><th>PHIÊN BẢN</th><th>DUNG LƯỢNG</th><th>SDK / ABI</th><th>TRẠNG THÁI</th><th /></tr></thead><tbody>{releases.map((item) => <tr key={item.id} data-testid={`release-${item.id}`}><td><strong>Version {item.versionCode} · {item.versionName}</strong><small>{item.releaseNotes || 'Không có ghi chú phát hành'}</small></td><td>{displaySize(item.sizeBytes)}</td><td>SDK {item.minSdk}<small>{item.supportedAbis.length ? item.supportedAbis.join(', ') : 'Mọi ABI'}</small></td><td><span className={`release-status ${item.status}`}>{item.status === 'published' ? 'Đang phát hành' : 'Đã thu hồi'}</span></td><td>{item.status === 'published' && <button className="button danger-button" onClick={() => void handleWithdraw(item)} disabled={withdrawingId !== null}>{withdrawingId === item.id ? 'Đang thu hồi…' : 'Thu hồi'}</button>}</td></tr>)}</tbody></table></div>}
              </section>
            </div>
          )}
          <footer className="page-footer"><span>APK Update Platform</span><span>Phát hành an toàn cho Android</span></footer>
        </section>
      </div>
    </main>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

function statusOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status : null;
}
