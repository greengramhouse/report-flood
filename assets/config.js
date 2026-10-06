window.APP_CONFIG = {
  // ข้อมูลโรงเรียน (พิมพ์ลงหัวกระดาษของไฟล์ Excel)
  SCHOOL_CODE: '1019600075',          // รหัสโรงเรียน 10 หลัก
  SCHOOL_NAME: 'โรงเรียนชุมชนวัดไทยงาม',          // เช่น 'โรงเรียนบ้าน...'

  // API รายชื่อนักเรียนของโรงเรียน (มีอยู่แล้ว)
  STUDENT_API_URL: 'https://script.google.com/macros/s/AKfycbwGKkKFJhysM4U02sUEd-v01wTCd7pBiHxFcTi7gPNCWybgT1xT6Md3e6bZyWry2eZx/exec',

  // URL ของ Web App จาก code.gs ของแบบสำรวจนี้ (ลงท้ายด้วย /exec)
  // ถ้าเว้นว่าง จะกรอกและดาวน์โหลด Excel รายห้องได้ แต่บันทึกลง Google Sheet ไม่ได้
  API_URL: 'https://script.google.com/macros/s/AKfycbxpOZBhdTZLfJghmzMJ0BzoGtj9ET853lStl-M3E0rXCn7ZzkJnxBCDNIQfqyFTTkDV/exec'
};
