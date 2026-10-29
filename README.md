# iubabi — Những lá thư

Trang web tĩnh (GitHub Pages) để hai người viết thư cho nhau. Thư lưu trong Google Sheets
thông qua Google Apps Script. **Mọi yêu cầu đọc/gửi thư đều phải có mã bí mật** — không có mã
thì API không trả về gì, kể cả khi ai đó biết URL trang hoặc URL Apps Script.

```
Trình duyệt ──(mã bí mật)──▶ Apps Script (Web App) ──▶ Google Sheet "Letters"
     ▲
GitHub Pages (index.html, assets/, config.js)
```

## Cài đặt backend (Google Sheets + Apps Script)

1. Tạo một Google Sheet mới. **Giữ chế độ chia sẻ "Bị hạn chế"** (chỉ mình bạn).
2. Trong sheet: **Tiện ích mở rộng → Apps Script**.
3. Dán toàn bộ nội dung [`apps-script/Code.gs`](apps-script/Code.gs), bấm **Lưu**.
4. Chọn hàm `setup` → **Chạy** → cấp quyền. Mở **Nhật ký thực thi** để xem hai mã:
   - `OWNER_KEY` — mã của anh
   - `PARTNER_KEY` — mã của em
5. **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**:
   Thực thi với tư cách **Tôi**, Ai có quyền truy cập **Bất kỳ ai** → sao chép URL `/exec`.
6. Dán URL vào `API_URL` trong [`config.js`](config.js), commit và push.

> "Bất kỳ ai" chỉ có nghĩa là ai cũng *gọi* được URL; Apps Script vẫn từ chối mọi yêu cầu không có mã đúng.

### Cập nhật code Apps Script

Sau khi sửa `Code.gs`: **Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai**.
URL `/exec` giữ nguyên. Nên chạy lại `setup` để cập nhật tiêu đề cột và danh sách chọn trong sheet.

### Đổi mã bí mật

Chạy hàm `resetKeys` trong Apps Script: tạo mã mới cho cả hai, mã cũ hết hiệu lực ngay.
Các máy đang ghi nhớ mã cũ sẽ tự quay về màn hình khóa.

## Sử dụng

- Mở trang, nhập mã bí mật (tick *Ghi nhớ trên máy này* để lần sau không phải nhập).
- Mã của anh gửi thư → tab *Thư của anh*; mã của em → tab *Thư của em*.
- Mở đầu thư bằng dòng `Thành phố Hồ Chí Minh, ngày 21 tháng 6 năm 2025` → được canh phải như thư tay.
- Nút 🔒 góc trên bên phải để khóa lại (xóa mã khỏi máy đang dùng).

### Cột trong sheet

| Cột        | Ý nghĩa |
|------------|---------|
| `type`     | `owner` = thư của anh, `partner` = thư của em (để trống = của anh) |
| `status`   | `show` = hiện, `hide` = ẩn (để trống = hiện) |
| `deviceId` | Mã ngẫu nhiên của trình duyệt đã gửi thư |
| `device`   | Loại thiết bị, ví dụ `iPhone · Safari` |

Có thể gõ thư thẳng vào sheet: điền `createdAt`, `author`, `title`, `content`.

## Bảo mật

- Mã bí mật chỉ nằm trong Script properties của Apps Script, không có trong repo.
- Trang có `noindex` để công cụ tìm kiếm không lập chỉ mục.
- Nội dung thư hiển thị bằng `textContent` (không chèn HTML) và được chặn chèn công thức khi ghi vào sheet.
- Repo public chỉ lộ mã nguồn, không lộ thư. Muốn ẩn cả mã nguồn: chuyển repo sang private
  (GitHub Pages cho repo private cần gói GitHub Pro).

## Cấu trúc

```
index.html          Giao diện (màn hình khóa + danh sách thư)
assets/style.css    Kiểu dáng (tự đổi sáng/tối theo hệ thống)
assets/app.js       Logic: mở khóa, tải thư, lọc, tìm kiếm, đọc, gửi thư
config.js           URL Apps Script, tên trang, chữ ký mặc định
apps-script/Code.gs Backend: kiểm tra mã, đọc/ghi Google Sheets
```
