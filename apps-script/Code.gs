/**
 * Backend cho trang thư iubabi — chạy trong Google Apps Script gắn với một Google Sheet.
 * Trang riêng cho hai người: mọi yêu cầu đọc hay gửi thư đều phải kèm mã bí mật.
 *
 * Cột trong sheet "Letters":
 *   id | createdAt | author | title | content | type | status | deviceId | device
 *   - type:     owner (thư của anh) | partner (thư của em)
 *   - status:   show (hiện) | hide (ẩn)
 *   - deviceId: mã ngẫu nhiên mà mỗi trình duyệt tự tạo
 *   - device:   loại thiết bị, ví dụ "iPhone · Safari"
 *
 * Có thể gõ thư trực tiếp vào sheet: điền createdAt, author, title, content;
 * để trống type thì được coi là thư của anh, để trống status thì thư được hiện.
 *
 * Script properties (Project Settings → Script properties) — hàm setup() tự tạo:
 *   OWNER_KEY    mã bí mật của anh
 *   PARTNER_KEY  mã bí mật của em
 */

const SHEET_NAME = 'Letters';
const HEADERS = ['id', 'createdAt', 'author', 'title', 'content', 'type', 'status', 'deviceId', 'device'];
const LIMITS = { author: 50, title: 120, content: 5000, device: 60 };
const DEFAULT_NAMES = { owner: 'Anh', partner: 'Em' };
const LOCKED = { ok: false, locked: true, error: 'Mã bí mật không đúng.' };

/** Chạy trong trình soạn Apps Script: tạo/cập nhật sheet, tạo mã bí mật còn thiếu và in ra nhật ký. */
function setup() {
  formatSheet_(getSheet_());
  const props = PropertiesService.getScriptProperties();
  ['OWNER_KEY', 'PARTNER_KEY'].forEach((name) => {
    if (!props.getProperty(name)) props.setProperty(name, newKey_());
  });
  logKeys_();
}

/** Chạy khi nghi mã bị lộ: tạo mã mới cho cả hai, mã cũ hết hiệu lực ngay. */
function resetKeys() {
  PropertiesService.getScriptProperties().setProperties({ OWNER_KEY: newKey_(), PARTNER_KEY: newKey_() });
  logKeys_();
}

function doGet(e) {
  const role = roleOf_(e && e.parameter.key);
  if (!role) return json_(LOCKED);

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
      type: typeOf_(row[5]),
    }));
  return json_({ ok: true, role: role, letters: letters });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Dữ liệu gửi lên không hợp lệ.' });
  }

  const role = roleOf_(body.key);
  if (!role) return json_(LOCKED);

  const content = clean_(body.content, LIMITS.content);
  if (!content) return json_({ ok: false, error: 'Nội dung thư không được để trống.' });

  const id = Utilities.getUuid();
  const deviceId = /^[A-Za-z0-9-]{8,64}$/.test(String(body.deviceId)) ? String(body.deviceId) : '';

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet_().appendRow([
      id,
      new Date(),
      safeCell_(clean_(body.author, LIMITS.author) || DEFAULT_NAMES[role]),
      safeCell_(clean_(body.title, LIMITS.title)),
      safeCell_(content),
      role,
      'show',
      deviceId,
      safeCell_(clean_(body.device, LIMITS.device)),
    ]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, id: id });
}

function roleOf_(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  const props = PropertiesService.getScriptProperties();
  if (k === props.getProperty('OWNER_KEY')) return 'owner';
  if (k === props.getProperty('PARTNER_KEY')) return 'partner';
  return null;
}

/** Ô trống hoặc "owner" là thư của anh; "partner" (hoặc "guest" từ phiên bản cũ) là thư của em. */
function typeOf_(value) {
  const t = String(value).trim();
  return t === 'partner' || t === 'guest' ? 'partner' : 'owner';
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    formatSheet_(sheet);
  }
  return sheet;
}

/** Tiêu đề cột và danh sách chọn — chạy lại được với sheet từ phiên bản cũ. */
function formatSheet_(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(5, 400);
  const rule = (values) => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();
  sheet.getRange('F2:F').setDataValidation(rule(['owner', 'partner']));
  sheet.getRange('G2:G').setDataValidation(rule(['show', 'hide']));
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function logKeys_() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('Mã của anh (OWNER_KEY):   ' + props.getProperty('OWNER_KEY'));
  Logger.log('Mã của em  (PARTNER_KEY): ' + props.getProperty('PARTNER_KEY'));
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
