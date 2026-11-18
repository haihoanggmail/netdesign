/**
 * HACHIHI — Nhận log truy cập từ Vercel và ghi vào Google Sheet.
 *
 * CÀI ĐẶT (xem README mục "Ghi log truy cập về Google Sheet"):
 *  1. Mở Google Sheet → Tiện ích mở rộng → Apps Script → dán toàn bộ file này vào Code.gs.
 *  2. Project Settings (⚙) → Script properties → Add: SERECT_SHEET = <chuỗi bí mật dài, ngẫu nhiên>.
 *  3. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy.
 *  4. Copy "Web app URL" (dạng https://script.google.com/macros/s/.../exec) dán vào biến URL_SHEET trên Vercel.
 *
 * Secret sai / thiếu, dữ liệu sai, hoặc bất kỳ lỗi nào → BỎ QUA (không ghi, không báo lỗi chi tiết).
 */

var SHEET_NAME = 'Log';
var HEADERS = ['time', 'ip', 'Quốc gia', 'Thành Phố', 'VisitID', 'SessionID', 'Action', 'detail', 'device', 'language', 'resolution'];
var FIELDS = ['time', 'ip', 'country', 'city', 'visitId', 'sessionId', 'action', 'detail', 'device', 'language', 'resolution'];
var ALLOWED_ACTIONS = ['visit', 'template', 'save', 'export'];

function doPost(e) {
  try {
    var body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SERECT_SHEET') || props.getProperty('SECRET_SHEET');

    // Sai hoặc thiếu secret → bỏ qua.
    if (!secret || !body || typeof body.secret !== 'string' || body.secret !== secret) {
      return respond_('ignored');
    }
    var data = body.data;
    if (!data || typeof data !== 'object' || ALLOWED_ACTIONS.indexOf(String(data.action)) === -1) {
      return respond_('ignored');
    }

    var row = FIELDS.map(function (f) { return safeCell_(data[f]); });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet_();
      sheet.appendRow(row);
    } finally {
      lock.releaseLock();
    }
    return respond_('ok');
  } catch (err) {
    return respond_('ignored'); // lỗi ghi log → bỏ qua
  }
}

// Mở URL Web App bằng trình duyệt (GET) không ghi gì.
function doGet() {
  return respond_('ok');
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Chặn "công thức" (= + - @) và giới hạn độ dài ô.
function safeCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function respond_(text) {
  return ContentService.createTextOutput(text);
}
