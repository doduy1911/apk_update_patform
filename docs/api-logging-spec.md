# Đặc tả log hoạt động API

Ngày: 2026-10-20

Trạng thái: Đã triển khai; xem kế hoạch triển khai để biết phạm vi và kết quả xác minh.

## 1. Mục tiêu

Khi backend chạy trong môi trường phát triển, developer có thể nhìn terminal để biết request nào đang đi qua API, request thành công hay lỗi, và mất bao lâu. Log cần gọn, có cấu trúc để dễ tìm kiếm và không làm lộ thông tin xác thực.

Phạm vi hiện tại là backend Node.js/Express chạy trực tiếp bằng `npm run dev`. Không yêu cầu Docker, hệ thống thu thập log bên ngoài, dashboard, lưu log vào database hay ghi log nội dung request/response.

## 2. Sự kiện cần ghi

### API khởi động

Sau khi backend kết nối database và hoàn tất dọn file cũ, ghi một sự kiện `api_started` ra stdout với:

- `event`: `api_started`
- `port`: cổng HTTP đang lắng nghe
- `environment`: giá trị `NODE_ENV`

Không ghi `DATABASE_URL`, mật khẩu, session secret, token hoặc đường dẫn chứa thông tin nhạy cảm.

### Request hoàn tất

Ghi đúng một sự kiện `http_request` khi response kết thúc hoặc kết nối bị đóng, gồm:

- `event`: `http_request`
- `requestId`: UUID do API tạo cho request
- `method`: HTTP method
- `path`: pathname không gồm query string
- `statusCode`: HTTP status đã gửi; nếu client ngắt trước khi gửi headers thì ghi `null`
- `durationMs`: thời gian từ lúc nhận request đến lúc response kết thúc/đóng, số mili giây không âm

Trả `X-Request-ID` trong response để developer đối chiếu response với log. API luôn tự tạo UUID, không tin giá trị request ID do client gửi vào.

Log ở dạng một JSON object trên mỗi dòng stdout. Dùng chung một định dạng cho development và các môi trường khác để tránh nhánh hành vi; không thêm dependency logging trong phạm vi này.

## 3. Vị trí và phạm vi middleware

Request logger được cài trong `createApp` ngay sau khi tạo Express app, trước Helmet, CORS, health routes, API routes và fallback 404 để ghi cả:

- `/health/live` và `/health/ready`
- các endpoint quản trị, kiểm tra cập nhật và tải APK
- request không tìm thấy route (404)
- request kết thúc bằng lỗi server

Sự kiện được phát khi response kết thúc/đóng để status code đã được xác định. Chỉ ghi một lần cho mỗi request, kể cả khi client ngắt kết nối.

## 4. Bảo vệ dữ liệu

- Không ghi request body, response body, header, cookie, `Authorization`, mật khẩu, CSRF token hoặc API token.
- Không ghi query string; URL trong log chỉ gồm pathname.
- Không log stack trace hoặc thông tin kết nối database trong access log.
- Lỗi server tiếp tục được log bởi error handler hiện có; bổ sung `requestId` để liên kết lỗi với access log. Giữ nguyên response lỗi hiện tại.

## 5. Tiêu chí chấp nhận

1. Khởi động thành công in một JSON `api_started` với port và environment, không có secrets.
2. Mỗi request hoàn tất tạo đúng một JSON `http_request` có request ID, method, pathname, status và duration.
3. Response trả cùng ID trong header `X-Request-ID`.
4. Query string và dữ liệu nhạy cảm không xuất hiện trong log.
5. Request 404, API error và health check đều được ghi.
6. Client ngắt kết nối không làm API crash và không tạo hai log cho cùng request.
7. Có thể xem log bằng terminal khi chạy `npm run dev`; không cần Docker hay dịch vụ ngoài.

## 6. Ngoài phạm vi

- Log request/response body hoặc metadata APK.
- Theo dõi từng bước nội bộ như truy vấn SQL, parse APK hoặc stream từng chunk download.
- Metrics, tracing phân tán, dashboard, log rotation, lưu trữ lâu dài hoặc cấu hình gửi log ra ngoài.
- Thay đổi API response hoặc OpenAPI contract, ngoài header `X-Request-ID`.
