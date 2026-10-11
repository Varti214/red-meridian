'use strict';
/* ============================================================
   УТИЛИТЫ: математика, случайность, форматирование, шина событий
   ============================================================ */

const U = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  cap: s => s ? s[0].toUpperCase() + s.slice(1) : s,
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  chance: p => Math.random() < p,
  pick: arr => arr[Math.floor(Math.random() * arr.length)],

  // Вероятностное округление: 2.3 → 2 (70%) или 3 (30%). Нужно, чтобы дивизии терялись целиком, но в среднем честно.
  probRound(x) {
    const f = Math.floor(x);
    return f + (Math.random() < x - f ? 1 : 0);
  },

  weightedPick(items, weightFn) {
    const w = items.map(weightFn);
    const total = w.reduce((s, v) => s + v, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= w[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  },

  // Бросок 2d6 — как в настольных варгеймах
  roll2d6: () => [U.randi(1, 6), U.randi(1, 6)],

  // Распределение суммы 2d6 (для точного расчёта шансов)
  DIST_2D6: (() => {
    const d = {};
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) d[a + b] = (d[a + b] || 0) + 1 / 36;
    return d;
  })(),

  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  fmt(n, digits = 0) {
    if (!isFinite(n)) return '—';
    return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },

  signed(n, digits = 1) {
    const s = U.fmt(Math.abs(n), digits);
    return (n >= 0 ? '+' : '−') + s;
  },

  // Призывники хранятся в тысячах
  fmtMP(k) {
    if (k >= 1000) return U.fmt(k / 1000, 2) + ' млн';
    return U.fmt(Math.max(0, k), 0) + ' тыс.';
  },

  fmtPop(p) {
    if (p >= 1e6) return U.fmt(p / 1e6, 1) + ' млн';
    return U.fmt(p / 1e3, 0) + ' тыс.';
  },

  MONTHS_GEN: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],

  fmtDate(ms) {
    const d = new Date(ms);
    return `${d.getUTCDate()} ${U.MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  },

  fmtDateShort(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  },

  // Русские окончания: 1 день, 2 дня, 5 дней
  plural(n, one, few, many) {
    const a = Math.abs(Math.round(n)) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  },

  days: n => `${Math.ceil(n)} ${U.plural(Math.ceil(n), 'день', 'дня', 'дней')}`,
  divs: n => `${n} ${U.plural(n, 'дивизия', 'дивизии', 'дивизий')}`,

  pct: (v, digits = 0) => U.fmt(v * 100, digits) + '%',

  hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  rgba(hex, a) {
    const [r, g, b] = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  },

  // Осветлить/затемнить цвет: k > 0 — светлее, k < 0 — темнее
  shade(hex, k) {
    const [r, g, b] = U.hexToRgb(hex);
    const f = c => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
    return '#' + [f(r), f(g), f(b)].map(c => U.clamp(c, 0, 255).toString(16).padStart(2, '0')).join('');
  },

  storage: {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* хранилище недоступно — ничего страшного */ }
    }
  }
};

/* Шина событий: модули не вызывают друг друга напрямую, а «кричат» в шину.
   Так игровая логика (Game) ничего не знает об интерфейсе (UI) — их легко менять независимо. */
const Bus = {
  handlers: {},
  on(evt, fn) {
    (this.handlers[evt] = this.handlers[evt] || []).push(fn);
  },
  emit(evt, ...args) {
    const list = this.handlers[evt];
    if (!list) return;
    for (const fn of list) {
      try { fn(...args); } catch (e) { console.error(`[Bus:${evt}]`, e); }
    }
  }
};
