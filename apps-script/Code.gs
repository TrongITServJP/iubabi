/**
 * Backend cho trang thư iubabi — chạy trong Google Apps Script gắn với một Google Sheet.
 *
 * Cột trong sheet "Letters":
 *   id | createdAt | author | title | content | type | status | deviceId | device
 *   - type:     owner (thư của chủ trang) | guest (thư người dùng)
 *   - status:   show (hiện) | hide (ẩn) | pending (chờ duyệt)
 *   - deviceId: mã ngẫu nhiên mà mỗi trình duyệt tự tạo, cùng mã = cùng người viết (chỉ lưu trong sheet)
 *   - device:   loại thiết bị, ví dụ "iPhone · Safari"
 *
 * Chủ trang có thể gõ thư trực tiếp vào sheet: chỉ cần điền createdAt, author, title, content;
 * để trống type thì được coi là thư của chủ trang, để trống status thì thư được hiện.
 *
 * Script properties (Project Settings → Script properties):
 *   OWNER_KEY         mã bí mật để đăng thư với tư cách chủ trang (hàm setup() tự tạo)
 *   REQUIRE_APPROVAL  "true" → thư người dùng ở trạng thái pending cho tới khi đổi thành show
 */

const SHEET_NAME = 'Letters';
const HEADERS = ['id', 'createdAt', 'author', 'title', 'content', 'type', 'status', 'deviceId', 'device'];
const LIMITS = { author: 50, title: 120, content: 5000, device: 60 };

/** Chạy một lần trong trình soạn Apps Script để tạo sheet và cấp quyền. */
function setup() {
  getSheet_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('OWNER_KEY')) {
    props.setProperty('OWNER_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }
  Logger.log('OWNER_KEY của anh/chị: ' + props.getProperty('OWNER_KEY'));
}

function doGet() {
  const rows = getSheet_().getDataRange().getValues().slice(1);
  const letters = rows
    .map((r, i) => ({ row: r, line: i + 2 }))
    .filter(({ row }) => String(row[4]).trim() && isVisible_(row[6]))
    .map(({ row, line }) => ({
      id: String(row[0] || 'row-' + line),
      createdAt: row[1] instanceof Date ? row[1].toISOString() : String(row[1] || ''),
      author: String(row[2] || ''),
      title: String(row[3] || ''),
      content: String(row[4]),
      type: String(row[5]).trim() === 'guest' ? 'guest' : 'owner',
      writer: writerId_(row[7]),
    }));
  return json_({ ok: true, letters: letters });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  // Bẫy bot: ô ẩn "website" mà có giá trị thì giả vờ thành công, không ghi gì.
  if (body.website) return json_({ ok: true, status: 'show' });

  const content = clean_(body.content, LIMITS.content);
  if (!content) return json_({ ok: false, error: 'Nội dung thư không được để trống.' });

  const props = PropertiesService.getScriptProperties();
  const ownerKey = props.getProperty('OWNER_KEY');
  const sentKey = String(body.ownerKey || '').trim();
  const isOwner = Boolean(ownerKey) && sentKey === ownerKey;
  if (sentKey && !isOwner) return json_({ ok: false, error: 'Mã chủ trang không đúng.' });

  const needApproval = props.getProperty('REQUIRE_APPROVAL') === 'true';
  const status = isOwner || !needApproval ? 'show' : 'pending';
  const id = Utilities.getUuid();
  const deviceId = /^[A-Za-z0-9-]{8,64}$/.test(String(body.deviceId)) ? String(body.deviceId) : '';

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet_().appendRow([
      id,
      new Date(),
      safeCell_(clean_(body.author, LIMITS.author) || 'Ẩn danh'),
      safeCell_(clean_(body.title, LIMITS.title)),
      safeCell_(content),
      isOwner ? 'owner' : 'guest',
      status,
      deviceId,
      safeCell_(clean_(body.device, LIMITS.device)),
    ]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, id: id, status: status });
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(5, 400);
    const rule = (values) => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
    sheet.getRange('F2:F').setDataValidation(rule(['owner', 'guest']));
    sheet.getRange('G2:G').setDataValidation(rule(['show', 'hide', 'pending']));
  } else if (sheet.getRange(1, HEADERS.length).getValue() !== HEADERS[HEADERS.length - 1]) {
    // Sheet tạo từ phiên bản cũ: bổ sung tiêu đề các cột mới.
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  }
  return sheet;
}

/**
 * Mã người viết công khai: 10 ký tự hex đầu của SHA-256(deviceId).
 * Đủ để nhóm thư cùng một người mà không lộ mã thiết bị gốc. Cùng cách tính với writerIdOf() trong app.js.
 */
function writerId_(deviceId) {
  if (!deviceId) return '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(deviceId), Utilities.Charset.UTF_8);
  return bytes.slice(0, 5).map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function isVisible_(status) {
  const s = String(status).trim();
  return s === '' || s === 'show';
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max);
}

/** Chặn chèn công thức: chuỗi bắt đầu bằng = + - @ sẽ được lưu như văn bản. */
function safeCell_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
