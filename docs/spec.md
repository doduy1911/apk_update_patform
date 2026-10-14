# Đặc tả nền tảng phân phối và cập nhật APK

Ngày: 2026-10-15

Trạng thái: Đã triển khai bản đầu theo kế hoạch; xem [verification record](./verification.md) để biết phạm vi đã kiểm chứng và giới hạn còn lại.

## 1. Mục tiêu

Xây dựng server dùng chung cho nhiều ứng dụng Android: quản trị viên upload APK, nhận URL công khai; ứng dụng kiểm tra phiên bản, tải bản mới và mở trình cài đặt Android. Mỗi ứng dụng chỉ nhận bản cập nhật của chính nó.

Trên Android thông thường, luồng phải hỗ trợ cấp quyền cài từ ứng dụng và xác nhận của người dùng. Không cam kết cập nhật âm thầm trên mọi thiết bị.

## 2. Vị trí và công nghệ

Dự án độc lập tại `/Users/macbook/Documents/apk-update-platform/`, nằm cạnh và bên ngoài `youtube_app_no_qc`.

```text
apk-update-platform/
├── backend/
│   ├── src/
│   ├── migrations/
│   ├── tests/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── tests/
│   └── .env.example
├── docs/
│   ├── spec.md
│   ├── plan.md
│   ├── openapi.yaml
│   └── verification.md
├── .gitignore
└── README.md
```

Cây trên là cấu trúc cần tạo khi triển khai; giai đoạn xuất tài liệu chỉ tạo spec và plan.

- Backend: Node.js, Express, TypeScript và `pg`.
- Database: PostgreSQL trong Docker Compose của backend; migration dùng `node-pg-migrate`.
- Frontend quản trị: React, TypeScript, Vite; gọi API backend.
- Repository Git riêng. Không đặt backend hoặc frontend trong source TubeLite.
- Bản đầu dùng một VPS, lưu APK trên Docker volume bền vững; database chỉ lưu metadata.
- Một quản trị viên, nhiều app, một luồng phát hành chính cho mỗi app. Chỉ hỗ trợ APK đầy đủ; chưa hỗ trợ AAB, split APK, beta channel, cập nhật bắt buộc hoặc nhiều vai trò quản trị.

## 3. Chức năng quản trị

Frontend có màn hình đăng nhập, danh sách/tạo app, chi tiết app và lịch sử phiên bản, upload APK với ghi chú và tiến độ, kết quả upload với nút sao chép URL, thu hồi bản phát hành có xác nhận.

Mỗi màn hình thể hiện trạng thái tải, trống, thành công và lỗi. Upload lỗi cho phép thử lại, không hiển thị bản chưa hoàn tất như bản đã phát hành. Không gửi trùng khi bấm nhiều lần.

Mỗi app có `packageName` duy nhất. Khi upload, server tự đọc package, `versionCode`, `versionName`, `minSdk`, ABI và chứng thư ký từ APK; tính kích thước và SHA-256 từ file thực tế.

- Chữ ký APK phải hợp lệ, package phải khớp app đã chọn. Không tin metadata do frontend tự khai báo.
- Lần upload hợp lệ đầu tiên thiết lập chứng thư ký của app; các bản sau phải khớp. Luồng v1 không xử lý đổi khóa ký.
- Cặp app/`versionCode` là duy nhất. Không ghi đè APK đã phát hành.
- Giới hạn upload mặc định 512 MiB, cấu hình được.
- Upload ghi vào vùng tạm, kiểm tra trước khi chuyển vào vùng lưu cố định và phát hành.
- Upload thành công phát hành ngay và trả URL công khai ổn định cho bản đó.
- Thu hồi loại bản khỏi kết quả kiểm tra và chặn lượt tải mới qua URL. Bản APK đã tải xuống thiết bị không thể bị thu hồi từ xa.
- Chọn bản mới nhất bằng `versionCode`, không dùng thời gian upload hay `versionName`.

## 4. API

| API | Chức năng |
|---|---|
| POST /api/v1/admin/auth/login | Đăng nhập |
| POST /api/v1/admin/auth/logout | Đăng xuất |
| GET /api/v1/admin/auth/me | Phiên quản trị hiện tại |
| POST /api/v1/admin/apps | Tạo app |
| GET /api/v1/admin/apps | Danh sách app |
| POST /api/v1/admin/apps/:appId/releases | Multipart APK và releaseNotes; upload/phát hành |
| GET /api/v1/admin/apps/:appId/releases | Lịch sử phiên bản |
| POST /api/v1/admin/releases/:releaseId/withdraw | Thu hồi phiên bản |
| POST /api/v1/updates/check | Kiểm tra cập nhật công khai |
| GET /downloads/:releaseId/app.apk | Tải APK công khai; hỗ trợ HTTP Range |
| GET /health/ready | Kiểm tra API, database và schema sẵn sàng |

API quản trị sử dụng phiên đăng nhập, cookie HttpOnly, bảo vệ CSRF và giới hạn thử đăng nhập. Upload tự động từ công cụ build hỗ trợ token quản trị riêng, được băm khi lưu; không đưa token vào ứng dụng Android. Có lệnh quản trị để tạo và thu hồi token.

Request kiểm tra cập nhật:

```json
{
  "packageName": "com.tubelite",
  "currentVersionCode": 2,
  "sdkInt": 35,
  "supportedAbis": ["arm64-v8a"]
}
```

Response có bản mới:

```json
{
  "updateAvailable": true,
  "release": {
    "id": "release-uuid",
    "packageName": "com.tubelite",
    "versionCode": 3,
    "versionName": "2.1.0",
    "releaseNotes": "Sửa lỗi và cải thiện trải nghiệm",
    "downloadUrl": "https://updates.example.com/downloads/release-uuid/app.apk",
    "sizeBytes": 85000000,
    "sha256": "<SHA-256 của APK>",
    "signingCertSha256": "<SHA-256 của chứng thư ký>"
  }
}
```

Các giá trị URL/hash trên chỉ minh họa hợp đồng, không phải artifact đã tồn tại.

Server chọn bản đã phát hành có versionCode cao nhất tương thích SDK/ABI; APK không có native library được coi là không giới hạn ABI. Chỉ đề nghị nếu versionCode lớn hơn bản đang cài. Không có bản mới trả `updateAvailable: false`, `release: null`, `reason: UP_TO_DATE`; không có bản tương thích trả `NO_COMPATIBLE_RELEASE`. Package không tồn tại trả HTTP 404 với `APP_NOT_FOUND`. Request không hợp lệ trả HTTP 400.

Thu hồi không yêu cầu thiết bị hạ phiên bản; bản lỗi đã cài cần được sửa bằng một versionCode cao hơn. Mỗi URL trỏ đến đúng một artifact bất biến.

## 5. Tích hợp Android

TubeLite là app đầu tiên tích hợp. App đọc package và phiên bản thực tế từ Android, gửi thông tin thiết bị khi bấm **Kiểm tra cập nhật**.

Nếu có bản mới, tự tải bằng DownloadManager, hiện phiên bản đích, dung lượng, tiến độ và nút hủy. Lưu mã lượt tải để phục hồi trạng thái khi app mở lại; không tạo lượt tải trùng.

Sau tải, kiểm tra kích thước, SHA-256, package, phiên bản và chữ ký tương thích với app đang cài. Nếu sai, không cài và báo lỗi. Dùng PackageInstaller, xử lý cấp quyền cài từ ứng dụng này và bước xác nhận của Android. Người dùng hủy cài hoặc mạng/server lỗi vẫn sử dụng bản hiện tại bình thường.

Sau cài và mở lại app, đọc phiên bản thực tế để xác nhận cập nhật; không đánh dấu thành công chỉ vì đã mở trình cài đặt. Cài đè phải giữ dữ liệu người dùng.

TubeLite hiện có versionCode 2, versionName 2.0 và release dùng signing config debug. Khi kiểm thử cài đè phải dùng chữ ký tương thích; không tự thay khóa ký hoặc gỡ app để vượt lỗi chữ ký.

## 6. Database và Docker Compose

`backend/docker-compose.yml` quản lý:

- `postgres`: PostgreSQL, health check và volume dữ liệu riêng.
- `migrate`: chạy migration một lần sau khi PostgreSQL khỏe; thoát thành công khi schema sẵn sàng.
- `api`: khởi động sau khi migration thành công; có volume APK riêng.

PostgreSQL không mở cổng công khai trong production. Tạo lại container không làm mất dữ liệu. Frontend/API dùng chung origin qua reverse proxy HTTPS khi deploy; phát triển chỉ cho phép origin frontend được cấu hình.

| Bảng | Nội dung và ràng buộc |
|---|---|
| admin_users | Username duy nhất, mật khẩu băm |
| admin_sessions | Phiên đăng nhập, thời hạn, liên kết admin |
| apps | Tên, package duy nhất, dấu vân tay chứng thư ký |
| releases | App, phiên bản, notes, SDK/ABI, file, hash, kích thước, trạng thái, thời điểm |
| admin_api_tokens | Token băm, admin sở hữu, trạng thái thu hồi |

Migration tạo đầy đủ bảng, khóa ngoại, unique `(app_id, version_code)` và index tìm bản đã phát hành mới nhất. Có bảng theo dõi migration do công cụ quản lý.

- Cung cấp scripts `db:migrate`, `db:rollback`, `admin:create`, `token:create`, `token:revoke`.
- Migration chạy được từ database trống; chạy lại không tạo trùng hoặc mất dữ liệu.
- Migration lỗi phải ngăn API khởi động; không tự bỏ qua lỗi schema.
- Tạo admin bằng lệnh riêng, không có mật khẩu mặc định trong source/migration.
- Kiểm tra rollback/reapply trên DB thử nghiệm. Rollback production là thao tác chủ động sau backup.
- Không tự reset database hoặc xóa volume lúc khởi động.

## 7. Lưu trữ và vận hành

Dùng Android SDK tools để đọc APK và xác minh chữ ký; chạy subprocess với arguments riêng, timeout, không ghép tên file vào shell command. Storage key dùng ID của server, không lấy đường dẫn từ tên upload.

File chỉ được công bố sau khi kiểm tra và lưu thành công. Transaction database và unique constraint giải quyết upload trùng đồng thời; khóa app khi thiết lập chứng thư ký đầu tiên. Nếu DB lỗi sau khi lưu file, dọn file chưa được tham chiếu; dọn file tạm bỏ dở định kỳ, không xóa upload còn hoạt động.

Download hỗ trợ Range và kiểm tra trạng thái bản phát hành trước khi phục vụ. Không public trực tiếp toàn bộ thư mục storage. Backup bao gồm cả PostgreSQL và volume APK; có hướng dẫn phục hồi và kiểm tra file được database tham chiếu.

Log có request ID và lỗi phục vụ debug, không chứa mật khẩu/token. Giới hạn upload và request được cấu hình đồng nhất ở proxy/backend. Mật khẩu, token, APK và dữ liệu PostgreSQL không vào Git.

## 8. Test và mục tiêu hoàn thành

Backend dùng Vitest, Supertest và PostgreSQL thật trong Docker cho integration tests. Frontend dùng Vitest/React Testing Library và Playwright. Android dùng unit/instrumentation tests cùng chạy APK trên emulator. Test database/volume độc lập với dữ liệu sử dụng thật.

Các nhóm nghiệm thu bắt buộc:

1. Migration: DB trống, chạy lại, unique/FK/index, rollback/reapply, migration lỗi chặn API, restart giữ dữ liệu.
2. Auth: sai mật khẩu, chưa đăng nhập, phiên hết hạn, CSRF, token thu hồi, package trùng.
3. Upload: hợp lệ, giả APK, sai package/chữ ký, quá dung lượng, ngắt upload, trùng đồng thời, lỗi DB/ổ đĩa; không tạo link hỏng hoặc bản phát hành giả.
4. Update/download: thấp/bằng/cao hơn, cách ly hai app, không tương thích SDK/ABI, Range, file mất, bản thu hồi.
5. Frontend: đăng nhập → tạo app → upload → copy URL → thu hồi; hiển thị lỗi, tiến độ và tránh gửi trùng.
6. Android: mất mạng, thiếu dung lượng, hash sai, bấm lặp, hủy, cấp quyền, phục hồi lượt tải; cập nhật N lên N+1 giữ lịch sử/yêu thích.
7. Vận hành: build backend/frontend, restart bền vững, backup/restore DB và file; ghi kết quả thực tế trong `docs/verification.md`.

Hoàn thành khi backend/frontend nằm trong dự án mới; Docker Compose khởi tạo DB/schema/API; frontend quản trị hoạt động; ít nhất hai app nhận đúng bản cập nhật; TubeLite cài đè thành công; các test/build liên quan đạt; bàn giao OpenAPI, env mẫu, hướng dẫn chạy/deploy/backup và báo cáo kiểm thử. Mỗi phần được test/build rồi commit riêng. Không tự phát hành public trước yêu cầu triển khai.

## 9. Tham chiếu

- Android versioning: https://developer.android.com/studio/publish/versioning
- Android app signing: https://developer.android.com/studio/publish/app-signing
- Xác nhận cài đặt: https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)

Domain/VPS thực tế sẽ được cấu hình lúc triển khai. S3/R2 nằm ngoài bản đầu. Việc sửa độ trễ mở video TubeLite vẫn là công việc riêng đang để lại.
