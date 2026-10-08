/*
 * สร้างไฟล์ Word (.docx) "บันทึกข้อความ" รายงานผลการตรวจสอบความเสียหายของนักเรียนรายห้อง
 * รูปแบบตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ: ครุฑสูง 1.5 ซม., ขอบซ้าย 3 ซม., ขวา 2 ซม.,
 * ฟอนต์ TH SarabunPSK 16 pt, หัวเรื่อง "บันทึกข้อความ" 29 pt, หัวข้อ ส่วนราชการ/ที่/วันที่/เรื่อง 20 pt
 * เขียน XML เองด้วย JSZip (ไม่ต้องใช้ไลบรารีเพิ่ม) ใช้ได้ทั้งเบราว์เซอร์ (window.FloodMemo) และ Node.js
 */
(function (root) {
  'use strict';

  var FONT = 'TH SarabunPSK';
  var TWIP_CM = 567;
  var PAGE_W = 11906, PAGE_H = 16838;                    // A4
  var MARGIN = { top: Math.round(1.5 * TWIP_CM), bottom: Math.round(2 * TWIP_CM), left: Math.round(3 * TWIP_CM), right: Math.round(2 * TWIP_CM) };
  var TEXT_W = PAGE_W - MARGIN.left - MARGIN.right;      // 9071
  var MID = Math.round(TEXT_W / 2);
  var INDENT = Math.round(2.5 * TWIP_CM);                // ย่อหน้า 2.5 ซม.
  var SIGN_IND = Math.round(TEXT_W * 0.42);               // ตำแหน่งบล็อกลงชื่อ
  var EMU_CM = 360000;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- ตัดคำไทย ----------
  // ภาษาไทยไม่มีเว้นวรรคระหว่างคำ โปรแกรมเปิดเอกสารบางตัวจึงตัดบรรทัดได้แค่ตรงช่องว่าง
  // แล้วกระจายตัวอักษรห่างกัน (thaiDistribute) แทรก ZWSP (มองไม่เห็น) ระหว่างคำให้ตัดบรรทัดตรงคำได้
  var ZWSP = '\u200B';
  var THAI = /[\u0E00-\u0E7F]/;
  // คำที่ Intl.Segmenter ตัดผิด ห้ามตัดกลางคำ
  var KEEP_WORDS = ['ผลกระทบ', 'อุทกภัย', 'อุดหนุน'];
  var segmenter = null;
  try { if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter('th', { granularity: 'word' }); } catch (e) { /* เบราว์เซอร์เก่า ไม่ตัดคำ */ }

  function thaiBreaks(text) {
    text = String(text == null ? '' : text);
    if (!segmenter || !THAI.test(text)) return text;
    var keep = [];
    KEEP_WORDS.forEach(function (w) {
      for (var i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) keep.push([i, i + w.length]);
    });
    var out = '', prev = '';
    Array.from(segmenter.segment(text)).forEach(function (seg) {
      var at = seg.index;
      var inside = keep.some(function (k) { return at > k[0] && at < k[1]; });
      if (prev && !inside && THAI.test(prev.slice(-1)) && THAI.test(seg.segment.charAt(0))) out += ZWSP;
      out += seg.segment;
      prev = seg.segment;
    });
    return out;
  }

  // ---------- ตัวช่วยสร้าง XML ----------
  function run(text, o) {
    o = o || {};
    var pr = '';
    if (o.b) pr += '<w:b/><w:bCs/>';
    if (o.sz) pr += '<w:sz w:val="' + o.sz * 2 + '"/><w:szCs w:val="' + o.sz * 2 + '"/>';
    if (o.dotted) pr += '<w:u w:val="dotted"/>';
    // nobreak: ห้ามตัดบรรทัดกลางข้อความนี้ (ไม่แทรก ZWSP และเปลี่ยนช่องว่างเป็น no-break space)
    var t = o.nobreak ? String(text == null ? '' : text).replace(/ /g, '\u00A0') : thaiBreaks(text);
    return '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
  }
  function tab() { return '<w:r><w:tab/></w:r>'; }
  // แท็บที่มีเส้นประใต้ ใช้ลากเส้นประต่อจากข้อความไปจนถึงตำแหน่งแท็บ
  function dottedTab() { return '<w:r><w:rPr><w:u w:val="dotted"/></w:rPr><w:tab/></w:r>'; }
  function para(runs, o) {
    o = o || {};
    var pr = '';
    if (o.keepNext) pr += '<w:keepNext/>';
    if (o.keepLines) pr += '<w:keepLines/>';
    if (o.tabs) {
      pr += '<w:tabs>' + o.tabs.map(function (t) {
        return '<w:tab w:val="' + (t.val || 'left') + '"' + (t.leader ? ' w:leader="' + t.leader + '"' : '') + ' w:pos="' + t.pos + '"/>';
      }).join('') + '</w:tabs>';
    }
    pr += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '"/>';
    if (o.indFirst || o.indLeft || o.hanging) {
      pr += '<w:ind' + (o.indLeft ? ' w:left="' + o.indLeft + '"' : '') +
        (o.indFirst ? ' w:firstLine="' + o.indFirst + '"' : '') +
        (o.hanging ? ' w:hanging="' + o.hanging + '"' : '') + '/>';
    }
    if (o.jc) pr += '<w:jc w:val="' + o.jc + '"/>';
    return '<w:p><w:pPr>' + pr + '</w:pPr>' + (Array.isArray(runs) ? runs.join('') : runs) + '</w:p>';
  }
  function cell(content, w, o) {
    o = o || {};
    // ลำดับตาม schema: tcW, gridSpan, shd, vAlign
    var tc = '<w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.span ? '<w:gridSpan w:val="' + o.span + '"/>' : '') +
      (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>' : '') + '<w:vAlign w:val="center"/>';
    return '<w:tc><w:tcPr>' + tc + '</w:tcPr>' + para(run(content, { b: o.b }), { jc: o.jc || 'left' }) + '</w:tc>';
  }

  function image(rid, cx, cy, docId, title) {
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + (docId || 1) + '" name="' + esc(title || 'ตราครุฑ') + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="0" name="garuda.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  // "ป.4" -> "ชั้นประถมศึกษาปีที่ 4", "ป.1/2" -> "ชั้นประถมศึกษาปีที่ 1/2", "อ.2" -> "ชั้นอนุบาลปีที่ 2"
  function fullClassName(label) {
    var m = /^(อ|ป|ม|ปวช)\.(\d)(\/.+)?$/.exec(String(label || ''));
    if (!m) return label ? 'ชั้น ' + label : '';
    var names = { 'อ': 'อนุบาลปีที่', 'ป': 'ประถมศึกษาปีที่', 'ม': 'มัธยมศึกษาปีที่', 'ปวช': 'ประกาศนียบัตรวิชาชีพ ปีที่' };
    return 'ชั้น' + names[m[1]] + ' ' + m[2] + (m[3] || '');
  }

  var DOTS = '.......................................................';

  // ---------- เนื้อหาบันทึกข้อความ ----------
  function body(d, img) {
    var x = [];
    var cls = fullClassName(d.classLabel);
    var hits = d.students || [];
    var n = hits.length;
    var count = function (k) { return hits.filter(function (s) { return s[k]; }).length; };
    var c = { book: count('book'), supplies: count('supplies'), uniform: count('uniform') };
    var teacher = d.teacherName || DOTS;
    var affiliation = d.affiliation || 'สำนักงานเขตพื้นที่การศึกษาประถมศึกษาสระบุรี เขต 2';
    var schoolName = d.schoolName || 'โรงเรียน' + DOTS;

    // หัวบันทึก: ครุฑ + "บันทึกข้อความ"
    x.push(para([image(img.rid, img.cx, img.cy), tab(), run('บันทึกข้อความ', { b: true, sz: 29 })],
      { tabs: [{ val: 'center', pos: MID }] }));
    // ข้อความหัวบันทึกอยู่บนเส้นประ (ขีดเส้นใต้แบบจุด) แล้วลากเส้นประต่อจนสุดบรรทัด ตามแบบหนังสือราชการ
    x.push(para([run('ส่วนราชการ', { b: true, sz: 20 }), run('  ' + schoolName + '  ' + affiliation, { dotted: true }), dottedTab()],
      { tabs: [{ val: 'right', pos: TEXT_W }], before: 120 }));
    x.push(para([run('ที่', { b: true, sz: 20 }), run('  ' + (d.docNo || ''), { dotted: true }), dottedTab(),
      run('วันที่', { b: true, sz: 20 }), run('  ' + (d.dateText || ''), { dotted: true }), dottedTab()],
      { tabs: [{ val: 'left', pos: MID }, { val: 'right', pos: TEXT_W }] }));
    x.push(para([run('เรื่อง', { b: true, sz: 20 }),
      run('  รายงานผลการตรวจสอบความเสียหายของนักเรียนที่ได้รับผลกระทบจากเหตุอุทกภัย ', { dotted: true }),
      run(cls, { dotted: true, nobreak: true }), dottedTab()],
      { indLeft: 850, hanging: 850, tabs: [{ val: 'right', pos: TEXT_W }] }));
    x.push(para(run('เรียน  ผู้อำนวยการ' + schoolName), { before: 240, after: 120 }));

    // ย่อหน้า 1: ที่มา
    x.push(para(run('ตามที่ได้เกิดสถานการณ์อุทกภัยในพื้นที่ ส่งผลให้นักเรียนของ' + schoolName +
      'บางส่วนได้รับผลกระทบ โรงเรียนจึงมอบหมายให้ครูประจำชั้นสำรวจและตรวจสอบความเสียหายของนักเรียนในความรับผิดชอบ ' +
      'จำนวน 3 รายการ ได้แก่ หนังสือเรียน อุปกรณ์การเรียน และเครื่องแบบนักเรียน เพื่อใช้เป็นข้อมูลประกอบการรายงาน' +
      affiliation + ' และการขอรับการสนับสนุนงบเงินอุดหนุนช่วยเหลือนักเรียนที่ได้รับผลกระทบ นั้น'),
      { indFirst: INDENT, jc: 'thaiDistribute' }));

    // ย่อหน้า 2: ผลการตรวจสอบ
    var total = d.totalStudents || 0;
    var pct = total ? ' คิดเป็นร้อยละ ' + (n * 100 / total).toFixed(2) + ' ของนักเรียนทั้งหมด' : '';
    if (n) {
      x.push(para(run('ข้าพเจ้า ' + teacher + ' ครูประจำ' + cls + ' ได้ดำเนินการตรวจสอบนักเรียน' + cls +
        (total ? ' จำนวนทั้งสิ้น ' + total + ' คน' : '') + ' พบนักเรียนที่ได้รับผลกระทบหรือเกิดความเสียหาย จำนวน ' + n + ' คน' +
        pct + ' จำแนกตามรายการความเสียหาย ดังนี้'), { indFirst: INDENT, jc: 'thaiDistribute', before: 120 }));
      [['1. หนังสือเรียน', c.book], ['2. อุปกรณ์การเรียน', c.supplies], ['3. เครื่องแบบนักเรียน', c.uniform]].forEach(function (it) {
        x.push(para([run(it[0]), tab(), run('จำนวน  ' + it[1] + '  คน')],
          { indLeft: INDENT, tabs: [{ val: 'left', pos: INDENT + 3600, leader: 'dot' }] }));
      });
      x.push(para(run('รายละเอียดรายชื่อนักเรียนที่ได้รับผลกระทบ ปรากฏตามตารางต่อไปนี้'),
        { indFirst: INDENT, before: 120, after: 120, keepNext: true }));
      x.push(table(hits, c, d.classLabel));
    } else {
      x.push(para(run('ข้าพเจ้า ' + teacher + ' ครูประจำ' + cls + ' ได้ดำเนินการตรวจสอบนักเรียน' + cls +
        (total ? ' จำนวนทั้งสิ้น ' + total + ' คน' : '') +
        ' แล้ว ไม่พบนักเรียนที่ได้รับผลกระทบหรือเกิดความเสียหายด้านหนังสือเรียน อุปกรณ์การเรียน และเครื่องแบบนักเรียน'),
        { indFirst: INDENT, jc: 'thaiDistribute', before: 120 }));
    }

    // ย่อหน้าปิด
    x.push(para(run('จึงเรียนมาเพื่อโปรดทราบ และพิจารณาดำเนินการรวบรวมข้อมูลรายงาน' + affiliation + ' ต่อไป'),
      { indFirst: INDENT, jc: 'thaiDistribute', before: 240, keepNext: true }));

    // ลงชื่อครูประจำชั้น
    var signTeacher = [
      para('', { keepNext: true }), para('', { keepNext: true }),
      para(run('(ลงชื่อ)' + DOTS), { indLeft: SIGN_IND, jc: 'center', keepNext: true }),
      para(run('(' + (d.teacherName || DOTS) + ')'), { indLeft: SIGN_IND, jc: 'center', keepNext: true }),
      para(run('ครูประจำ' + cls), { indLeft: SIGN_IND, jc: 'center', keepNext: true })
    ];
    if (d.teacherPhone) signTeacher.push(para(run('โทร. ' + d.teacherPhone), { indLeft: SIGN_IND, jc: 'center', keepNext: true }));
    x.push.apply(x, signTeacher);

    // ความเห็น/ข้อสั่งการของผู้อำนวยการ (เก็บไว้หน้าเดียวกัน)
    var box = '☐';
    x.push(para(run('ความเห็น / ข้อสั่งการของผู้อำนวยการโรงเรียน', { b: true }), { before: 360, keepNext: true }));
    x.push(para(run(box + '  ทราบ'), { indLeft: 567, keepNext: true }));
    x.push(para([run(box + '  มอบผู้รับผิดชอบรวบรวมข้อมูลรายงาน' + affiliation)], { indLeft: 567, keepNext: true }));
    x.push(para([run(box + '  อื่น ๆ '), tab()], { indLeft: 567, tabs: [{ val: 'right', pos: TEXT_W, leader: 'dot' }], keepNext: true }));
    x.push(para('', { keepNext: true }));
    x.push(para(run('(ลงชื่อ)' + DOTS), { indLeft: SIGN_IND, jc: 'center', keepNext: true, before: 240 }));
    x.push(para(run('(' + (d.directorName || DOTS) + ')'), { indLeft: SIGN_IND, jc: 'center', keepNext: true }));
    x.push(para(run('ผู้อำนวยการ' + schoolName), { indLeft: SIGN_IND, jc: 'center', keepNext: true }));
    x.push(para(run('วันที่ ........ / ................. / ...........'), { indLeft: SIGN_IND, jc: 'center' }));

    // ภาพประกอบ: ขึ้นหน้าใหม่ หน้าละ 2 รูป
    if (img.photos && img.photos.length) {
      x.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      x.push(para(run('ภาพประกอบ สภาพความเสียหายจากเหตุอุทกภัย ' + cls, { b: true, sz: 18 }), { jc: 'center', after: 120 }));
      img.photos.forEach(function (p, i) {
        // คำอธิบายภาพที่ครูพิมพ์เอง ถ้าไม่มีใช้แค่ลำดับภาพ
        var label = 'ภาพที่ ' + (i + 1) + (p.caption ? ' ' + p.caption : '');
        x.push(para([image(p.rid, p.cx, p.cy, i + 2, label)], { jc: 'center', before: 120, keepNext: true }));
        x.push(para(run(label), { jc: 'center', after: 120 }));
      });
    }
    return x.join('');
  }

  function table(hits, c, classLabel) {
    var W = [600, 2971, 850, 1150, 1150, 1250, 1100];    // รวม = TEXT_W (9071)
    var head = ['ที่', 'ชื่อ - สกุล', 'ชั้น', 'หนังสือ', 'อุปกรณ์', 'เครื่องแบบ', 'หมายเหตุ'];
    var mark = '✓';
    var rows = [];
    rows.push('<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' + head.map(function (h, i) {
      return cell(h, W[i], { b: true, jc: 'center', shade: 'E7E6E6' });
    }).join('') + '</w:tr>');
    hits.forEach(function (s, i) {
      rows.push('<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
        cell(String(i + 1), W[0], { jc: 'center' }) +
        cell(s.name, W[1]) +
        cell(s.classLabel || classLabel || '', W[2], { jc: 'center' }) +
        cell(s.book ? mark : '', W[3], { jc: 'center' }) +
        cell(s.supplies ? mark : '', W[4], { jc: 'center' }) +
        cell(s.uniform ? mark : '', W[5], { jc: 'center' }) +
        cell(s.note || '', W[6]) + '</w:tr>');
    });
    rows.push('<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
      cell('รวม (คน)', W[0] + W[1] + W[2], { b: true, jc: 'center', span: 3, shade: 'F2F2F2' }) +
      cell(String(c.book), W[3], { b: true, jc: 'center', shade: 'F2F2F2' }) +
      cell(String(c.supplies), W[4], { b: true, jc: 'center', shade: 'F2F2F2' }) +
      cell(String(c.uniform), W[5], { b: true, jc: 'center', shade: 'F2F2F2' }) +
      cell('', W[6], { shade: 'F2F2F2' }) + '</w:tr>');
    var b = '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + TEXT_W + '" w:type="dxa"/><w:tblBorders>' + b + '</w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid>' + W.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>' +
      rows.join('') + '</w:tbl>';
  }

  // ---------- ส่วนประกอบไฟล์ .docx ----------
  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function documentXml(d, img) {
    return XML + '<w:document ' + NS + '><w:body>' + body(d, img) +
      '<w:sectPr><w:pgSz w:w="' + PAGE_W + '" w:h="' + PAGE_H + '"/>' +
      '<w:pgMar w:top="' + MARGIN.top + '" w:right="' + MARGIN.right + '" w:bottom="' + MARGIN.bottom + '" w:left="' + MARGIN.left +
      '" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }

  var STYLES = XML + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + FONT + '" w:hAnsi="' + FONT + '" w:eastAsia="' + FONT + '" w:cs="' + FONT + '"/>' +
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:lang w:val="th-TH" w:eastAsia="en-US" w:bidi="th-TH"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';

  var SETTINGS = XML + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '<w:themeFontLang w:val="en-US" w:bidi="th-TH"/>' +
    '</w:settings>';

  var CONTENT_TYPES = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  var ROOT_RELS = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  var DOC_RELS = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/garuda.png"/>';
  function docRels(photos) {
    return DOC_RELS + photos.map(function (p) {
      return '<Relationship Id="' + p.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + p.target + '"/>';
    }).join('') + '</Relationships>';
  }

  function coreXml(title) {
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(title) + '</dc:title><dc:language>th-TH</dc:language>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }
  var APP = XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>report-flood</Application></Properties>';

  // ขนาดภาพจาก header ของไฟล์ PNG
  function pngSize(bytes) {
    var u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var rd = function (o) { return ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3]; };
    return { w: rd(16), h: rd(20) };
  }

  /**
   * @param JSZip   คลาส JSZip
   * @param garuda  ArrayBuffer/Buffer ของไฟล์ครุฑ (PNG)
   * @param d { schoolName, affiliation, classLabel, totalStudents, teacherName, teacherPhone, directorName,
   *            dateText, docNo, students:[{name, classLabel?, book, supplies, uniform, note}],  (เฉพาะคนที่ได้รับผลกระทบ)
   *            photos?:[{data, w, h, ext, caption?}] }  ภาพประกอบ (data = ArrayBuffer/Uint8Array, ext = 'jpg' | 'png')
   * @param outType 'blob' (เบราว์เซอร์) หรือ 'nodebuffer'
   */
  function build(JSZip, garuda, d, outType) {
    var size = pngSize(garuda);
    var cy = Math.round(1.5 * EMU_CM);                    // ครุฑสูง 1.5 ซม.
    var cx = Math.round(cy * size.w / size.h);
    // ภาพประกอบกว้างไม่เกิน 14 ซม. สูงไม่เกิน 10.5 ซม. (หน้าละ 2 รูป)
    var photos = (d.photos || []).map(function (p, i) {
      var k = Math.min(14 * EMU_CM / p.w, 10.5 * EMU_CM / p.h);
      return { rid: 'rIdP' + (i + 1), target: 'media/photo' + (i + 1) + '.' + p.ext, data: p.data,
        cx: Math.round(p.w * k), cy: Math.round(p.h * k), caption: String(p.caption || '').trim() };
    });
    var zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('docProps/core.xml', coreXml('รายงานผลการตรวจสอบความเสียหายของนักเรียน ' + (d.classLabel || '')));
    zip.file('docProps/app.xml', APP);
    zip.file('word/_rels/document.xml.rels', docRels(photos));
    zip.file('word/styles.xml', STYLES);
    zip.file('word/settings.xml', SETTINGS);
    zip.file('word/media/garuda.png', garuda);
    photos.forEach(function (p) { zip.file('word/' + p.target, p.data); });
    zip.file('word/document.xml', documentXml(d, { rid: 'rId3', cx: cx, cy: cy, photos: photos }));
    return zip.generateAsync({
      type: outType || 'blob',
      compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  var api = { build: build, fullClassName: fullClassName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FloodMemo = api;
})(this);
