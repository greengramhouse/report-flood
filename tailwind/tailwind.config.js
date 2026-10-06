// สร้าง assets/tailwind.css ใหม่เมื่อแก้ class ใน index.html หรือ assets/app.js:
//   npx tailwindcss@3.4.16 -c tailwind/tailwind.config.js -i tailwind/input.css -o assets/tailwind.css --minify
module.exports = {
  content: ['./index.html', './assets/app.js'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)',
        accent: 'var(--accent)', 'accent-soft': 'var(--accent-soft)', paper: 'var(--paper)', 'paper-ink': 'var(--paper-ink)',
        danger: 'var(--danger)', 'danger-soft': 'var(--danger-soft)', warn: 'var(--warn)', 'warn-soft': 'var(--warn-soft)',
        ok: 'var(--ok)', 'ok-soft': 'var(--ok-soft)'
      },
      fontFamily: { display: 'var(--font-display)', body: 'var(--font-body)', mono: 'var(--font-mono)' }
    }
  }
};
