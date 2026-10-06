/*
 * สร้างไฟล์รายงาน Excel จาก template.xlsx (ไฟล์ต้นฉบับ)
 * เติมข้อมูลลง XML ภายในไฟล์โดยตรง เพื่อให้รูปแบบ ฟอนต์ เส้นตาราง และกล่องลงชื่อ เหมือนต้นฉบับทุกประการ
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.FloodReport) และ Node.js (module.exports) — ต้องมี JSZip
 */
(function (root) {
  'use strict';

  var GRADES = ['อ.1', 'อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6',
    'ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6', 'ปวช.1', 'ปวช.2', 'ปวช.3'];

  // ตำแหน่งในแม่แบบ
  var S1 = 'xl/worksheets/sheet1.xml';   // แบบ 1 รายชื่อนักเรียน
  var S2 = 'xl/worksheets/sheet2.xml';   // แบบ 2 สรุปรายชั้น
  var D1 = 'xl/drawings/drawing1.xml';
  var D2 = 'xl/drawings/drawing2.xml';
  var WB = 'xl/workbook.xml';
  var SS = 'xl/sharedStrings.xml';
  var S1_FIRST = 9, S1_LAST = 20;        // แถวข้อมูลนักเรียนในแม่แบบ (12 แถว)
  var S1_TEMPLATE_ROWS = S1_LAST - S1_FIRST + 1;
  var S2_FIRST = 10, S2_TOTAL = 28;      // แถว อ.1 และแถวรวมทั้งสิ้น

  // style index จาก styles.xml ของแม่แบบ
  var ST = { center: 5, id13: 6, text: 7, indent: 8 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function unesc(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function strCell(ref, s, text) {
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(text) + '</t></is></c>';
  }
  function numCell(ref, s, n) { return '<c r="' + ref + '" s="' + s + '"><v>' + n + '</v></c>'; }
  function blankCell(ref, s) { return '<c r="' + ref + '" s="' + s + '"/>'; }
  function sumCell(ref, s, range, value) {
    return '<c r="' + ref + '" s="' + s + '"><f>SUM(' + range + ')</f><v>' + value + '</v></c>';
  }

  // หา cell เดิมตาม ref คืนค่า {match, style}
  function cellRegex(ref) { return new RegExp('<c r="' + ref + '"(?: [^>]*?)?(?:/>|>[\\s\\S]*?</c>)'); }
  function cellStyle(xml, ref) {
    var m = xml.match(cellRegex(ref));
    var s = m && m[0].match(/ s="(\d+)"/);
    return s ? s[1] : '0';
  }
  function replaceCell(xml, ref, build) {
    var re = cellRegex(ref);
    if (!re.test(xml)) throw new Error('ไม่พบเซลล์ ' + ref + ' ในแม่แบบ');
    return xml.replace(re, function (m) {
      var s = (m.match(/ s="(\d+)"/) || [])[1] || '0';
      return build(s);
    });
  }

  function sharedStrings(xml) {
    return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
      return unesc((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) {
        return t.replace(/<t[^>]*>|<\/t>/g, '');
      }).join(''));
    });
  }
  function cellText(xml, ref, strings) {
    var m = xml.match(cellRegex(ref));
    if (!m) return '';
    var v = (m[0].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    return / t="s"/.test(m[0]) ? strings[+v] : unesc(v || '');
  }

  // แทนจุดไข่ปลาตัวที่ 1 ด้วยรหัส และตัวที่ 2 ด้วยชื่อโรงเรียน (คงข้อความสังกัดตามแม่แบบ)
  function schoolLine(template, code, name) {
    var i = 0;
    return template.replace(/\.{3,}/g, function (dots) {
      i++;
      if (i === 1) return code ? ' ' + code + '  ' : dots;
      if (i === 2) return name ? ' ' + name + '  ' : dots;
      return dots;
    });
  }

  function isDigits13(id) { return /^\d{13}$/.test(id); }

  function countByGrade(students) {
    var rows = {};
    GRADES.forEach(function (g) { rows[g] = { book: 0, supplies: 0, uniform: 0 }; });
    students.forEach(function (st) {
      var r = rows[st.grade];
      if (!r) return;
      if (st.book) r.book++;
      if (st.supplies) r.supplies++;
      if (st.uniform) r.uniform++;
    });
    return rows;
  }

  // ---------- แบบ 1 ----------
  function studentRow(r, i, st) {
    var cells = [numCell('A' + r, ST.center, i + 1)];
    var id = String(st.studentId || '').trim();
    if (isDigits13(id)) cells.push(numCell('B' + r, ST.id13, id));
    else if (id) cells.push(strCell('B' + r, ST.center, id));
    else cells.push(blankCell('B' + r, ST.id13));
    cells.push(st.name ? strCell('C' + r, ST.indent, st.name) : blankCell('C' + r, ST.indent));
    var cls = st.classLabel || st.grade;
    cells.push(cls ? strCell('D' + r, ST.center, cls) : blankCell('D' + r, ST.center));
    ['book', 'supplies', 'uniform'].forEach(function (k, j) {
      var ref = 'EFG'[j] + r;
      cells.push(st[k] ? numCell(ref, ST.center, 1) : blankCell(ref, ST.center));
    });
    cells.push(st.note ? strCell('H' + r, ST.text, st.note) : blankCell('H' + r, ST.text));
    return '<row r="' + r + '" spans="1:8">' + cells.join('') + '</row>';
  }
  function emptyStudentRow(r) {
    return '<row r="' + r + '" spans="1:8">' + blankCell('A' + r, ST.center) + blankCell('B' + r, ST.id13) +
      blankCell('C' + r, ST.indent) + blankCell('D' + r, ST.center) + blankCell('E' + r, ST.center) +
      blankCell('F' + r, ST.center) + blankCell('G' + r, ST.center) + blankCell('H' + r, ST.text) + '</row>';
  }

  function shiftRefs(rowXml, offset) {
    return rowXml.replace(/<c r="([A-Z]+)(\d+)"/g, function (_, col, n) {
      return '<c r="' + col + (+n + offset) + '"';
    });
  }

  function buildSheet1(xml, data, strings) {
    var students = data.students || [];
    var total = Math.max(S1_TEMPLATE_ROWS, students.length);
    var offset = total - S1_TEMPLATE_ROWS;

    var header = schoolLine(cellText(xml, 'A5', strings), data.schoolCode, data.schoolName);
    xml = replaceCell(xml, 'A5', function (s) { return strCell('A5', s, header); });

    var inserted = false;
    xml = xml.replace(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, function (row, n) {
      n = +n;
      if (n >= S1_FIRST && n <= S1_LAST) {
        if (inserted) return '';
        inserted = true;
        var out = [];
        for (var i = 0; i < total; i++) {
          out.push(i < students.length ? studentRow(S1_FIRST + i, i, students[i]) : emptyStudentRow(S1_FIRST + i));
        }
        return out.join('');
      }
      if (n > S1_LAST && offset) {
        return shiftRefs(row.replace(/^<row r="\d+"/, '<row r="' + (n + offset) + '"'), offset);
      }
      return row;
    });

    xml = xml.replace(/<dimension ref="A1:H(\d+)"\/>/, function (_, n) {
      return '<dimension ref="A1:H' + (+n + offset) + '"/>';
    });
    var breaks = pageBreaks(students.length);
    if (breaks.length) {
      xml = xml.replace('<drawing ', '<rowBreaks count="' + breaks.length + '" manualBreakCount="' + breaks.length + '">' +
        breaks.map(function (r) { return '<brk id="' + r + '" max="16383" man="1"/>'; }).join('') + '</rowBreaks><drawing ');
    }
    return { xml: xml, offset: offset };
  }

  // แบ่งหน้าเองเมื่อนักเรียนเกิน 12 คน ให้หน้าสุดท้ายมีที่พอสำหรับกล่องลงชื่อ (ไม่ถูกตัดกลางกล่อง)
  // คืนค่าเลขแถวสุดท้ายของแต่ละหน้า (ก่อนขึ้นหน้าใหม่)
  function pageBreaks(n) {
    var FIRST_FULL = 18, NEXT_FULL = 22, LAST_WITH_SIGN = 12;
    var breaks = [], done = 0, first = true;
    while (n - done > LAST_WITH_SIGN) {
      var take = Math.min(first ? FIRST_FULL : NEXT_FULL, n - done - 1);
      done += take;
      breaks.push(S1_FIRST + done - 1);
      first = false;
    }
    return breaks;
  }

  // ---------- แบบ 2 ----------
  function buildSheet2(xml, data, strings) {
    var header = schoolLine(cellText(xml, 'A6', strings), data.schoolCode, data.schoolName);
    xml = replaceCell(xml, 'A6', function (s) { return strCell('A6', s, header); });

    var counts = countByGrade(data.students || []);
    var totals = { book: 0, supplies: 0, uniform: 0 };
    GRADES.forEach(function (g, i) {
      var r = S2_FIRST + i;
      ['book', 'supplies', 'uniform'].forEach(function (k, j) {
        var ref = 'BCD'[j] + r;
        var n = counts[g][k];
        totals[k] += n;
        xml = replaceCell(xml, ref, function (s) { return n ? numCell(ref, s, n) : blankCell(ref, s); });
      });
    });
    var last = S2_TOTAL - 1;
    ['book', 'supplies', 'uniform'].forEach(function (k, j) {
      var col = 'BCD'[j];
      var ref = col + S2_TOTAL;
      xml = replaceCell(xml, ref, function (s) {
        return sumCell(ref, s, col + S2_FIRST + ':' + col + last, totals[k]);
      });
    });
    // ย่อให้พอดี 1 หน้า A4 (แม่แบบเดิมล้นคอลัมน์หมายเหตุไปหน้า 2)
    xml = xml.replace(/<sheetPr>([\s\S]*?)<\/sheetPr>/, function (m, inner) {
      return /pageSetUpPr/.test(inner) ? m : '<sheetPr>' + inner + '<pageSetUpPr fitToPage="1"/></sheetPr>';
    });
    xml = xml.replace(/<pageSetup ([^>]*?)\/>/, function (m, attrs) {
      return /fitToWidth/.test(attrs) ? m : '<pageSetup ' + attrs + ' fitToWidth="1" fitToHeight="1"/>';
    });
    return xml;
  }

  // ---------- กล่องลงชื่อ (text box ใน drawing) ----------
  function fillRun(seg, pattern, value, build) {
    if (!value) return seg;
    return seg.replace(pattern, function (m, lead) { return '<a:t>' + build(lead || '', esc(value)) + '</a:t>'; });
  }
  function fillSignatures(xml, data) {
    var thaiDate = data.reportDateText || '';
    var parts = xml.split('<xdr:twoCellAnchor>');
    for (var i = 1; i < parts.length; i++) {
      var seg = parts[i];
      var isDirector = seg.indexOf('รับรองความถูกต้อง') >= 0;
      var isTeacher = seg.indexOf('ผู้รายงานข้อมูล') >= 0;
      if (!isDirector && !isTeacher) continue;
      var name = isDirector ? data.directorName : data.teacherName;
      var phone = isDirector ? data.directorPhone : data.teacherPhone;
      seg = fillRun(seg, /<a:t>(\s*)\(\.{5,}\)<\/a:t>/, name, function (l, v) { return l + '(' + v + ')'; });
      seg = fillRun(seg, /<a:t>(\s*)โทรศัพท์ \(มือถือ\)\.{5,}<\/a:t>/, phone, function (l, v) { return l + 'โทรศัพท์ (มือถือ) ' + v; });
      seg = fillRun(seg, /<a:t>(\s*)วัน\/เดือน\/ปี\.{5,}\s*<\/a:t>/, thaiDate, function (l, v) { return l + 'วัน/เดือน/ปี ' + v; });
      if (isDirector) {
        seg = fillRun(seg, /<a:t>(\s*)ผู้อำนวยการโรงเรียน\.{5,}<\/a:t>/, data.schoolName, function (l, v) { return l + 'ผู้อำนวยการโรงเรียน' + v; });
      }
      parts[i] = seg;
    }
    // ฟอนต์ TH SarabunIT๙ แสดงตัวเลขเป็นเลขไทย ทำให้เบอร์โทร/วันที่สองกล่องไม่เหมือนกัน
    return parts.join('<xdr:twoCellAnchor>').replace(/TH SarabunIT๙/g, 'TH SarabunPSK');
  }

  // เลื่อนกล่องลงชื่อของแบบ 1 ลงตามจำนวนแถวที่เพิ่ม
  function shiftDrawing(xml, fromRow0, offset) {
    if (!offset) return xml;
    return xml.replace(/<xdr:row>(\d+)<\/xdr:row>/g, function (m, n) {
      n = +n;
      return n >= fromRow0 ? '<xdr:row>' + (n + offset) + '</xdr:row>' : m;
    });
  }

  // ยืดกล่องลงชื่อลงอีก n แถว (แม่แบบแบบ 2 กล่องเตี้ยจนบรรทัดวันที่ของครูถูกตัด)
  function growSignatureBoxes(xml, n) {
    var parts = xml.split('<xdr:twoCellAnchor>');
    for (var i = 1; i < parts.length; i++) {
      if (parts[i].indexOf('ลงชื่อ') < 0) continue;
      parts[i] = parts[i].replace(/(<xdr:to>[\s\S]*?<xdr:row>)(\d+)(<\/xdr:row>)/, function (_, a, r, b) {
        return a + (+r + n) + b;
      });
    }
    return parts.join('<xdr:twoCellAnchor>');
  }

  function buildWorkbook(xml, offset) {
    var sheet1Name = (xml.match(/<sheet name="([^"]+)" sheetId="\d+" r:id="rId1"/) || [])[1];
    // พื้นที่พิมพ์ของแบบ 1
    xml = xml.replace(/(<definedName name="_xlnm\.Print_Area" localSheetId="0">[^<]*\$H\$)(\d+)/, function (_, a, n) {
      return a + (+n + offset);
    });
    // พื้นที่พิมพ์ของแบบ 2 ขยาย 1 แถวตามกล่องลงชื่อที่ยืด
    xml = xml.replace(/(<definedName name="_xlnm\.Print_Area" localSheetId="1">[^<]*\$E\$)(\d+)/, function (_, a, n) {
      return a + (+n + 1);
    });
    // หัวตารางพิมพ์ซ้ำทุกหน้าเมื่อมีหลายหน้า
    if (sheet1Name && xml.indexOf('_xlnm.Print_Titles') < 0) {
      xml = xml.replace('</definedNames>',
        '<definedName name="_xlnm.Print_Titles" localSheetId="0">\'' + sheet1Name + '\'!$7:$8</definedName></definedNames>');
    }
    xml = xml.replace(/activeTab="\d+"/, 'activeTab="0"');
    xml = xml.replace(/<calcPr([^>]*?)\/>/, function (m, attrs) {
      return /fullCalcOnLoad/.test(attrs) ? m : '<calcPr' + attrs + ' fullCalcOnLoad="1"/>';
    });
    return xml;
  }

  function selectTab(xml, selected) {
    xml = xml.replace(/ tabSelected="1"/, '');
    return selected ? xml.replace('<sheetView ', '<sheetView tabSelected="1" ') : xml;
  }

  /**
   * @param JSZip   คลาส JSZip
   * @param template ArrayBuffer/Buffer ของ template.xlsx
   * @param data { schoolCode, schoolName, directorName, directorPhone, teacherName, teacherPhone,
   *               reportDateText, students:[{studentId,name,grade,classLabel?,book,supplies,uniform,note}] }
 *               grade ใช้สรุปแบบ 2 (ต้องเป็นค่าใน GRADES) ; classLabel แสดงในคอลัมน์ชั้นเรียนของแบบ 1 (เช่น ป.1/2)
   * @param outType 'blob' (เบราว์เซอร์) หรือ 'nodebuffer'
   */
  function build(JSZip, template, data, outType) {
    return JSZip.loadAsync(template).then(function (zip) {
      return Promise.all([S1, S2, D1, D2, WB, SS].map(function (p) { return zip.file(p).async('string'); }))
        .then(function (x) {
          var strings = sharedStrings(x[5]);
          var s1 = buildSheet1(x[0], data, strings);
          zip.file(S1, selectTab(s1.xml, true));
          zip.file(S2, selectTab(buildSheet2(x[1], data, strings), false));
          zip.file(D1, fillSignatures(shiftDrawing(x[2], S1_LAST, s1.offset), data));
          zip.file(D2, fillSignatures(growSignatureBoxes(x[3], 1), data));
          zip.file(WB, buildWorkbook(x[4], s1.offset));
          return zip.generateAsync({
            type: outType || 'blob',
            compression: 'DEFLATE',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
        });
    });
  }

  var api = { GRADES: GRADES, build: build, countByGrade: countByGrade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FloodReport = api;
})(this);
