/**
 * แบบสำรวจผลกระทบน้ำท่วมต่อนักเรียน (งบเงินอุดหนุน) — Google Apps Script backend
 * ใช้กับโรงเรียนเดียว เก็บข้อมูลแยกรายห้องเรียน
 *
 * วิธีติดตั้ง (ดูรายละเอียดใน README.md)
 *  1. สร้าง Google Sheet ใหม่ > ส่วนขยาย > Apps Script > วางโค้ดนี้ทั้งหมดลงใน code.gs
 *  2. เลือกฟังก์ชัน setup แล้วกด "เรียกใช้" 1 ครั้ง (อนุญาตสิทธิ์) ระบบจะสร้างชีต Rooms / Students / Settings
 *  3. ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท: เว็บแอป
 *     - เรียกใช้ในฐานะ: ฉัน   - ผู้มีสิทธิ์เข้าถึง: ทุกคน
 *  4. คัดลอก URL ที่ลงท้ายด้วย /exec ไปใส่ใน assets/config.js (API_URL)
 */

var SHEET_ROOMS = 'Rooms';
var SHEET_STUDENTS = 'Students';
var SHEET_SETTINGS = 'Settings';

var HEADERS = {
  Rooms: ['ห้องเรียน', 'ชั้น', 'ครูผู้รายงาน', 'โทรศัพท์', 'วันที่รายงาน', 'จำนวนนักเรียนที่ได้รับผลกระทบ',
    'หนังสือเรียน (คน)', 'อุปกรณ์การเรียน (คน)', 'เครื่องแบบนักเรียน (คน)', 'บันทึกล่าสุด'],
  Students: ['ห้องเรียน', 'ชั้น', 'ที่', 'รหัสนักเรียน', 'เลขประจำตัว 13 หลัก', 'ชื่อ - สกุล',
    'หนังสือเรียน', 'อุปกรณ์การเรียน', 'เครื่องแบบนักเรียน', 'หมายเหตุ', 'ที่มา', 'บันทึกล่าสุด'],
  Settings: ['key', 'รายการ', 'ค่า']
};
// คอลัมน์ที่ต้องเก็บเป็นข้อความ (กันเลข 0 นำหน้าหาย / เลข 13 หลักกลายเป็น 1.1E+12 / วันที่ถูกแปลง)
var TEXT_COLS = {
  Rooms: [1, 2, 4, 5, 10],
  Students: [1, 2, 4, 5, 12],
  Settings: [1, 3]
};
var SETTINGS = [
  ['directorName', 'ผู้อำนวยการโรงเรียน (ชื่อ - สกุล)'],
  ['directorPhone', 'โทรศัพท์ ผู้อำนวยการ'],
  ['coordinatorName', 'ครูผู้รับผิดชอบ/ผู้รายงานภาพรวม (ชื่อ - สกุล)'],
  ['coordinatorPhone', 'โทรศัพท์ ครูผู้รับผิดชอบ'],
  ['reportDate', 'วันที่รายงานภาพรวม (yyyy-mm-dd)']
];

// ---------------- ติดตั้ง ----------------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [SHEET_ROOMS, SHEET_STUDENTS, SHEET_SETTINGS].forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var h = HEADERS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#fde68a');
    sh.setFrozenRows(1);
    TEXT_COLS[name].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
  });
  var st = ss.getSheetByName(SHEET_SETTINGS);
  var have = {};
  rows_(st).forEach(function (r) { have[str_(r[0])] = true; });
  SETTINGS.forEach(function (s) { if (!have[s[0]]) st.appendRow([s[0], s[1], '']); });
  [SHEET_ROOMS, SHEET_STUDENTS, SHEET_SETTINGS].forEach(function (name) {
    ss.getSheetByName(name).autoResizeColumns(1, HEADERS[name].length);
  });
  var first = ss.getSheets()[0];
  if ((first.getName() === 'Sheet1' || first.getName() === 'ชีต1') && first.getLastRow() === 0) ss.deleteSheet(first);
}

// ---------------- HTTP ----------------
function doGet(e) {
  var p = (e && e.parameter) || {};
  return handle_(function () {
    if (p.action === 'rooms') return cached_('rooms', function () { return { rooms: getRooms_(), settings: getSettings_() }; });
    if (p.action === 'room') return cached_('room:' + str_(p.room), function () { return getRoom_(p.room); });
    if (p.action === 'all') return cached_('all', function () { return { rooms: getRooms_(), settings: getSettings_(), students: getStudents_() }; });
    return { message: 'API พร้อมใช้งาน' };
  });
}

// ---------------- cache (ลดการอ่านชีตเมื่อหลายคนเปิดพร้อมกัน) ----------------
var CACHE_SECONDS = 300;

function cached_(key, fn) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var value = fn();
  try { cache.put(key, JSON.stringify(value), CACHE_SECONDS); } catch (e) { /* ใหญ่เกิน 100KB ก็ไม่ cache */ }
  return value;
}

// ไม่ระบุห้อง = ล้างทุกห้อง (ใช้ตอนแก้ข้อมูลผู้ลงนาม เพราะข้อมูลรายห้องแนบ settings ไปด้วย)
function clearCache_(room) {
  var keys = ['rooms', 'all'];
  if (room) keys.push('room:' + room);
  else getRooms_().forEach(function (r) { keys.push('room:' + r.room); });
  CacheService.getScriptCache().removeAll(keys);
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'save') return saveRoom_(body.data);
    if (body.action === 'saveSettings') return saveSettings_(body.data);
    throw new Error('ไม่รู้จักคำสั่ง: ' + body.action);
  });
}

function handle_(fn) {
  var out;
  try {
    out = fn();
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------- อ่านข้อมูล ----------------
function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name + ' — กรุณาเรียกใช้ฟังก์ชัน setup ก่อน');
  return sh;
}

function rows_(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
}

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  return v == null ? '' : String(v).trim();
}

function now_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'); }

function roomFromRow_(r) {
  return {
    room: str_(r[0]), grade: str_(r[1]), teacherName: str_(r[2]), teacherPhone: str_(r[3]),
    reportDate: str_(r[4]).slice(0, 10), count: Number(r[5]) || 0, book: Number(r[6]) || 0,
    supplies: Number(r[7]) || 0, uniform: Number(r[8]) || 0, updatedAt: str_(r[9])
  };
}

function studentFromRow_(r) {
  return {
    room: str_(r[0]), grade: str_(r[1]), no: Number(r[2]) || 0, schoolId: str_(r[3]),
    citizenId: str_(r[4]), name: str_(r[5]),
    book: Number(r[6]) === 1, supplies: Number(r[7]) === 1, uniform: Number(r[8]) === 1,
    note: str_(r[9]), manual: str_(r[10]) === 'เพิ่มเอง'
  };
}

function getRooms_() {
  return rows_(sheet_(SHEET_ROOMS)).filter(function (r) { return str_(r[0]); }).map(roomFromRow_);
}

function getStudents_() {
  return rows_(sheet_(SHEET_STUDENTS)).filter(function (r) { return str_(r[0]); }).map(studentFromRow_);
}

function getSettings_() {
  var out = {};
  rows_(sheet_(SHEET_SETTINGS)).forEach(function (r) { if (str_(r[0])) out[str_(r[0])] = str_(r[2]); });
  return out;
}

function getRoom_(room) {
  room = str_(room);
  if (!room) throw new Error('ไม่ได้ระบุห้องเรียน');
  var meta = null;
  getRooms_().some(function (r) { if (r.room === room) { meta = r; return true; } return false; });
  var students = getStudents_().filter(function (s) { return s.room === room; });
  return { room: meta, students: students, settings: getSettings_() };
}

// ---------------- บันทึก ----------------
function saveRoom_(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  var room = str_(d.room);
  if (!room || room.length > 40) throw new Error('ชื่อห้องเรียนไม่ถูกต้อง');
  var grade = str_(d.grade);
  var list = d.students || [];
  if (list.length > 500) throw new Error('จำนวนนักเรียนมากเกินไป');
  var seen = {};
  list.forEach(function (s, i) {
    var no = i + 1;
    var id = str_(s.citizenId).replace(/[\s-]/g, '');
    if (!id) throw new Error('รายการที่ ' + no + ': กรุณากรอกเลขประจำตัว');
    if (seen[id]) throw new Error('รายการที่ ' + no + ': เลขประจำตัวซ้ำ (' + id + ')');
    seen[id] = true;
    if (!str_(s.name)) throw new Error('รายการที่ ' + no + ': กรุณากรอกชื่อ - สกุล');
    if (!s.book && !s.supplies && !s.uniform) throw new Error('รายการที่ ' + no + ': เลือกผลกระทบอย่างน้อย 1 รายการ');
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = now_();

    // ----- Students: เขียนทับเฉพาะห้องนี้ -----
    var st = sheet_(SHEET_STUDENTS);
    var width = HEADERS.Students.length;
    var old = rows_(st);
    var keep = old.filter(function (r) { return str_(r[0]) && str_(r[0]) !== room; })
      .map(function (r) { return r.slice(0, width).map(function (v, i) { return TEXT_COLS.Students.indexOf(i + 1) >= 0 ? str_(v) : v; }); });
    var mine = list.map(function (s) {
      return [room, grade, Number(s.no) || '', str_(s.schoolId), str_(s.citizenId).replace(/[\s-]/g, '').toUpperCase(),
        str_(s.name), s.book ? 1 : 0, s.supplies ? 1 : 0, s.uniform ? 1 : 0, str_(s.note),
        s.manual ? 'เพิ่มเอง' : 'API', now];
    });
    var all = keep.concat(mine);
    if (old.length) st.getRange(2, 1, old.length, st.getLastColumn()).clearContent();
    if (all.length) {
      TEXT_COLS.Students.forEach(function (c) { st.getRange(2, c, all.length, 1).setNumberFormat('@'); });
      st.getRange(2, 1, all.length, width).setValues(all);
    }

    // ----- Rooms: 1 แถวต่อห้อง -----
    var rs = sheet_(SHEET_ROOMS);
    var count = function (k) { return list.filter(function (s) { return s[k]; }).length; };
    var row = [room, grade, str_(d.teacherName), str_(d.teacherPhone), str_(d.reportDate),
      list.length, count('book'), count('supplies'), count('uniform'), now];
    var idx = -1;
    rows_(rs).some(function (r, i) { if (str_(r[0]) === room) { idx = i; return true; } return false; });
    var target = idx >= 0 ? idx + 2 : rs.getLastRow() + 1;
    TEXT_COLS.Rooms.forEach(function (c) { rs.getRange(target, c).setNumberFormat('@'); });
    rs.getRange(target, 1, 1, row.length).setValues([row]);

    SpreadsheetApp.flush();
    clearCache_(room);
    return { savedAt: now, count: list.length, room: roomFromRow_(row) };
  } finally {
    lock.releaseLock();
  }
}

function saveSettings_(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_(SHEET_SETTINGS);
    var rr = rows_(sh);
    SETTINGS.forEach(function (s) {
      var key = s[0];
      if (!(key in d)) return;
      var value = str_(d[key]).slice(0, 200);
      var idx = -1;
      rr.some(function (r, i) { if (str_(r[0]) === key) { idx = i; return true; } return false; });
      var target = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
      sh.getRange(target, 3).setNumberFormat('@');
      sh.getRange(target, 1, 1, 3).setValues([[key, s[1], value]]);
      if (idx < 0) rr.push([key, s[1], value]);
    });
    SpreadsheetApp.flush();
    clearCache_();
    return { settings: getSettings_() };
  } finally {
    lock.releaseLock();
  }
}
