# APK Update Platform — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Không triển khai chỉ vì tài liệu này đã được tạo; đây là bản kế hoạch để review.

**Goal:** Quản lý APK cho nhiều app qua frontend, phân phối bản cập nhật đúng app và kiểm chứng cài đè bằng TubeLite.

**Architecture:** Frontend React/Vite gọi API Express/TypeScript; PostgreSQL lưu app, release và xác thực. APK lưu trên volume của backend; migration chạy trước API trong Docker Compose. Android kiểm tra phiên bản, tải APK rồi mở PackageInstaller.

**Tech Stack:** Node.js, Express, TypeScript, pg, node-pg-migrate, PostgreSQL, React, Vite, Docker Compose, Vitest, Supertest, React Testing Library, Playwright.

**Spec:** [spec.md](./spec.md)

Trạng thái: Đang triển khai. Đường dẫn trong các task là tương đối với `/Users/macbook/Documents/apk-update-platform/`, trừ phần tích hợp TubeLite.

## Global Constraints

- Tạo backend/frontend và repository riêng bên ngoài `youtube_app_no_qc`.
- PostgreSQL và migration nằm trong Docker Compose của backend; không dùng DB có sẵn trên máy làm mặc định.
- Giữ đúng API và quy tắc phiên bản/chữ ký của spec; không lưu khóa quản trị trong app Android.
- Bản đầu một quản trị viên, nhiều app, APK đầy đủ, một luồng phát hành mỗi app, storage trên VPS.
- Test meaningful trước khi chốt từng phần; build rồi commit riêng. Không commit secrets/APK/DB volumes.
- Khóa dependency bằng lockfile và image/tool version khi triển khai; production HTTPS, cấu hình qua env.

## Review Focus

- Upload đồng thời lần đầu: thiết lập một chứng thư ký nhất quán, không ghi đè versionCode — Task 4.
- File đã lưu nhưng transaction DB lỗi: không công bố release hỏng, dọn orphan an toàn — Task 4.
- Restart container/migration lỗi: giữ dữ liệu, API không chạy với schema thiếu — Task 2.
- Nhầm app hoặc metadata/chữ ký giả: server và client từ chối artifact không đúng — Tasks 4, 5, 7.
- Android hủy cài/process chết: không báo thành công sớm, phục hồi tải, không mất dữ liệu — Task 7.

## Task 1 — Khởi tạo dự án độc lập

**Files:** README.md, .gitignore, backend/package.json, backend/tsconfig.json, backend/src/app.ts, backend/src/server.ts, backend/.env.example, backend/Dockerfile, frontend/package.json, frontend/src/, frontend/.env.example.

**Interfaces:** Backend exports `createApp()` cho Supertest; entrypoint server chỉ đọc env/khởi động. Frontend dùng `VITE_API_BASE_URL`; production gọi API cùng origin.

- [x] Tạo repository mới và thư mục backend/frontend; giữ nguyên các tài liệu đã xuất.
- [x] Cấu hình TypeScript và scripts backend/frontend `dev`, `build`, `test`, `typecheck`; backend thêm `start`.
- [x] Tạo Express app với error middleware và frontend shell; validate cấu hình đầu vào, không log secrets.
- [x] Chạy `npm ci`, `npm run typecheck`, `npm run build` tại từng thư mục; build exit 0 và server báo lỗi rõ khi thiếu cấu hình bắt buộc.
- [x] Commit: `chore: initialize standalone APK update platform` (`41fd4d9`); cache build được dọn ở `93efbbf`.

## Task 2 — PostgreSQL, migration và Docker Compose

**Files:** backend/docker-compose.yml, backend/migrations/, backend/src/db/, backend/src/config.ts, backend/tests/integration/migrations.test.ts.

**Interfaces:** `DATABASE_URL`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `APK_STORAGE_DIR`, `MAX_APK_BYTES` (mặc định 536870912), `ADMIN_ORIGIN`; scripts `db:migrate`, `db:rollback`, `test:integration`. Compose có postgres/migrate/api và volumes độc lập.

- [x] Viết integration tests khởi tạo schema từ DB trống, chạy lại không thay dữ liệu, unique/FK, rollback/reapply; xác nhận thất bại khi chưa có migration.
- [x] Viết migration cho admin_users, admin_sessions, apps, releases, admin_api_tokens cùng constraint/index trong spec.
- [x] Cấu hình migrate đợi PostgreSQL healthy, API đợi migrate exit 0; readiness truy vấn DB và schema version.
- [x] Tạo môi trường test với DB/volume riêng; test không reset hoặc xóa DB ứng dụng.
- [x] Chạy `docker compose -f backend/docker-compose.yml up --build -d`; readiness trả thành công. Chạy `npm run test:integration` tại backend; tất cả migration tests đạt.
- [x] Restart containers, xác nhận bản ghi còn tồn tại; mô phỏng migration lỗi và xác nhận API không khởi động mới với schema thiếu.
- [x] Commit: `feat: provision postgres and database migrations` (this task's commit).

## Task 3 — Xác thực và quản lý ứng dụng

**Files:** backend/src/auth/, backend/src/apps/, backend/src/cli/, backend/tests/integration/auth.test.ts, backend/tests/integration/apps.test.ts.

**Interfaces:** Các auth/apps endpoints trong spec; CLI `admin:create`, `token:create`, `token:revoke`. Session dùng cookie HttpOnly; production Secure; request thay đổi dữ liệu bằng cookie cần CSRF; token được băm và chỉ xuất raw lúc tạo.

- [x] Viết test chưa đăng nhập, sai mật khẩu, phiên hết hạn, logout, CSRF, token thu hồi và package trùng; chạy xác nhận thất bại trước triển khai.
- [x] Implement password hashing, session PostgreSQL, giới hạn thử login và token authentication cho upload; không hardcode admin mặc định.
- [x] Implement tạo/liệt kê app và validation package; unique constraint xử lý request đồng thời.
- [x] Chạy focused integration tests, `npm run typecheck`, `npm run build`; xác nhận không có credentials trong response/log thông thường.
- [x] Commit: `feat: add admin authentication and app registry` (`c1ce8f7`).

## Task 4 — Upload, kiểm tra và phát hành APK

**Files:** backend/src/releases/, backend/src/apk/, backend/src/storage/, backend/tests/integration/releases.test.ts, backend/tests/fixtures/.

**Interfaces:** `inspectApk(path)` trả metadata/signing fingerprint; `publishRelease(appId, file, releaseNotes)` trả release và downloadUrl. Multipart fields `apk` và `releaseNotes`; route upload như spec.

- [x] Tạo APK fixtures bằng script `backend/tests/fixtures/generate.sh`; artifact sinh ra được ignored, không commit APK hoặc khóa production.
- [x] Viết test file giả, split APK, sai package/chữ ký, oversize, version trùng, lỗi DB và concurrent first upload; xác nhận parser test đỏ trước implementation.
- [x] Tích hợp Android SDK tools trong image backend để đọc manifest và `apksigner verify --print-certs`; subprocess dùng argument array và timeout.
- [x] Stream upload vào vùng tạm, tính SHA-256/kích thước, kiểm tra metadata và chữ ký; dùng storage key sinh bởi server.
- [x] Publish bằng transaction với unique constraint và khóa app lúc thiết lập signer; chỉ trả thành công khi file sẵn sàng và DB commit xong.
- [x] Dọn vùng tạm và file khi transaction rollback; lúc khởi động xóa upload tạm/orphan cũ hơn 24 giờ nhưng giữ file có DB reference. Integration test xác nhận không xóa upload mới hoặc release đã phát hành.
- [x] Chạy release integration tests, build backend image và upload APK TubeLite qua API; nhận URL/metadata đúng.
- [x] Commit: `feat: validate and publish APK releases` (`099792d`).

## Task 5 — API kiểm tra cập nhật và tải công khai

**Files:** backend/src/updates/, backend/src/downloads/, backend/tests/integration/updates.test.ts, backend/tests/integration/downloads.test.ts, docs/openapi.yaml.

**Interfaces:** Hợp đồng check/download/withdraw trong spec; latest = versionCode lớn nhất của published release tương thích SDK/ABI. Không yêu cầu app Android có token quản trị.

- [x] Viết tests version thấp/bằng/cao hơn, cách ly hai app, không có release, SDK/ABI không khớp và package không tồn tại.
- [x] Implement chọn release và response chính xác; so sánh versionCode, không dùng versionName hoặc uploadedAt.
- [x] Implement download theo release ID, MIME APK, Content-Length, HTTP Range/206/416; không public thư mục raw storage.
- [x] Implement withdraw và kiểm tra trạng thái trên update/download; test client có version cao không bị downgrade.
- [x] Chạy integration tests, backend build và kiểm tra cú pháp OpenAPI YAML; ghi request/response/error examples.
- [x] Commit: `feat: serve compatible APK updates and downloads` (`25f9d6e`).

## Task 6 — Frontend quản trị

**Files:** frontend/src/features/auth/, frontend/src/features/apps/, frontend/src/features/releases/, frontend/src/api/, frontend/tests/.

**Interfaces:** Dùng endpoints spec; cookie credentials và CSRF đúng origin. Upload dùng transport hỗ trợ progress. UI tiếng Việt.

- [x] Viết component tests cho empty/loading/error, disable submit lặp, progress upload và xác nhận thu hồi.
- [x] Implement đăng nhập, danh sách/tạo app, chi tiết release, upload có notes, sao chép URL và thu hồi.
- [x] Xử lý session hết hạn về màn đăng nhập; thông báo lỗi server không biến upload dở thành thành công.
- [x] Viết Playwright test với backend/test DB thật: login → tạo app → upload fixture → copy URL → tải file → withdraw.
- [x] Chạy `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run build` tại frontend; kiểm tra UI trên trình duyệt và ghi bằng chứng.
- [x] Commit: `feat: add APK release administration frontend` (`64b77b6`).

## Task 7 — Tích hợp cập nhật vào TubeLite

**Location:** Repository `/Users/macbook/Documents/youtube_app_no_qc`, thực hiện sau khi server API hoạt động. Phần này có commit riêng tại repository TubeLite.

**Interfaces:** Android update module cung cấp check/startDownload/cancelDownload/install và trạng thái idle/checking/downloading/verifying/readyToInstall/error. Package/version lấy từ Android; URL server cấu hình theo môi trường, không chứa admin token.

- [x] Đọc cấu trúc app trước khi thêm module; không gộp thay đổi sửa độ trễ playback đang để lại.
- [x] Viết tests response mapping, yêu cầu trùng và checksum/package/version/signature mismatch.
- [x] Implement nút Kiểm tra cập nhật, gọi API, DownloadManager và phục hồi download ID sau process restart; thông báo tiến độ và hủy.
- [x] Xác thực APK đã tải trước PackageInstaller; xử lý cấp quyền, pending user action, hủy và lỗi. Chỉ xác nhận thành công bằng version thực tế khi mở lại.
- [x] Build hai APK cùng signer với versionCode tăng, cài N rồi cập nhật N+1 từ server; kiểm tra lịch sử/yêu thích còn nguyên.
- [x] Kiểm thử luồng cập nhật trên emulator, hash sai bằng validator unit test, thao tác lặp và quyền cài. Thiết bị thật, thiếu dung lượng thấp và phục hồi qua mất mạng kéo dài chưa được kiểm chứng.
- [x] Build release APK trong source TubeLite, giữ artifact ignored; commit `359345e` (`feat: integrate APK update checks and installation`).

## Task 8 — Nghiệm thu, triển khai và bàn giao

**Files:** README.md, docs/verification.md, docs/openapi.yaml, cấu hình reverse proxy và env mẫu.

- [x] Chạy bộ test backend/frontend và build sau cùng; không báo đạt nếu có test chưa chạy hoặc bị skip mà không giải thích.
- [x] Kiểm tra cách ly app với hai package và hai release trong integration test; kiểm tra URL công khai và thu hồi qua integration/E2E.
- [x] Kiểm chứng restart bền vững, backup cả DB/APK rồi restore vào môi trường độc lập; checksum/file reference còn đúng.
- [x] Viết README cho migrate, tạo admin/token, chạy frontend/backend, cấu hình HTTPS/domain, backup/restore và tích hợp app mới.
- [x] Ghi docs/verification.md: commit, môi trường, lệnh, kết quả, bằng chứng UI/cài đè và phần chưa kiểm chứng.
- [x] Kiểm tra Git không chứa secret/APK/database; commit: `docs: document deployment and verification`.

## Tiêu chí kết thúc

Tất cả mục nghiệm thu ở spec đạt và có bằng chứng: Compose tự tạo schema/API, frontend quản trị hoạt động, hai app cách ly, upload lỗi không tạo release hỏng, cài đè TubeLite giữ dữ liệu, restart/restore giữ file và DB, test/build đạt, tài liệu đầy đủ. Domain/VPS thật cần cấu hình khi deploy; không tự triển khai public trong giai đoạn viết tài liệu.
