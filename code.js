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
 *     (ถ้าอัปเดตโค้ดจากเวอร์ชันเก่า ให้เรียกใช้ setup อีกครั้ง เพื่ออนุญาตสิทธิ์ Google Drive สำหรับเก็บรูป)
 *  5. (แนะนำ) เรียกใช้ installTriggers 1 ครั้ง ให้ดึงรายชื่อนักเรียนลงชีต Roster ทุกวัน และล้างรูปที่ถูกลบใน Drive ทุกชั่วโมง
 */

// API รายชื่อนักเรียนต้นทาง (ตอบช้า ~5 วินาที จึงดึงมาเก็บไว้ในชีต Roster แล้วให้หน้าเว็บอ่านจากที่นี่แทน)
var STUDENT_API_URL = 'https://script.google.com/macros/s/AKfycbwGKkKFJhysM4U02sUEd-v01wTCd7pBiHxFcTi7gPNCWybgT1xT6Md3e6bZyWry2eZx/exec';

var SHEET_ROOMS = 'Rooms';
var SHEET_STUDENTS = 'Students';
var SHEET_SETTINGS = 'Settings';
var SHEET_ROSTER = 'Roster';
var SHEET_PHOTOS = 'Photos';

// โฟลเดอร์ Google Drive เก็บรูปสภาพน้ำท่วม (ระบบสร้างโฟลเดอร์ย่อยตามชื่อห้องให้เอง)
// เจ้าของสคริปต์ต้องมีสิทธิ์แก้ไขโฟลเดอร์นี้
var PHOTO_FOLDER_ID = '1ews70RGnNhcRoNg_iQQ8nPV7iDcAcBKo';
var MAX_PHOTOS = 10;                 // ต่อห้อง
var MAX_PHOTO_B64 = 8 * 1024 * 1024; // หน้าเว็บย่อรูปก่อนส่งแล้ว ปกติไม่ถึง 1 MB
var PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

var HEADERS = {
  Rooms: ['ห้องเรียน', 'ชั้น', 'ครูผู้รายงาน', 'โทรศัพท์', 'วันที่รายงาน', 'จำนวนนักเรียนที่ได้รับผลกระทบ',
    'หนังสือเรียน (คน)', 'อุปกรณ์การเรียน (คน)', 'เครื่องแบบนักเรียน (คน)', 'บันทึกล่าสุด'],
  Students: ['ห้องเรียน', 'ชั้น', 'ที่', 'รหัสนักเรียน', 'เลขประจำตัว 13 หลัก', 'ชื่อ - สกุล',
    'หนังสือเรียน', 'อุปกรณ์การเรียน', 'เครื่องแบบนักเรียน', 'หมายเหตุ', 'ที่มา', 'บันทึกล่าสุด'],
  Settings: ['key', 'รายการ', 'ค่า'],
  // ใช้ชื่อฟิลด์เดียวกับ API ต้นทาง หน้าเว็บจะได้อ่านได้เหมือนเดิม
  Roster: ['classroom', 'no', 'student_id', 'citizen_id', 'prefix', 'first_name', 'last_name'],
  Photos: ['ห้องเรียน', 'fileId', 'ชื่อไฟล์', 'ลิงก์', 'รูปย่อ', 'อัปโหลดเมื่อ', 'คำอธิบายภาพ']
};
// คอลัมน์ที่ต้องเก็บเป็นข้อความ (กันเลข 0 นำหน้าหาย / เลข 13 หลักกลายเป็น 1.1E+12 / วันที่ถูกแปลง)
var TEXT_COLS = {
  Rooms: [1, 2, 4, 5, 10],
  Students: [1, 2, 4, 5, 12],
  Settings: [1, 3],
  Roster: [1, 3, 4, 5, 6, 7],
  Photos: [1, 2, 3, 4, 5, 6, 7]
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
  [SHEET_ROOMS, SHEET_STUDENTS, SHEET_SETTINGS, SHEET_ROSTER, SHEET_PHOTOS].forEach(function (name) {
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
  checkPhotoFolder();
  var first = ss.getSheets()[0];
  if ((first.getName() === 'Sheet1' || first.getName() === 'ชีต1') && first.getLastRow() === 0) ss.deleteSheet(first);
}

// ---------------- HTTP ----------------
function doGet(e) {
  var p = (e && e.parameter) || {};
  return handle_(function () {
    if (p.action === 'rooms') return cached_('rooms', function () { return { rooms: getRooms_(), settings: getSettings_() }; });
    if (p.action === 'room') return cached_('room:' + str_(p.room), function () { return getRoom_(p.room); });
    if (p.action === 'roster') return cached_('roster', getRoster_, LONG_CACHE_SECONDS);
    if (p.action === 'photos') return cached_('photos:' + str_(p.room), function () { return { photos: getPhotos_(p.room) }; }, LONG_CACHE_SECONDS);
    if (p.action === 'photo') return getPhoto_(p.room, p.id);
    if (p.action === 'all') return cached_('all', function () { return { rooms: getRooms_(), settings: getSettings_(), students: getStudents_() }; });
    return { message: 'API พร้อมใช้งาน' };
  });
}

// ---------------- cache (ลดการอ่านชีตเมื่อหลายคนเปิดพร้อมกัน) ----------------
var CACHE_SECONDS = 300;
// รายชื่อ/รูป เปลี่ยนเฉพาะตอน syncRoster / อัปโหลด / ลบรูป ซึ่งล้าง cache ให้เองอยู่แล้ว จึงเก็บได้นานสุดที่ CacheService ยอม (6 ชม.)
var LONG_CACHE_SECONDS = 21600;

function cached_(key, fn, seconds) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var value = fn();
  try { cache.put(key, JSON.stringify(value), seconds || CACHE_SECONDS); } catch (e) { /* ใหญ่เกิน 100KB ก็ไม่ cache */ }
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
    // ไม่ส่ง students = ดึงจาก STUDENT_API_URL ใหม่, ส่ง students (array แบบเดียวกับ API ต้นทาง) = เขียนลงชีตตามนั้น
    if (body.action === 'syncRoster') return syncRoster_(body.students);
    if (body.action === 'uploadPhoto') return uploadPhoto_(body.data);
    if (body.action === 'deletePhoto') return deletePhoto_(body.data);
    if (body.action === 'captionPhoto') return captionPhoto_(body.data);
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

// ชีตที่เพิ่มภายหลัง (Roster / Photos) สร้างให้เองถ้ายังไม่มี ไม่ต้องเรียก setup ใหม่
function ensureSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold').setBackground('#fde68a');
  sh.setFrozenRows(1);
  return sh;
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

// ---------------- รายชื่อนักเรียน (Roster) ----------------
// เรียกจากปุ่ม "เรียกใช้" ได้โดยตรง หรือให้ trigger เรียกทุกวัน
function syncRoster() {
  var res = syncRoster_();
  Logger.log('อัปเดตรายชื่อ ' + res.count + ' คน เมื่อ ' + res.syncedAt);
}

// ตั้ง trigger ดึงรายชื่อทุกวันช่วงตี 5 (เรียกซ้ำได้ จะไม่สร้าง trigger ซ้ำ)
function installRosterTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncRoster') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncRoster').timeBased().everyDays(1).atHour(5).create();
  syncRoster();
}

// ตั้ง trigger ทั้งหมด: ดึงรายชื่อทุกวันตี 5 + ล้างรูปที่ถูกลบใน Drive ทุกชั่วโมง (เรียกซ้ำได้ ไม่สร้างซ้ำ)
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cleanupPhotos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanupPhotos').timeBased().everyHours(1).create();
  installRosterTrigger();
  cleanupPhotos();
}

function fetchRoster_() {
  var res = UrlFetchApp.fetch(STUDENT_API_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('API รายชื่อนักเรียนตอบกลับ ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function syncRoster_(list) {
  if (list == null) list = fetchRoster_();
  if (!Array.isArray(list)) throw new Error('รูปแบบข้อมูลรายชื่อนักเรียนไม่ถูกต้อง');
  var rows = list.filter(function (s) { return s && str_(s.classroom); }).map(function (s) {
    return HEADERS.Roster.map(function (k) { return k === 'no' ? (Number(s.no) || '') : str_(s[k]); });
  });
  // กัน API ต้นทางพังชั่วคราวแล้วส่ง [] มา ทำให้รายชื่อหายทั้งโรงเรียน
  if (!rows.length) throw new Error('API รายชื่อนักเรียนไม่มีข้อมูล จึงไม่เขียนทับรายชื่อเดิม');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ensureSheet_(SHEET_ROSTER);
    var width = HEADERS.Roster.length;
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(width, sh.getLastColumn())).clearContent();
    TEXT_COLS.Roster.forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('@'); });
    sh.getRange(2, 1, rows.length, width).setValues(rows);
    var syncedAt = now_();
    PropertiesService.getScriptProperties().setProperty('rosterSyncedAt', syncedAt);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('roster');
    return { count: rows.length, syncedAt: syncedAt };
  } finally {
    lock.releaseLock();
  }
}

function getRoster_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ROSTER);
  // ยังไม่เคยดึงรายชื่อ ดึงให้ครั้งแรกเลย (ครั้งนี้จะช้า ครั้งต่อไปเร็ว)
  if (!sh || sh.getLastRow() < 2) syncRoster_();
  var keys = HEADERS.Roster;
  var students = rows_(sheet_(SHEET_ROSTER)).filter(function (r) { return str_(r[0]); }).map(function (r) {
    var o = {};
    keys.forEach(function (k, i) { o[k] = k === 'no' ? (Number(r[i]) || 0) : str_(r[i]); });
    return o;
  });
  return { students: students, syncedAt: PropertiesService.getScriptProperties().getProperty('rosterSyncedAt') || '' };
}

// ---------------- รูปภาพสภาพน้ำท่วม ----------------
function photoFromRow_(r) {
  return { room: str_(r[0]), id: str_(r[1]), name: str_(r[2]), url: str_(r[3]), thumb: str_(r[4]), uploadedAt: str_(r[5]), caption: str_(r[6]) };
}

var MAX_CAPTION = 150;

function cleanCaption_(v) {
  return str_(v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, MAX_CAPTION);
}

// ชีต Photos ที่สร้างก่อนมีคำอธิบายภาพ ยังไม่มีหัวคอลัมน์ G เติมให้
function ensurePhotoCaptionHeader_(sh) {
  var col = HEADERS.Photos.length;
  if (str_(sh.getRange(1, col).getValue()) !== HEADERS.Photos[col - 1]) {
    sh.getRange(1, col).setValue(HEADERS.Photos[col - 1]).setFontWeight('bold').setBackground('#fde68a');
  }
}

// บันทึกคำอธิบายภาพ (เว้นว่าง = ใช้แค่ "ภาพที่ n" ในบันทึกข้อความ)
function captionPhoto_(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  var room = str_(d.room), id = str_(d.id), caption = cleanCaption_(d.caption);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ensureSheet_(SHEET_PHOTOS);
    ensurePhotoCaptionHeader_(sh);
    var idx = -1;
    rows_(sh).some(function (r, i) { if (str_(r[0]) === room && str_(r[1]) === id) { idx = i; return true; } return false; });
    if (idx < 0) throw new Error('ไม่พบรูปนี้ในห้อง ' + room);
    sh.getRange(idx + 2, HEADERS.Photos.length).setNumberFormat('@').setValue(caption);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('photos:' + room);
    return { id: id, caption: caption };
  } finally {
    lock.releaseLock();
  }
}

// นับรูปของห้องจากคอลัมน์ห้องอย่างเดียว (ไม่อ่านรูปย่อทั้งชีต เร็วกว่า getPhotos_)
function countPhotos_(sh, room) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  return sh.getRange(2, 1, n, 1).getValues().filter(function (r) { return str_(r[0]) === room; }).length;
}

function getPhotos_(room) {
  room = str_(room);
  return rows_(ensureSheet_(SHEET_PHOTOS)).map(photoFromRow_).filter(function (p) { return p.id && p.room === room; });
}

// ส่งไฟล์รูปเต็ม (base64) ให้หน้าเว็บใส่ในบันทึกข้อความ Word
// อ่านได้เฉพาะไฟล์ที่อยู่ในชีต Photos ของห้องนั้น กันการใช้ id อ่านไฟล์อื่นใน Drive ของเจ้าของสคริปต์
function getPhoto_(room, id) {
  var ok = getPhotos_(room).some(function (p) { return p.id === str_(id); });
  if (!ok) throw new Error('ไม่พบรูปนี้ในห้อง ' + str_(room));
  var file = photoFile_(str_(id));
  if (!file) {
    // ไฟล์ถูกลบใน Drive โดยตรง ล้างแถวนี้ออกจากชีตเลย
    removePhotoRows_(function (r) { return str_(r[1]) === str_(id); });
    throw new Error('รูปนี้ถูกลบออกจาก Google Drive แล้ว');
  }
  var blob = file.getBlob();
  return { mimeType: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// คืนไฟล์ ถ้าไฟล์ถูกลบ/อยู่ในถังขยะ คืน null (error อื่น เช่น Drive ล่มชั่วคราว ให้โยนต่อ จะได้ไม่ลบแถวผิด)
function photoFile_(id) {
  try {
    var f = DriveApp.getFileById(id);
    return f.isTrashed() ? null : f;
  } catch (e) {
    if (/not found|could not be found|no item|ไม่พบ/i.test(String(e && e.message))) return null;
    throw e;
  }
}

// ลบแถวในชีต Photos ที่ตรงเงื่อนไข แล้วล้าง cache ของห้องที่เกี่ยวข้อง คืนจำนวนแถวที่ลบ
function removePhotoRows_(match) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ensureSheet_(SHEET_PHOTOS);
    var rows = rows_(sh), rooms = {}, removed = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      if (!match(rows[i])) continue;
      rooms['photos:' + str_(rows[i][0])] = true;
      sh.deleteRow(i + 2);
      removed++;
    }
    if (removed) {
      SpreadsheetApp.flush();
      CacheService.getScriptCache().removeAll(Object.keys(rooms));
    }
    return removed;
  } finally {
    lock.releaseLock();
  }
}

// ล้างแถวรูปที่ไฟล์ถูกลบใน Google Drive โดยตรง (ไม่ได้ลบผ่านปุ่ม × บนหน้าเว็บ)
// เรียกใช้จาก editor ได้ทันที และ installTriggers ตั้งให้ทำงานเองทุกชั่วโมง
function cleanupPhotos() {
  var gone = {};
  rows_(ensureSheet_(SHEET_PHOTOS)).forEach(function (r) {
    var id = str_(r[1]);
    if (id && !photoFile_(id)) gone[id] = true;
  });
  var removed = removePhotoRows_(function (r) { return gone[str_(r[1])]; });
  Logger.log('ล้างรูปที่ถูกลบใน Drive แล้ว ' + removed + ' รูป');
}

// ขอสิทธิ์ Google Drive แบบเต็ม (สร้างโฟลเดอร์/ไฟล์) แล้วลองสร้างโฟลเดอร์ทดสอบจริง 1 ครั้ง
// เรียกใช้จาก editor ได้โดยตรง ถ้าอัปโหลดรูปขึ้นว่า "ไม่ได้รับอนุญาต" ให้เรียกฟังก์ชันนี้
function checkPhotoFolder() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/drive']);
  var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  var test = folder.createFolder('_ทดสอบสิทธิ์_ลบได้');
  test.setTrashed(true);
  Logger.log('เข้าถึงและเขียนโฟลเดอร์รูปได้แล้ว: ' + folder.getName());
}

// จำ id โฟลเดอร์ของแต่ละห้องไว้ ไม่ต้องค้นหาใน Drive ทุกครั้งที่อัปรูป
function roomFolder_(room) {
  var props = PropertiesService.getScriptProperties();
  var key = 'photoFolder:' + PHOTO_FOLDER_ID + ':' + room;
  var id = props.getProperty(key);
  if (id) {
    // ไม่เช็ก isTrashed เพื่อประหยัดเวลา (ต้องเรียก Drive อีกรอบ) ถ้าลบโฟลเดอร์ห้องทิ้งเอง ให้ลบ property นี้ด้วย
    try { return DriveApp.getFolderById(id); } catch (e) { /* โฟลเดอร์ถูกลบถาวร สร้างใหม่ด้านล่าง */ }
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // กันสองคนอัปห้องเดียวกันพร้อมกันแล้วได้โฟลเดอร์ซ้ำ
    var parent = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    var it = parent.getFoldersByName(room);
    var folder = it.hasNext() ? it.next() : parent.createFolder(room);
    props.setProperty(key, folder.getId());
    return folder;
  } finally {
    lock.releaseLock();
  }
}

function uploadPhoto_(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  var room = str_(d.room);
  if (!room || room.length > 40) throw new Error('ชื่อห้องเรียนไม่ถูกต้อง');
  var ext = PHOTO_TYPES[str_(d.mimeType)];
  if (!ext) throw new Error('รองรับเฉพาะไฟล์รูป JPG, PNG หรือ WEBP');
  var data = str_(d.data);
  if (!data) throw new Error('ไม่มีไฟล์รูป');
  if (data.length > MAX_PHOTO_B64) throw new Error('ไฟล์รูปใหญ่เกินไป');
  var thumb = str_(d.thumb);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(thumb) || thumb.length > 45000) thumb = '';

  var full = 'ห้องนี้มีรูปครบ ' + MAX_PHOTOS + ' รูปแล้ว';

  // สร้างไฟล์ใน Drive (ส่วนที่ช้าที่สุด) นอก lock ครูห้องอื่นจะได้ไม่ต้องรอคิว
  var now = now_();
  var name = room.replace(/[\\\/:*?"<>|]/g, '-') + '_' + now.replace(/[-: ]/g, '') + '_' +
    Utilities.getUuid().slice(0, 4) + '.' + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(data), str_(d.mimeType), name);
  var folder = roomFolder_(room);
  var file = folder.createFile(blob);
  var row = [room, file.getId(), name, file.getUrl(), thumb, now, cleanCaption_(d.caption)];

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    // นับจำนวนใน lock กันอัปห้องเดียวกันพร้อมกันหลายรูปจนเกิน MAX_PHOTOS
    var sh = ensureSheet_(SHEET_PHOTOS);
    ensurePhotoCaptionHeader_(sh);
    if (countPhotos_(sh, room) >= MAX_PHOTOS) throw new Error(full);
    var target = sh.getLastRow() + 1;
    sh.getRange(target, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
  } catch (err) {
    // บันทึกลงชีตไม่ได้ ลบไฟล์ทิ้ง กันรูปค้างใน Drive โดยไม่มีในรายการ
    file.setTrashed(true);
    throw err;
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove('photos:' + room);
  return { photo: photoFromRow_(row) };
}

function deletePhoto_(d) {
  if (!d) throw new Error('ไม่มีข้อมูล');
  var room = str_(d.room), id = str_(d.id);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ensureSheet_(SHEET_PHOTOS);
    var idx = -1;
    rows_(sh).some(function (r, i) { if (str_(r[0]) === room && str_(r[1]) === id) { idx = i; return true; } return false; });
    if (idx < 0) throw new Error('ไม่พบรูปนี้ในห้อง ' + room);
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* ไฟล์ถูกลบใน Drive ไปแล้ว ลบแถวต่อได้ */ }
    sh.deleteRow(idx + 2);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('photos:' + room);
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}
