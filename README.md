# iubabi — Những lá thư

Trang web tĩnh (chạy trên GitHub Pages) để đọc và gửi thư. Thư của chủ trang và của người dùng
được lưu trong Google Sheets thông qua Google Apps Script.

```
Trình duyệt ──GET/POST──▶ Apps Script (Web App) ──▶ Google Sheet "Letters"
     ▲
GitHub Pages (index.html, assets/, config.js)
```

## Cài đặt backend (Google Sheets + Apps Script)

1. Tạo một Google Sheet mới (ví dụ đặt tên `iubabi-letters`).
2. Trong sheet: **Tiện ích mở rộng → Apps Script**.
3. Xóa code mặc định, dán toàn bộ nội dung file [`apps-script/Code.gs`](apps-script/Code.gs), bấm **Lưu**.
4. Chọn hàm `setup` ở thanh công cụ → **Chạy** → cấp quyền cho tài khoản Google.
   Mở **Nhật ký thực thi** để xem `OWNER_KEY` (mã chủ trang) — lưu lại mã này.
   Sheet `Letters` sẽ được tạo tự động.
5. **Triển khai → Tùy chọn triển khai mới** → loại **Ứng dụng web**:
   - Thực thi với tư cách: **Tôi**
   - Ai có quyền truy cập: **Bất kỳ ai**
6. Bấm **Triển khai**, sao chép URL dạng `https://script.google.com/macros/s/.../exec`.

## Nối frontend với backend

Mở [`config.js`](config.js), dán URL vào `API_URL`, rồi commit và push:

```js
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXX/exec',
  ...
};
```

Khi `API_URL` còn trống, trang chạy ở **chế độ thử**: thư chỉ lưu tạm trong trình duyệt.

## Sử dụng

- **Người dùng** bấm *Viết thư* để gửi thư; thư hiện trong tab *Thư mọi người*.
- **Chủ trang** gửi thư bằng cách mở mục *Tôi là chủ trang* trong form và nhập `OWNER_KEY`;
  thư hiện trong tab *Thư của tôi*. Cũng có thể gõ thư trực tiếp vào sheet
  (để trống cột `type` thì được tính là thư của chủ trang).
- Mỗi lá thư có liên kết riêng dạng `.../#thu/<id>` để chia sẻ.

### Quản lý thư trong sheet

| Cột      | Ý nghĩa |
|----------|---------|
| `type`   | `owner` = thư của chủ trang, `guest` = thư người dùng |
| `status` | `show` = hiện, `hide` = ẩn, `pending` = chờ duyệt |
| `deviceId` | Mã ngẫu nhiên do trình duyệt của người viết tự tạo — cùng mã = cùng một người |
| `device` | Loại thiết bị, ví dụ `iPhone · Safari`, `Android · Zalo` |

Muốn xem mọi thư của một người: bật **Dữ liệu → Tạo bộ lọc** trong sheet rồi lọc cột `deviceId`.
Trên web, mã thiết bị không bị lộ: trang chỉ nhận một mã rút gọn (băm SHA-256) để nhóm thư theo người viết.
Lưu ý: xóa dữ liệu trình duyệt, dùng tab ẩn danh, hoặc mở bằng trình duyệt khác (kể cả trình duyệt trong Zalo/Facebook)
thì được coi là thiết bị mới.

Muốn duyệt thư trước khi hiện: trong Apps Script vào **Cài đặt dự án → Thuộc tính tập lệnh**,
thêm `REQUIRE_APPROVAL` = `true`. Thư mới của người dùng sẽ ở trạng thái `pending`,
đổi thành `show` để hiện lên trang.

### Cập nhật code Apps Script

Sau khi sửa `Code.gs`: **Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai**.
URL `/exec` giữ nguyên nên không cần sửa `config.js`.

## Đăng lên GitHub Pages

Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)`.
Trang sẽ có địa chỉ `https://<tên-tài-khoản>.github.io/<tên-repo>/`.

## Cấu trúc

```
index.html          Giao diện
assets/style.css    Kiểu dáng (tự đổi sáng/tối theo hệ thống)
assets/app.js       Logic: tải thư, lọc, tìm kiếm, đọc, gửi thư
config.js           URL Apps Script và tên trang
apps-script/Code.gs Backend ghi/đọc Google Sheets
```

## Lưu ý bảo mật

- `OWNER_KEY` chỉ nằm trong Script properties, không có trong repo.
- Nội dung thư được hiển thị bằng `textContent` (không chèn HTML) để tránh XSS,
  và được chặn chèn công thức khi ghi vào sheet.
- Form có bẫy chống bot đơn giản; nếu bị spam nhiều, hãy bật `REQUIRE_APPROVAL`.
