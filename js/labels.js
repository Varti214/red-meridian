'use strict';
/* ============================================================
   НАЗВАНИЯ СТРАН НА КАРТЕ (как в Hearts of Iron IV).
   Название растягивается вдоль главной оси страны и плавно
   изгибается по её форме, буквы идут вразрядку.

   Как считается раскладка для каждой страны (или державы):
   1) берём её земли, связанные сушей с «домом» (столицей);
   2) в равнопромежуточной проекции (с поправкой на широту) заполняем
      фигуру сеткой точек и находим главную ось (метод главных компонент);
   3) режем фигуру поперёк оси на полосы: в каждой — середина и толщина;
   4) выбираем самый длинный «толстый» участок, проводим через середины
      полос плавную дугу (парабола) — по ней и пойдут буквы;
   5) высота букв — от толщины страны и длины названия.
   Результат: { text, pts: [{lat, lng}…] — линия текста, h — высота букв в градусах }.
   Глобус и 2D-карта рисуют одну и ту же раскладку.
   ============================================================ */

const Labels = {
  rings: null,                 // id страны → самое большое внешнее кольцо [[lng, lat], …]
  cache: new Map(),            // подпись группы → раскладка

  ringsOf(id) {
    if (!this.rings) {
      this.rings = {};
      for (const f of Geo.features) {
        const g = f.geometry;
        if (!g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        let best = null, bestA = 0;
        for (const p of polys) {
          const r = p[0];
          let a = 0;
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
          a = Math.abs(a / 2);
          if (a > bestA) { bestA = a; best = r; }
        }
        if (best) this.rings[f.properties.id] = best;
      }
    }
    return this.rings[id];
  },

  /* Группы подписей: держава или страна + связанные сушей земли; оторванные земли — отдельно, мельче */
  groups() {
    const byOwner = new Map();
    Game.eachCountry(c => {
      if (c.inert || !Geo.meta[c.id] || !this.ringsOf(c.id)) return;
      (byOwner.get(c.ctrl) || byOwner.set(c.ctrl, []).get(c.ctrl)).push(c.id);
    });
    const out = [];
    for (const [owner, ids] of byOwner) {
      const power = Game.isPower(owner);
      const home = power ? POWERS[owner].capital : owner;
      const name = power ? POWERS[owner].name : (Game.c(owner) || {}).name || owner;
      const set = new Set(ids), seen = new Set();
      const start = set.has(home) ? home : ids[0];
      // Компонента «дома»: соседи по суше
      const comp = [], queue = [start];
      seen.add(start);
      while (queue.length) {
        const id = queue.shift();
        comp.push(id);
        for (const n of Geo.meta[id].neighbors) {
          if (set.has(n) && !seen.has(n) && !Geo.isSea(id, n)) { seen.add(n); queue.push(n); }
        }
      }
      out.push({ key: owner + ':' + comp.slice().sort().join(','), text: set.has(home) ? name : (Game.c(start) || {}).name, ids: comp, main: true });
      for (const id of ids) {
        if (seen.has(id)) continue;
        out.push({ key: owner + '~' + id, text: Game.c(id).name, ids: [id], main: false });
      }
    }
    return out;
  },

  // Все подписи (с кэшем: пересчёт только у групп, которые изменились)
  all() {
    if (!Game.S) return [];
    const res = [], keep = new Set();
    for (const g of this.groups()) {
      const k = g.key + '|' + g.text;
      keep.add(k);
      let L = this.cache.get(k);
      if (L === undefined) {
        try { L = this.layout(g); } catch (e) { console.warn('[labels]', g.key, e); L = null; }
        this.cache.set(k, L);
      }
      if (L) res.push(L);
    }
    for (const k of this.cache.keys()) if (!keep.has(k)) this.cache.delete(k);
    return res;
  },

  layout(g) {
    // 1. Кольца в локальной проекции
    const c0 = Geo.meta[g.ids[0]].centroid;
    const lng0 = c0.lng;
    let latSum = 0, n = 0;
    const raw = g.ids.map(id => this.ringsOf(id).map(([lng, lat]) => {
      let x = lng;
      while (x - lng0 > 180) x -= 360;
      while (x - lng0 < -180) x += 360;
      latSum += lat; n++;
      return [x, lat];
    }));
    const lat0 = latSum / n;
    const k = Math.max(0.2, Math.cos(lat0 * Math.PI / 180));
    const rings = raw.map(r => r.map(([x, y]) => [(x - lng0) * k, y - lat0]));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const span = Math.max(maxX - minX, maxY - minY);
    if (span < 0.6) return null;                                  // крошечные страны не подписываем

    // 2. Сетка точек внутри фигуры
    const cell = span / 46;
    const pts = [];
    const inside = (x, y) => {
      let hit = false;
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
        }
        if (hit) return true;
      }
      return false;
    };
    for (let y = minY + cell / 2; y < maxY; y += cell) for (let x = minX + cell / 2; x < maxX; x += cell) if (inside(x, y)) pts.push([x, y]);
    if (pts.length < 6) return null;

    // 3. Главная ось
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Почти круглые страны пишем горизонтально; слишком крутой наклон смягчаем — так читается легче
    const elong = Math.sqrt(Math.max(1e-9, (sxx + syy + Math.hypot(sxx - syy, 2 * sxy)) / Math.max(1e-9, sxx + syy - Math.hypot(sxx - syy, 2 * sxy))));
    if (elong < 1.6) ang *= Math.max(0, (elong - 1.15) / 0.45);   // почти круглые — горизонтально
    ang = U.clamp(ang, -0.72, 0.72);                                 // не круче ~40°
    const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;

    // 4. Полосы поперёк оси: середина и «толщина»
    const B = 26;
    const S = pts.map(([x, y]) => [(x - mx) * ux + (y - my) * uy, (x - mx) * vx + (y - my) * vy]);
    let smin = Infinity, smax = -Infinity;
    for (const [s] of S) { smin = Math.min(smin, s); smax = Math.max(smax, s); }
    const bw = (smax - smin) / B || 1;
    const bins = Array.from({ length: B }, () => []);
    for (const [s, t] of S) bins[Math.min(B - 1, Math.floor((s - smin) / bw))].push(t);
    const info = bins.map((ts, i) => {
      if (!ts.length) return null;
      ts.sort((a, b) => a - b);
      return { s: smin + (i + 0.5) * bw, mid: ts[Math.floor(ts.length / 2)], w: ts.length * cell * cell / bw, n: ts.length };
    });
    const maxW = Math.max(...info.filter(Boolean).map(b => b.w));
    // Самый длинный участок, где страна достаточно «толстая»
    const run = thr => {
      let best = [0, -1], a = -1;
      for (let i = 0; i <= B; i++) {
        const ok = i < B && info[i] && info[i].w >= thr * maxW;
        if (ok && a < 0) a = i;
        if (!ok && a >= 0) { if (i - 1 - a > best[1] - best[0]) best = [a, i - 1]; a = -1; }
      }
      return best;
    };
    let [ra, rb] = run(0.42);
    if (rb - ra < B * 0.35) [ra, rb] = run(0.22);
    if (rb < ra) return null;
    const sel = info.slice(ra, rb + 1).filter(Boolean);

    // 5. Плавная дуга через середины полос (парабола t = a·s² + b·s + c, МНК с весами)
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const b of sel) {
      const w = b.n, s = b.s, t = b.mid;
      s0 += w; s1 += w * s; s2 += w * s * s; s3 += w * s * s * s; s4 += w * s ** 4;
      t0 += w * t; t1 += w * t * s; t2 += w * t * s * s;
    }
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const M = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]];
    const D = det(M);
    let qa = 0, qb = 0, qc = t0 / Math.max(1e-9, s0);
    if (sel.length >= 3 && Math.abs(D) > 1e-12) {
      qa = det([[t2, s3, s2], [t1, s2, s1], [t0, s1, s0]]) / D;
      qb = det([[s4, t2, s2], [s3, t1, s1], [s2, t0, s0]]) / D;
      qc = det([[s4, s3, t2], [s3, s2, t1], [s2, s1, t0]]) / D;
    }
    const sa = info[ra] ? info[ra].s - bw / 2 : smin, sb = info[rb] ? info[rb].s + bw / 2 : smax;
    const sc = (sa + sb) / 2;
    const L = (sb - sa) * 0.9;
    // Прогиб дуги не больше 12% длины — без «радуг»
    const sag = Math.abs(qa) * (L / 2) ** 2;
    if (sag > L * 0.12) qa *= (L * 0.12) / sag;
    // Наклон самой дуги тоже ограничиваем (иначе у «вертикальных» стран текст встаёт столбом)
    if (Math.abs(qb) > 0.3) { const nb = Math.sign(qb) * 0.3; qc += (qb - nb) * sc; qb = nb; }
    const tAt = s => qa * s * s + qb * s + qc;

    // 6. Высота букв: от толщины страны и длины названия
    const text = String(g.text).toUpperCase();
    const chars = [...text].length;
    const widths = sel.map(b => b.w).sort((a, b) => a - b);
    const thick = widths[Math.floor(widths.length * 0.35)] || maxW;
    let h = Math.min(thick * 0.62, (L / Math.max(chars, 3)) * 1.6);
    h = Math.max(h, 0.28);
    if (!g.main) h *= 0.8;

    // 7. Линия текста слева направо, обратно в широту и долготу
    const N = 18, line = [];
    for (let i = 0; i <= N; i++) {
      const s = sc - L / 2 + L * i / N, t = tAt(s);
      const x = mx + s * ux + t * vx, y = my + s * uy + t * vy;
      line.push({ lat: lat0 + y, lng: lng0 + x / k });
    }
    if (line[0].lng > line[N].lng) line.reverse();
    return { key: g.key, text, pts: line, h, k, sub: !g.main };
  },

  /* Края ленты вокруг линии текста: смещение по нормали в «плоских» градусах */
  ribbon(L) {
    const top = [], bot = [];
    const P = L.pts, n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      const kc = Math.max(0.2, Math.cos(P[i].lat * Math.PI / 180));
      const tx = (b.lng - a.lng) * kc, ty = b.lat - a.lat;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len, ny = tx / len;            // нормаль «вверх» от текста
      const d = L.h / 2;
      top.push({ lat: P[i].lat + ny * d, lng: P[i].lng + nx * d / kc });
      bot.push({ lat: P[i].lat - ny * d, lng: P[i].lng - nx * d / kc });
    }
    return { top, bot };
  },

  /* Картинка с текстом для ленты: буквы равномерно вразрядку на всю длину */
  canvasFor(L, aspect) {
    const H = L.h > 1.6 ? 128 : 64;
    const W = Math.max(H * 2, Math.min(4096, Math.round(H * aspect)));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const chars = [...L.text];
    ctx.font = `700 ${Math.round(H * 0.82)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Если буквы шире слота — сжимаем по горизонтали
    const slot = W / chars.length;
    const maxW = Math.max(...chars.map(ch => ctx.measureText(ch).width));
    const sx = Math.min(1, slot * 0.92 / maxW);
    chars.forEach((ch, i) => {
      ctx.save();
      ctx.translate((i + 0.5) * slot, H * 0.53);
      ctx.scale(sx, 1);
      ctx.lineWidth = H * 0.06;
      ctx.strokeStyle = LABEL_STYLE.stroke;
      ctx.strokeText(ch, 0, 0);
      ctx.fillStyle = L.sub ? LABEL_STYLE.subFill : LABEL_STYLE.fill;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    });
    return cv;
  }
};

const LABEL_STYLE = {
  fill: 'rgba(12, 10, 8, 0.8)',       // тёмные буквы поверх цвета страны, как в HOI4
  subFill: 'rgba(12, 10, 8, 0.55)',
  stroke: 'rgba(255, 250, 240, 0.22)'   // лёгкий светлый ореол, чтобы буквы читались на тёмных странах
};
