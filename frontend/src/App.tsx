import './app.css';

export default function App() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <span className="brand-mark" aria-hidden="true">A</span>
        <span>APK Update</span>
      </header>
      <section className="welcome-card">
        <p className="eyebrow">ADMIN CONSOLE</p>
        <h1>Quản lý cập nhật APK</h1>
        <p className="welcome-copy">Đăng nhập để quản lý ứng dụng và các bản phát hành.</p>
        <p className="backend-status">Backend API sẽ kết nối khi cấu hình máy chủ.</p>
      </section>
    </main>
  );
}
