(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var API_URL = (CFG.API_URL || '').trim();
  var STUDENT_API_URL = (CFG.STUDENT_API_URL || '').trim();
  var SCHOOL = { code: (CFG.SCHOOL_CODE || '').trim(), name: (CFG.SCHOOL_NAME || '').trim() };
  var GRADES = window.FloodReport.GRADES;
  var IMPACTS = [
    { key: 'book', label: 'หนังสือเรียน', short: 'หนังสือ' },
    { key: 'supplies', label: 'อุปกรณ์การเรียน', short: 'อุปกรณ์' },
    { key: 'uniform', label: 'เครื่องแบบนักเรียน', short: 'เครื่องแบบ' }
  ];
  var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  var state = {
    roster: [],        // นักเรียนทั้งโรงเรียนจาก API รายชื่อ
    roomOrder: [],     // ลำดับห้องตาม API รายชื่อ
    rosterCount: {},   // จำนวนนักเรียนต่อห้อง
    rooms: {},         // ข้อมูลที่บันทึกแล้วรายห้อง (จาก Sheet)
    settings: {},      // ผอ. / ผู้รับผิดชอบ
    room: null,        // ห้องที่เลือก
    rows: [],          // แถวนักเรียนของห้องที่เลือก
    dirty: false,
    busy: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    roomGrid: $('roomGrid'), rows: $('rows'), noMatch: $('noMatch'),
    studentSection: $('studentSection'), signSection: $('signSection'), bottomBar: $('bottomBar'),
    filterText: $('filterText'), filterHit: $('filterHit'), toast: $('toast')
  };
  var settingFields = ['directorName', 'directorPhone', 'coordinatorName', 'coordinatorPhone'];

  // ---------------- utils ----------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isoOrToday(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : todayISO(); }
  function thaiDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    return (+m[3]) + ' ' + THAI_MONTHS[+m[2] - 1] + ' ' + (+m[1] + 543);
  }
  function thaiDateTime(s) {
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s || '');
    return m ? thaiDate(m[1]) + ' ' + m[2] + ' น.' : (s || '');
  }
  function cleanId(v) { return String(v == null ? '' : v).replace(/[\s-]/g, '').toUpperCase(); }
  function idFormatOk(id) { return /^(\d{13}|G\d{12})$/.test(id); }
  function idChecksumOk(id) {
    if (!/^\d{13}$/.test(id)) return true;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+id[i]) * (13 - i);
    return (11 - (sum % 11)) % 10 === +id[12];
  }
  // "อนุบาล2" -> "อ.2", "ป.1/2" -> "ป.1", "ประถมศึกษาปีที่ 3" -> "ป.3"
  function gradeOf(room) {
    var s = String(room || '').replace(/\/.*$/, '').replace(/\s+/g, '')
      .replace(/^อนุบาล(ปีที่)?/, 'อ.').replace(/^ประถม(ศึกษา)?(ปีที่)?/, 'ป.').replace(/^มัธยม(ศึกษา)?(ปีที่)?/, 'ม.');
    var m = /^(อ|ป|ม|ปวช)\.?(\d)$/.exec(s);
    var g = m ? m[1] + '.' + m[2] : '';
    return GRADES.indexOf(g) >= 0 ? g : '';
  }
  // ข้อความในคอลัมน์ "ชั้นเรียน" ของแบบ 1 (คงเลขห้องไว้ถ้ามี เช่น ป.1/2)
  function classLabel(room) {
    var g = gradeOf(room);
    var slash = String(room).indexOf('/');
    return g ? g + (slash >= 0 ? String(room).slice(slash) : '') : room;
  }
  function fullName(s) {
    var last = String(s.last_name || '').trim();
    return (String(s.prefix || '') + String(s.first_name || '')).trim() + (last && last !== '-' ? ' ' + last : '');
  }
  function fileSafe(s) { return String(s || '').replace(/[\\/:*?"<>|]/g, '-'); }

  var toastTimer;
  function toast(msg, kind) {
    var c = { ok: ['var(--ok-soft)', 'var(--ok)'], error: ['var(--danger-soft)', 'var(--danger)'], info: ['var(--accent-soft)', 'var(--accent)'] }[kind || 'info'];
    el.toast.style.background = c[0];
    el.toast.style.color = c[1];
    el.toast.style.border = '1px solid ' + c[1];
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, kind === 'error' ? 7000 : 4000);
  }

  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      var d = $('confirmDialog');
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmOk').textContent = okLabel || 'ยืนยัน';
      var done = function (v) {
        return function (e) {
          if (e) e.preventDefault();
          if (d.open) d.close();
          resolve(v);
        };
      };
      $('confirmOk').onclick = done(true);
      $('confirmCancel').onclick = done(false);
      d.oncancel = done(false);
      d.showModal();
      $('confirmOk').focus();
    });
  }

  function withBusy(btn, label, promise) {
    state.busy = true;
    var old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + esc(label);
    return promise.then(function (v) { return v; }, function (err) { throw err; })
      .finally(function () {
        state.busy = false;
        btn.innerHTML = old;
        btn.disabled = false;
        applyOfflineState();
      });
  }

  // ---------------- API ----------------
  // GET พร้อม timeout และลองใหม่อัตโนมัติ (Apps Script ตอบช้า/ต่อคิวเมื่อหลายคนเปิดพร้อมกัน)
  function getJSON(url, opts) {
    opts = opts || {};
    var tries = opts.tries || 3, timeout = opts.timeout || 30000;
    var attempt = function (n) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;
      return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
        if (!r.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับ ' + r.status);
        return r.json();
      }).then(function (j) {
        clearTimeout(timer);
        return j;
      }, function (err) {
        clearTimeout(timer);
        if (n + 1 >= tries) throw (err && err.name === 'AbortError') ? new Error('เซิร์ฟเวอร์ตอบช้าเกินไป') : err;
        if (opts.onRetry) opts.onRetry(n + 1);
        // รอแบบสุ่มเล็กน้อย กันทุกเครื่องยิงซ้ำพร้อมกัน
        return new Promise(function (res) { setTimeout(res, 1000 * (n + 1) + Math.random() * 1000); })
          .then(function () { return attempt(n + 1); });
      });
    };
    return attempt(0);
  }
  function apiGet(params, opts) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return getJSON(API_URL + (API_URL.indexOf('?') >= 0 ? '&' : '?') + q, opts).then(checkOk);
  }
  function apiPost(body) {
    // ส่งเป็น text/plain เพื่อไม่ให้เกิด CORS preflight กับ Apps Script
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
      if (!r.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับ ' + r.status);
      return r.json();
    }).then(checkOk);
  }
  function checkOk(j) {
    if (!j || !j.ok) throw new Error((j && j.error) || 'เกิดข้อผิดพลาด');
    return j;
  }

  // ---------------- cache ในเครื่อง (เปิดครั้งต่อไปแสดงห้องได้ทันที) ----------------
  var ROSTER_KEY = 'flood:roster:v1:' + STUDENT_API_URL;
  function readCache(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function writeCache(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* เต็มหรือถูกปิดไว้ ไม่เป็นไร */ }
  }

  // ---------------- โหลดเริ่มต้น ----------------
  function showBanner() {
    var msgs = [];
    if (!SCHOOL.code || !SCHOOL.name) msgs.push('ยังไม่ได้ตั้งรหัสและชื่อโรงเรียนใน assets/config.js (หัวกระดาษ Excel จะเป็นจุดไข่ปลา)');
    if (!API_URL) msgs.push('ยังไม่ได้เชื่อมต่อ Google Sheet (API_URL) จึงยังบันทึกข้อมูลไม่ได้ แต่ติ๊กและดาวน์โหลด Excel รายห้องได้');
    $('bannerText').textContent = msgs.join(' · ');
    $('banner').hidden = !msgs.length;
    $('schoolLine').textContent = SCHOOL.name
      ? SCHOOL.name + (SCHOOL.code ? ' · รหัส ' + SCHOOL.code : '')
      : 'สังกัด สำนักงานเขตพื้นที่การศึกษาประถมศึกษาสระบุรี เขต 2';
  }

  function applyOfflineState() {
    if (API_URL) return;
    ['saveRoom', 'saveSettings', 'downloadSchool', 'refreshStatus'].forEach(function (id) {
      $(id).disabled = true;
      $(id).title = 'ต้องตั้งค่า API_URL ก่อน';
    });
  }

  function loadingHtml(text) {
    return '<div class="flex items-center gap-2 text-muted"><span class="spin"></span>' + esc(text) + '</div>';
  }

  function setRoster(roster) {
    state.roster = roster;
    state.roomOrder = [];
    state.rosterCount = {};
    roster.forEach(function (s) {
      if (!state.rosterCount[s.room]) { state.rosterCount[s.room] = 0; state.roomOrder.push(s.room); }
      state.rosterCount[s.room]++;
    });
  }

  function loadRoster() {
    if (!STUDENT_API_URL) return Promise.reject(new Error('ยังไม่ได้ตั้ง STUDENT_API_URL ใน config.js'));
    var hadRoster = state.roster.length > 0;
    return getJSON(STUDENT_API_URL, {
      onRetry: function (n) {
        if (!state.roster.length) el.roomGrid.innerHTML = loadingHtml('เซิร์ฟเวอร์รายชื่อตอบช้า กำลังลองใหม่ (ครั้งที่ ' + n + ')…');
      }
    }).then(function (list) {
      if (!Array.isArray(list)) throw new Error('รูปแบบข้อมูลรายชื่อนักเรียนไม่ถูกต้อง');
      var roster = list.map(function (s) {
        var room = String(s.classroom || '').trim();
        return {
          room: room, no: Number(s.no) || 0, schoolId: String(s.student_id == null ? '' : s.student_id),
          citizenId: cleanId(s.citizen_id), name: fullName(s)
        };
      }).filter(function (s) { return s.room; });
      var changed = JSON.stringify(roster) !== JSON.stringify(state.roster);
      writeCache(ROSTER_KEY, { savedAt: Date.now(), roster: roster });
      state.rosterLoaded = true;
      if (changed || !roster.length) {
        setRoster(roster);
        renderRoomGrid();
        renderStatus();
        if (hadRoster && state.room) $('roomMeta').textContent = (state.rosterCount[state.room] || 0) + ' คนในรายชื่อ';
      }
    });
  }

  function loadRooms() {
    if (!API_URL) { state.roomsLoaded = true; return Promise.resolve(); }
    return apiGet({ action: 'rooms' }).then(function (res) {
      state.rooms = {};
      (res.rooms || []).forEach(function (r) { state.rooms[r.room] = r; });
      state.settings = res.settings || {};
      state.roomsLoaded = true;
      fillSettings();
      renderRoomGrid();
      renderStatus();
    });
  }

  function allRooms() {
    var list = state.roomOrder.slice();
    Object.keys(state.rooms).forEach(function (r) { if (list.indexOf(r) < 0) list.push(r); });
    return list;
  }

  function showRosterError(err) {
    el.roomGrid.innerHTML = '<div class="flex flex-wrap items-center gap-3 text-danger">โหลดรายชื่อนักเรียนไม่สำเร็จ (' + esc(err.message) + ')' +
      '<button type="button" class="btn btn-ghost btn-sm" id="retryRoster">ลองอีกครั้ง</button></div>';
    $('retryRoster').addEventListener('click', function () {
      el.roomGrid.innerHTML = loadingHtml('กำลังโหลดรายชื่อนักเรียน…');
      loadRoster().catch(showRosterError);
    });
  }

  function start() {
    showBanner();
    applyOfflineState();
    $('schoolDate').value = todayISO();
    // 1) ใช้รายชื่อที่จำไว้ในเครื่องก่อน (ถ้ามี) ห้องจะขึ้นทันที
    var cached = readCache(ROSTER_KEY);
    if (cached && Array.isArray(cached.roster) && cached.roster.length) {
      setRoster(cached.roster);
      renderRoomGrid();
    } else {
      el.roomGrid.innerHTML = loadingHtml('กำลังโหลดรายชื่อนักเรียน…');
    }
    // 2) โหลดรายชื่อล่าสุดและสถานะการส่งแยกกัน ไม่ต้องรอกัน
    loadRoster().catch(function (err) {
      if (!state.roster.length) showRosterError(err);
    });
    loadRooms().catch(function (err) {
      $('statusCount').textContent = '';
      state.roomsFailed = true;
      renderRoomGrid();
      toast('โหลดสถานะการส่งไม่สำเร็จ: ' + err.message + ' (กด "โหลดใหม่" ในหน้าสรุปได้)', 'error');
    });
  }

  // ---------------- เลือกห้อง ----------------
  function roomStatusHtml(room) {
    var r = state.rooms[room];
    if (r) return '<span class="rs text-ok">✓ ส่งแล้ว · ' + r.count + ' คน</span>';
    if (!state.roomsLoaded) return '<span class="rs text-muted">' + (state.roomsFailed ? '–' : 'กำลังตรวจสถานะ…') + '</span>';
    return '<span class="rs text-muted">ยังไม่ส่ง</span>';
  }

  function renderRoomGrid() {
    if (!state.roster.length && !state.rosterLoaded) return; // ยังรอรายชื่อ (คงข้อความกำลังโหลดไว้)
    var rooms = allRooms();
    if (!rooms.length) {
      el.roomGrid.innerHTML = '<p class="text-muted">ไม่พบห้องเรียนในรายชื่อนักเรียน</p>';
      return;
    }
    el.roomGrid.innerHTML = rooms.map(function (room) {
      var n = state.rosterCount[room] || 0;
      return '<button type="button" class="room-btn" data-room="' + esc(room) + '" aria-pressed="' + (room === state.room) + '">' +
        '<span class="rn">' + esc(room) + '</span>' +
        '<span class="rs text-muted">' + (n ? n + ' คน' : 'ไม่อยู่ในรายชื่อ') + '</span>' +
        roomStatusHtml(room) + '</button>';
    }).join('');
  }

  el.roomGrid.addEventListener('click', function (e) {
    var b = e.target.closest('[data-room]');
    if (b) chooseRoom(b.dataset.room);
  });

  function hitRows() { return state.rows.filter(isHit); }
  function isHit(r) { return r.book || r.supplies || r.uniform; }

  function chooseRoom(room) {
    if (room === state.room && !state.roomUnverified) return;
    var go = function () {
      state.room = room;
      state.dirty = false;
      renderRoomGrid();
      el.studentSection.hidden = false;
      el.signSection.hidden = false;
      el.bottomBar.hidden = false;
      $('roomTitle').textContent = room;
      $('roomTitle2').textContent = room;
      $('barRoom').textContent = room;
      $('roomMeta').textContent = (state.rosterCount[room] || 0) + ' คนในรายชื่อ';
      el.filterText.value = '';
      el.filterHit.checked = false;
      var meta = state.rooms[room] || {};
      $('teacherName').value = meta.teacherName || '';
      $('teacherPhone').value = meta.teacherPhone || '';
      $('reportDate').value = isoOrToday(meta.reportDate);
      state.rows = rosterRows(room);
      // ถ้ายังไม่รู้สถานะการส่ง ต้องโหลดข้อมูลห้องก่อนเสมอ กันบันทึกทับของเดิมโดยไม่ตั้งใจ
      if (API_URL && (state.rooms[room] || !state.roomsLoaded)) {
        el.rows.innerHTML = '<div class="flex items-center gap-2 px-4 py-8 text-muted"><span class="spin"></span>กำลังโหลดข้อมูลที่บันทึกไว้…</div>';
        updateSummary();
        state.roomUnverified = false;
        apiGet({ action: 'room', room: room }, {
          onRetry: function (n) {
            if (state.room === room) el.rows.innerHTML = '<div class="flex items-center gap-2 px-4 py-8 text-muted"><span class="spin"></span>เซิร์ฟเวอร์ตอบช้า กำลังลองใหม่ (ครั้งที่ ' + n + ')…</div>';
          }
        }).then(function (res) {
          if (state.room !== room) return;
          mergeSaved(res.students || []);
          if (res.room) {
            state.rooms[room] = res.room;
            if (!$('teacherName').value) $('teacherName').value = res.room.teacherName || '';
            if (!$('teacherPhone').value) $('teacherPhone').value = res.room.teacherPhone || '';
            if (res.room.reportDate) $('reportDate').value = isoOrToday(res.room.reportDate);
            renderRoomGrid();
          }
          if (res.settings) { state.settings = res.settings; fillSettings(); }
          renderRows();
        }).catch(function (err) {
          if (state.room !== room) return;
          state.roomUnverified = true;
          renderRows();
          toast('โหลดข้อมูลที่บันทึกไว้ไม่สำเร็จ: ' + err.message + ' — ลองเลือกห้องใหม่อีกครั้ง', 'error');
        });
      } else {
        state.roomUnverified = false;
        renderRows();
      }
      var chip = el.roomGrid.querySelector('[aria-pressed="true"]');
      if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center' });
      el.signSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (state.dirty) {
      confirmBox('เปลี่ยนห้อง?', 'การติ๊กในห้อง ' + state.room + ' ที่ยังไม่บันทึกจะหายไป', 'เปลี่ยนห้อง').then(function (ok) { if (ok) go(); });
    } else go();
  }

  function rosterRows(room) {
    return state.roster.filter(function (s) { return s.room === room; })
      .sort(function (a, b) { return a.no - b.no; })
      .map(function (s) {
        return {
          no: s.no, schoolId: s.schoolId, citizenId: s.citizenId, rosterId: s.citizenId, name: s.name,
          manual: false, idEditable: !idFormatOk(s.citizenId),
          book: false, supplies: false, uniform: false, note: ''
        };
      });
  }

  function mergeSaved(saved) {
    saved.forEach(function (s) {
      var match = null;
      if (!s.manual) {
        match = state.rows.filter(function (r) {
          return !r.manual && ((s.schoolId && r.schoolId === s.schoolId) || (!s.schoolId && r.rosterId === s.citizenId));
        })[0];
      }
      if (match) {
        match.book = s.book; match.supplies = s.supplies; match.uniform = s.uniform; match.note = s.note;
        if (s.citizenId && s.citizenId !== match.citizenId) { match.citizenId = s.citizenId; match.idEditable = true; }
      } else {
        // นักเรียนที่เพิ่มเอง หรือไม่อยู่ในรายชื่อปัจจุบันแล้ว
        state.rows.push({
          no: 0, schoolId: s.schoolId || '', citizenId: s.citizenId, rosterId: '', name: s.name,
          manual: true, idEditable: true, book: s.book, supplies: s.supplies, uniform: s.uniform, note: s.note
        });
      }
    });
  }

  // ---------------- ตารางนักเรียน ----------------
  var TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

  function rowHtml(r, i) {
    var label = r.name || ('รายการที่ ' + (i + 1));
    // ไม่แสดงเลขประจำตัว ยกเว้นคนที่ต้องกรอก/แก้ (เพิ่มเอง หรือเลขในระบบไม่ครบ 13 หลัก)
    var idCell = r.idEditable
      ? '<label class="idbox"><span class="idlbl">เลขประจำตัว 13 หลัก' + (r.manual ? '' : ' (ในระบบไม่ครบ กรุณาแก้)') + '</span>' +
        '<input class="field mono num" data-f="citizenId" inputmode="numeric" maxlength="17" value="' + esc(r.citizenId) + '" placeholder="13 หลัก" aria-label="เลขประจำตัวของ ' + esc(label) + '"></label>'
      : '';
    var nameCell = r.manual
      ? '<input class="field" data-f="name" value="' + esc(r.name) + '" placeholder="คำนำหน้า ชื่อ สกุล" aria-label="ชื่อ - สกุล รายการที่ ' + (i + 1) + '">'
      : '<span class="txt">' + esc(r.name) + '</span>';
    // ปุ่มกดแบบ pill (checkbox จริงซ่อนไว้ข้างใน) กดง่ายบนมือถือ
    var pills = IMPACTS.map(function (imp) {
      return '<label class="pill"><input type="checkbox" class="sr-only" data-f="' + imp.key + '"' + (r[imp.key] ? ' checked' : '') +
        ' aria-label="' + imp.label + ' ของ ' + esc(label) + '"><span>' + imp.short + '</span></label>';
    }).join('');
    var tag = r.manual ? '<span class="tag bg-accent-soft text-accent">เพิ่มเอง</span>' : '';
    var acts = '<span class="row-acts">' +
      '<button type="button" class="note-btn" data-note="' + i + '">+ หมายเหตุ</button>' +
      (r.manual ? '<button type="button" class="icon-btn del" data-del="' + i + '" aria-label="ลบ ' + esc(label) + '" title="ลบแถวนี้">' + TRASH + '</button>' : '') +
      '</span>';
    return '<div class="st-row' + (isHit(r) ? ' hit' : '') + (r.note ? ' note-open' : '') + '" data-i="' + i + '">' +
      '<div class="nm"><span class="no num">' + (r.no || '+') + '</span>' + nameCell + tag + acts + idCell + '</div>' +
      '<div class="pills" role="group" aria-label="ผลกระทบของ ' + esc(label) + '">' + pills + '</div>' +
      '<div class="nt"><input class="field" data-f="note" value="' + esc(r.note) + '" placeholder="หมายเหตุ" aria-label="หมายเหตุของ ' + esc(label) + '"></div>' +
      '<div class="row-msg" hidden></div>' +
      '</div>';
  }

  function renderRows() {
    el.rows.innerHTML = state.rows.map(rowHtml).join('');
    applyFilter();
    updateSummary();
  }

  function applyFilter() {
    var q = el.filterText.value.trim().toLowerCase();
    var onlyHit = el.filterHit.checked;
    var shown = 0;
    Array.prototype.forEach.call(el.rows.children, function (row) {
      var r = state.rows[+row.dataset.i];
      var ok = (!onlyHit || isHit(r) || (r.manual && !r.name && !r.citizenId)) &&
        (!q || r.name.toLowerCase().indexOf(q) >= 0 || String(r.no) === q);
      row.hidden = !ok;
      if (ok) shown++;
    });
    el.noMatch.hidden = shown > 0 || !state.rows.length;
    if (!state.rows.length) {
      el.noMatch.hidden = false;
      el.noMatch.textContent = 'ห้องนี้ไม่มีรายชื่อในระบบ กด "+ เพิ่มนักเรียนที่ไม่อยู่ในรายชื่อ"';
    } else {
      el.noMatch.textContent = 'ไม่พบนักเรียนที่ตรงกับเงื่อนไข';
    }
  }
  el.filterText.addEventListener('input', applyFilter);
  el.filterHit.addEventListener('change', applyFilter);

  function updateSummary() {
    var hits = hitRows();
    $('sumAll').textContent = hits.length;
    $('hitCount').textContent = hits.length;
    IMPACTS.forEach(function (imp) {
      $('sum' + imp.key.charAt(0).toUpperCase() + imp.key.slice(1)).textContent = hits.filter(function (r) { return r[imp.key]; }).length;
    });
  }

  function rowProblems(r, dupIds) {
    var errors = [], warns = [], fields = {};
    var id = cleanId(r.citizenId);
    var relevant = isHit(r) || (r.manual && (r.name || id || r.note));
    if (!relevant) return { errors: errors, warns: warns, fields: fields };
    if (!id) { errors.push('กรอกเลขประจำตัว'); fields.citizenId = 1; }
    else if (dupIds[id] > 1) { errors.push('เลขประจำตัวซ้ำกับคนอื่น'); fields.citizenId = 1; }
    else if (!idFormatOk(id)) warns.push('เลขประจำตัวไม่ครบ 13 หลัก (บันทึกได้ แต่ควรแก้ให้ถูกต้อง)');
    else if (r.manual && !idChecksumOk(id)) warns.push('เลขประจำตัวอาจพิมพ์ผิด ตรวจสอบอีกครั้ง');
    if (r.manual && !String(r.name || '').trim()) { errors.push('กรอกชื่อ - สกุล'); fields.name = 1; }
    if (!isHit(r)) errors.push('ติ๊กผลกระทบอย่างน้อย 1 ช่อง');
    return { errors: errors, warns: warns, fields: fields };
  }

  function dupCounts() {
    var c = {};
    state.rows.forEach(function (r) {
      if (!isHit(r) && !r.manual) return;
      var id = cleanId(r.citizenId);
      if (id) c[id] = (c[id] || 0) + 1;
    });
    return c;
  }

  function showRowProblems(i, p) {
    var row = el.rows.querySelector('.st-row[data-i="' + i + '"]');
    if (!row) return;
    ['citizenId', 'name'].forEach(function (f) {
      var inp = row.querySelector('[data-f="' + f + '"]');
      if (inp) inp.setAttribute('aria-invalid', p.fields[f] ? 'true' : 'false');
    });
    var msg = row.querySelector('.row-msg');
    if (p.errors.length) {
      msg.innerHTML = '<span class="text-danger">' + esc(p.errors.join(' · ')) + '</span>';
      msg.hidden = false;
    } else if (p.warns.length) {
      msg.innerHTML = '<span class="text-warn">' + esc(p.warns.join(' · ')) + '</span>';
      msg.hidden = false;
    } else {
      msg.hidden = true;
    }
  }

  function validateAll() {
    var dups = dupCounts(), bad = 0, firstBad = -1;
    state.rows.forEach(function (r, i) {
      var p = rowProblems(r, dups);
      showRowProblems(i, p);
      if (p.errors.length) { bad++; if (firstBad < 0) firstBad = i; }
    });
    return { bad: bad, firstBad: firstBad };
  }

  el.rows.addEventListener('input', function (e) {
    var f = e.target.dataset.f;
    var row = e.target.closest('.st-row');
    if (!f || !row) return;
    var i = +row.dataset.i;
    var r = state.rows[i];
    r[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'citizenId') r.citizenId = e.target.value.trim();
    row.classList.toggle('hit', isHit(r));
    state.dirty = true;
    updateSummary();
    var msg = row.querySelector('.row-msg');
    if (!msg.hidden) showRowProblems(i, rowProblems(r, dupCounts()));
  });
  el.rows.addEventListener('focusout', function (e) {
    if (e.target.dataset.f !== 'citizenId') return;
    var i = +e.target.closest('.st-row').dataset.i;
    var r = state.rows[i];
    if (r.citizenId) showRowProblems(i, rowProblems(r, dupCounts()));
  });
  el.rows.addEventListener('click', function (e) {
    var noteBtn = e.target.closest('[data-note]');
    if (noteBtn) {
      var row = noteBtn.closest('.st-row');
      row.classList.add('note-open');
      row.querySelector('[data-f="note"]').focus();
      return;
    }
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var i = +btn.dataset.del;
    var r = state.rows[i];
    var remove = function () { state.rows.splice(i, 1); state.dirty = true; renderRows(); };
    if (r.name || r.citizenId) {
      confirmBox('ลบรายการนี้?', (r.name || 'นักเรียนคนนี้') + ' จะถูกลบออกจากรายการของห้องนี้', 'ลบ').then(function (ok) { if (ok) remove(); });
    } else remove();
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-all]'), function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.dataset.all;
      var visible = Array.prototype.filter.call(el.rows.children, function (row) { return !row.hidden; })
        .map(function (row) { return state.rows[+row.dataset.i]; });
      if (!visible.length) return;
      var allOn = visible.every(function (r) { return r[key]; });
      visible.forEach(function (r) { r[key] = !allOn; });
      state.dirty = true;
      renderRows();
      var label = btn.textContent.trim();
      toast((allOn ? 'เอาติ๊ก "' : 'ติ๊ก "') + label + '" ' + visible.length + ' คนแล้ว', 'info');
    });
  });

  $('addManual').addEventListener('click', function () {
    state.rows.push({ no: 0, schoolId: '', citizenId: '', rosterId: '', name: '', manual: true, idEditable: true, book: false, supplies: false, uniform: false, note: '' });
    el.filterHit.checked = false;
    el.filterText.value = '';
    renderRows();
    var last = el.rows.lastElementChild;
    var inp = last && last.querySelector('[data-f="citizenId"]');
    if (inp) inp.focus();
  });

  ['teacherName', 'teacherPhone', 'reportDate'].forEach(function (id) {
    $(id).addEventListener('input', function () { state.dirty = true; });
  });

  // ---------------- บันทึก / ดาวน์โหลด รายห้อง ----------------
  function roomPayload() {
    return {
      room: state.room,
      grade: gradeOf(state.room),
      teacherName: $('teacherName').value.trim(),
      teacherPhone: $('teacherPhone').value.trim(),
      reportDate: $('reportDate').value,
      students: state.rows.filter(function (r) { return isHit(r); }).map(function (r) {
        return {
          no: r.no || '', schoolId: r.schoolId, citizenId: cleanId(r.citizenId), name: String(r.name || '').trim(),
          book: !!r.book, supplies: !!r.supplies, uniform: !!r.uniform, note: String(r.note || '').trim(), manual: r.manual
        };
      })
    };
  }

  function checkRoom() {
    if (!state.room) { toast('เลือกห้องเรียนก่อน', 'error'); return false; }
    var v = validateAll();
    if (v.bad) {
      toast('มี ' + v.bad + ' รายการที่ต้องแก้ไข (ดูข้อความสีแดงใต้แถว)', 'error');
      el.filterHit.checked = false;
      el.filterText.value = '';
      applyFilter();
      var row = el.rows.querySelector('.st-row[data-i="' + v.firstBad + '"]');
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return false;
    }
    return true;
  }

  $('saveRoom').addEventListener('click', function () {
    if (state.busy || !API_URL || !checkRoom()) return;
    var data = roomPayload();
    var run = function () {
      withBusy($('saveRoom'), 'กำลังบันทึก…', apiPost({ action: 'save', data: data })).then(function (res) {
        state.dirty = false;
        state.rooms[data.room] = res.room;
        state.roomUnverified = false;
        renderRoomGrid();
        renderStatus();
        toast('บันทึกห้อง ' + data.room + ' แล้ว (' + res.count + ' คน)', 'ok');
      }).catch(function (err) {
        toast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
      });
    };
    if (state.roomUnverified) {
      confirmBox('ยังโหลดข้อมูลเดิมของห้องนี้ไม่ได้', 'ถ้าห้อง ' + data.room + ' เคยบันทึกไว้แล้ว การบันทึกตอนนี้จะเขียนทับข้อมูลเดิม แนะนำให้กดเลือกห้องใหม่อีกครั้งก่อน', 'บันทึกทับ').then(function (ok) { if (ok) run(); });
    } else if (!data.students.length) {
      confirmBox('ไม่มีนักเรียนได้รับผลกระทบ?', 'ยังไม่ได้ติ๊กใครเลย ถ้ากดบันทึก ระบบจะรายงานว่าห้อง ' + data.room + ' ไม่มีนักเรียนได้รับผลกระทบ', 'บันทึกว่าไม่มี').then(function (ok) { if (ok) run(); });
    } else if (!data.teacherName) {
      confirmBox('ยังไม่ได้กรอกชื่อครูผู้รายงาน', 'บันทึกต่อได้ แต่ช่องผู้รายงานในไฟล์ Excel จะเป็นจุดไข่ปลา', 'บันทึกต่อ').then(function (ok) { if (ok) run(); });
    } else run();
  });

  function toReportStudents(list) {
    return list.map(function (s) {
      return {
        studentId: s.citizenId, name: s.name, grade: gradeOf(s.room),
        classLabel: classLabel(s.room), book: s.book, supplies: s.supplies, uniform: s.uniform, note: s.note
      };
    });
  }

  var templateCache = null;
  function buildAndDownload(data, filename) {
    return (templateCache ? Promise.resolve(templateCache) : fetch('template.xlsx').then(function (r) {
      if (!r.ok) throw new Error('ไม่พบไฟล์ template.xlsx');
      return r.arrayBuffer();
    })).then(function (buf) {
      templateCache = buf;
      return window.FloodReport.build(JSZip, buf, data, 'blob');
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  }

  $('downloadRoom').addEventListener('click', function () {
    if (state.busy || !checkRoom()) return;
    var p = roomPayload();
    var data = {
      schoolCode: SCHOOL.code, schoolName: SCHOOL.name,
      teacherName: p.teacherName, teacherPhone: p.teacherPhone,
      directorName: state.settings.directorName || '', directorPhone: state.settings.directorPhone || '',
      reportDateText: thaiDate(p.reportDate),
      students: toReportStudents(p.students.map(function (s) { s.room = p.room; return s; }))
    };
    withBusy($('downloadRoom'), 'กำลังสร้างไฟล์…',
      buildAndDownload(data, 'แบบรายงานอุทกภัย_' + fileSafe(p.room) + (SCHOOL.name ? '_' + fileSafe(SCHOOL.name) : '') + '.xlsx'))
      .then(function () {
        if (state.dirty && API_URL) toast('ดาวน์โหลดแล้ว อย่าลืมกด "บันทึกห้องนี้" ด้วย', 'info');
      }).catch(function (err) { toast('สร้างไฟล์ไม่สำเร็จ: ' + err.message, 'error'); });
  });

  // ---------------- สรุปทั้งโรงเรียน ----------------
  function fillSettings() {
    settingFields.forEach(function (k) {
      if (document.activeElement !== $(k)) $(k).value = state.settings[k] || '';
    });
    $('schoolDate').value = isoOrToday(state.settings.reportDate);
  }

  function settingsFromForm() {
    var o = {};
    settingFields.forEach(function (k) { o[k] = $(k).value.trim(); });
    o.reportDate = $('schoolDate').value;
    return o;
  }

  function settingsChanged() {
    var f = settingsFromForm();
    return Object.keys(f).some(function (k) { return (state.settings[k] || '') !== f[k]; });
  }

  function renderStatus() {
    var rooms = allRooms();
    var sent = rooms.filter(function (r) { return state.rooms[r]; }).length;
    $('statusCount').textContent = API_URL ? 'ส่งแล้ว ' + sent + ' จาก ' + rooms.length + ' ห้อง' : '';
    var tot = { count: 0, book: 0, supplies: 0, uniform: 0 };
    var td = function (v, cls) { return '<td class="px-3 py-2 ' + (cls || '') + '">' + v + '</td>'; };
    var body = rooms.map(function (room) {
      var r = state.rooms[room];
      if (r) { tot.count += r.count; tot.book += r.book; tot.supplies += r.supplies; tot.uniform += r.uniform; }
      return '<tr class="border-b border-line">' +
        td('<button type="button" class="font-display font-semibold text-accent underline-offset-2 hover:underline" data-goto="' + esc(room) + '">' + esc(room) + '</button>') +
        td(r ? '<span class="tag bg-ok-soft text-ok">ส่งแล้ว</span>' : '<span class="tag bg-warn-soft text-warn">ยังไม่ส่ง</span>') +
        td(r ? esc(r.teacherName || '–') : '–') +
        td(r ? r.count : '–', 'text-right') + td(r ? r.book : '–', 'text-right') +
        td(r ? r.supplies : '–', 'text-right') + td(r ? r.uniform : '–', 'text-right') +
        td(r ? esc(thaiDateTime(r.updatedAt)) : '–', 'text-muted') + '</tr>';
    }).join('');
    $('statusBody').innerHTML = (body || '<tr><td colspan="8" class="px-3 py-6 text-center text-muted">ยังไม่มีข้อมูลห้องเรียน</td></tr>') +
      '<tr class="bg-paper font-semibold text-paper-ink">' + td('รวมทั้งสิ้น') + td('') + td('') +
      td(tot.count, 'text-right') + td(tot.book, 'text-right') + td(tot.supplies, 'text-right') + td(tot.uniform, 'text-right') + td('') + '</tr>';
  }

  $('statusBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-goto]');
    if (!b) return;
    showView('room');
    chooseRoom(b.dataset.goto);
  });

  $('refreshStatus').addEventListener('click', function () {
    if (state.busy) return;
    withBusy($('refreshStatus'), 'กำลังโหลด…', loadRooms()).then(function () {
      renderStatus();
      renderRoomGrid();
    }).catch(function (err) { toast('โหลดไม่สำเร็จ: ' + err.message, 'error'); });
  });

  function saveSettings() {
    return apiPost({ action: 'saveSettings', data: settingsFromForm() }).then(function (res) {
      state.settings = res.settings || state.settings;
    });
  }

  $('saveSettings').addEventListener('click', function () {
    if (state.busy || !API_URL) return;
    withBusy($('saveSettings'), 'กำลังบันทึก…', saveSettings()).then(function () {
      toast('บันทึกข้อมูลผู้ลงนามแล้ว', 'ok');
    }).catch(function (err) { toast('บันทึกไม่สำเร็จ: ' + err.message, 'error'); });
  });

  $('downloadSchool').addEventListener('click', function () {
    if (state.busy || !API_URL) return;
    var form = settingsFromForm();
    var job = (settingsChanged() ? saveSettings() : Promise.resolve()).then(function () {
      return apiGet({ action: 'all' });
    }).then(function (res) {
      (res.rooms || []).forEach(function (r) { state.rooms[r.room] = r; });
      renderStatus();
      var order = allRooms();
      var list = (res.students || []).slice().sort(function (a, b) {
        var ra = order.indexOf(a.room), rb = order.indexOf(b.room);
        if (ra !== rb) return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
        return (a.no || 9999) - (b.no || 9999);
      });
      var data = {
        schoolCode: SCHOOL.code, schoolName: SCHOOL.name,
        teacherName: form.coordinatorName, teacherPhone: form.coordinatorPhone,
        directorName: form.directorName, directorPhone: form.directorPhone,
        reportDateText: thaiDate(form.reportDate),
        students: toReportStudents(list)
      };
      return buildAndDownload(data, 'แบบรายงานอุทกภัย_ทั้งโรงเรียน' + (SCHOOL.name ? '_' + fileSafe(SCHOOL.name) : '') + '.xlsx')
        .then(function () { return list.length; });
    });
    withBusy($('downloadSchool'), 'กำลังสร้างไฟล์…', job).then(function (n) {
      var missing = allRooms().filter(function (r) { return !state.rooms[r]; }).length;
      toast('ดาวน์โหลดแล้ว รวม ' + n + ' คน' + (missing ? ' (ยังมี ' + missing + ' ห้องที่ไม่ได้ส่ง)' : ''), missing ? 'info' : 'ok');
    }).catch(function (err) { toast('สร้างไฟล์ไม่สำเร็จ: ' + err.message, 'error'); });
  });

  // ---------------- แท็บ ----------------
  function showView(name) {
    var room = name !== 'summary';
    $('viewRoom').hidden = !room;
    $('viewSummary').hidden = room;
    $('tabRoom').setAttribute('aria-selected', room);
    $('tabSummary').setAttribute('aria-selected', !room);
    el.bottomBar.hidden = !room || !state.room;
    if (!room) renderStatus();
    try { history.replaceState(null, '', room ? location.pathname + location.search : '#summary'); } catch (e) { /* ignore */ }
  }
  $('tabRoom').addEventListener('click', function () { showView('room'); });
  $('tabSummary').addEventListener('click', function () { showView('summary'); });

  // เงาใต้แถบค้นหาเมื่อถูกตรึงอยู่ด้านบน
  var tools = $('tools');
  window.addEventListener('scroll', function () {
    if (!el.studentSection.hidden) tools.classList.toggle('stuck', tools.getBoundingClientRect().top <= 1);
  }, { passive: true });

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------------- start ----------------
  start();
  if (location.hash === '#summary') showView('summary');
})();
