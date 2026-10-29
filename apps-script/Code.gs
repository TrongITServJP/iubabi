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
 * Sheet "Subscriptions": các máy đã bật thông báo (endpoint | role | device | updatedAt).
 * Khi một người gửi thư, máy của người kia nhận thông báo đẩy (Web Push).
 *
 * Script properties (Project Settings → Script properties) — hàm setup() tự tạo:
 *   OWNER_KEY      mã bí mật của anh
 *   PARTNER_KEY    mã bí mật của em
 *   VAPID_PRIVATE  khóa ký thông báo đẩy (không chia sẻ)
 *   VAPID_PUBLIC   khóa công khai, trang web dùng để đăng ký nhận thông báo
 */

const SHEET_NAME = 'Letters';
const SUBS_SHEET = 'Subscriptions';
const VAPID_SUBJECT = 'https://trongitservjp.github.io/iubabi/';
// Chỉ gửi thông báo tới dịch vụ push của trình duyệt (Chrome/Edge, Firefox, Safari, Windows).
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;
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
  if (!props.getProperty('VAPID_PRIVATE')) {
    const keys = vapidKeys_();
    props.setProperties({ VAPID_PRIVATE: keys.privateKey, VAPID_PUBLIC: keys.publicKey });
  }
  getSubsSheet_();
  logKeys_();
}

/** Gửi thử một thông báo tới mọi máy đã bật thông báo; xem kết quả trong nhật ký. */
function testPush() {
  Logger.log(JSON.stringify(notify_(null), null, 2));
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
  const push = PropertiesService.getScriptProperties().getProperty('VAPID_PUBLIC') || '';
  return json_({ ok: true, role: role, letters: letters, push: push });
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
  if (body.action === 'subscribe') return json_(subscribe_(body, role));
  if (body.action === 'unsubscribe') return json_(unsubscribe_(body));

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

  try {
    notify_(role === 'owner' ? 'partner' : 'owner');
  } catch (err) {
    console.error('Không gửi được thông báo: ' + err); // thư đã lưu, chỉ thiếu thông báo
  }
  return json_({ ok: true, id: id });
}

// ---------- Đăng ký nhận thông báo ----------

function subscribe_(body, role) {
  const endpoint = String(body.endpoint || '');
  if (!PUSH_HOSTS.test(endpoint) || endpoint.length > 1000) {
    return { ok: false, error: 'Đăng ký thông báo không hợp lệ.' };
  }
  const row = [endpoint, role, safeCell_(clean_(body.device, LIMITS.device)), new Date()];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubsSheet_();
    const line = findEndpoint_(sheet, endpoint);
    if (line) sheet.getRange(line, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function unsubscribe_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubsSheet_();
    const line = findEndpoint_(sheet, String(body.endpoint || ''));
    if (line) sheet.deleteRow(line);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** Số dòng (tính từ 1) chứa endpoint, hoặc 0 nếu không có. */
function findEndpoint_(sheet, endpoint) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === endpoint) return i + 1;
  }
  return 0;
}

/**
 * Gửi thông báo đẩy (không kèm nội dung) tới các máy của `role`; role null = tất cả.
 * Đăng ký đã hết hạn (404/410) được xóa khỏi sheet.
 */
function notify_(role) {
  const props = PropertiesService.getScriptProperties();
  const privateKey = props.getProperty('VAPID_PRIVATE');
  const publicKey = props.getProperty('VAPID_PUBLIC');
  if (!privateKey) return [];

  const sheet = getSubsSheet_();
  const targets = sheet.getDataRange().getValues().slice(1)
    .map((r, i) => ({ endpoint: String(r[0]), role: String(r[1]), device: String(r[2]), line: i + 2 }))
    .filter((t) => t.endpoint && (!role || t.role === role));
  if (!targets.length) return [];

  const jwtByOrigin = {};
  const responses = UrlFetchApp.fetchAll(targets.map((t) => {
    const origin = t.endpoint.match(/^https:\/\/[^/]+/)[0];
    jwtByOrigin[origin] = jwtByOrigin[origin] || vapidJwt_(origin, privateKey);
    return {
      url: t.endpoint,
      method: 'post',
      headers: { TTL: '86400', Urgency: 'high', Authorization: 'vapid t=' + jwtByOrigin[origin] + ', k=' + publicKey },
      muteHttpExceptions: true,
    };
  }));

  const results = targets.map((t, i) => ({ device: t.device, role: t.role, line: t.line, status: responses[i].getResponseCode() }));
  results
    .filter((r) => r.status === 404 || r.status === 410)
    .sort((a, b) => b.line - a.line) // xóa từ dưới lên để số dòng không bị lệch
    .forEach((r) => sheet.deleteRow(r.line));
  return results;
}

// ---------- Web Push: chữ ký VAPID (ES256 trên đường cong P-256) ----------
// Apps Script không có sẵn ECDSA nên tự tính bằng BigInt. Thông báo gửi đi không kèm nội dung
// nên không cần mã hóa payload, chỉ cần ký JWT.

// Apps Script không đọc được số BigInt viết dạng 0n, 1n… nên tạo bằng hàm BigInt().
const N0 = BigInt(0);
const N1 = BigInt(1);
const N2 = BigInt(2);
const N3 = BigInt(3);

const EC = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  G: [
    BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
    BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
  ],
};

function vapidKeys_() {
  const d = randomScalar_();
  const Q = ecMul_(d, EC.G);
  return {
    privateKey: d.toString(16),
    publicKey: b64url_([4].concat(intToBytes_(Q[0]), intToBytes_(Q[1]))),
  };
}

function vapidJwt_(audience, privateKeyHex) {
  const header = b64url_(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url_(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT }));
  const input = header + '.' + claims;
  return input + '.' + b64url_(ecSign_(input, BigInt('0x' + privateKeyHex)));
}

function ecSign_(message, d) {
  const e = bytesToInt_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message, Utilities.Charset.UTF_8));
  for (;;) {
    const k = randomScalar_();
    const r = mod_(ecMul_(k, EC.G)[0], EC.n);
    const s = mod_(inv_(k, EC.n) * (e + r * d), EC.n);
    if (r > N0 && s > N0) return intToBytes_(r).concat(intToBytes_(s));
  }
}

/** Số ngẫu nhiên trong [1, n) — lấy từ UUID (SecureRandom của Google) rồi băm SHA-256. */
function randomScalar_() {
  for (;;) {
    const seed = [0, 1, 2, 3].map(() => Utilities.getUuid()).join('') + Date.now();
    const k = mod_(bytesToInt_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed)), EC.n);
    if (k > N0) return k;
  }
}

function ecAdd_(P, Q) {
  if (!P) return Q;
  if (!Q) return P;
  const p = EC.p;
  let l;
  if (P[0] === Q[0]) {
    if (mod_(P[1] + Q[1], p) === N0) return null;
    l = mod_((N3 * P[0] * P[0] - N3) * inv_(N2 * P[1], p), p); // a = -3
  } else {
    l = mod_((Q[1] - P[1]) * inv_(Q[0] - P[0], p), p);
  }
  const x = mod_(l * l - P[0] - Q[0], p);
  return [x, mod_(l * (P[0] - x) - P[1], p)];
}

function ecMul_(k, P) {
  let result = null;
  let addend = P;
  while (k > N0) {
    if (k & N1) result = ecAdd_(result, addend);
    addend = ecAdd_(addend, addend);
    k >>= N1;
  }
  return result;
}

function mod_(a, m) {
  const r = a % m;
  return r < N0 ? r + m : r;
}

function inv_(a, m) {
  let [r0, r1] = [mod_(a, m), m];
  let [s0, s1] = [N1, N0];
  while (r1 !== N0) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return mod_(s0, m);
}

function bytesToInt_(bytes) {
  return BigInt('0x' + bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''));
}

/** Số nguyên → 32 byte (dạng byte có dấu như Apps Script dùng). */
function intToBytes_(x) {
  const hex = x.toString(16).padStart(64, '0');
  const bytes = [];
  for (let i = 0; i < 64; i += 2) {
    const v = parseInt(hex.slice(i, i + 2), 16);
    bytes.push(v > 127 ? v - 256 : v);
  }
  return bytes;
}

function b64url_(data) {
  return Utilities.base64EncodeWebSafe(data).replace(/=+$/, '');
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

function getSubsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SUBS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SUBS_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['endpoint', 'role', 'device', 'updatedAt']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
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
