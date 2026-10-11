'use strict';
/* ============================================================
   ГЕОГРАФИЯ: загрузка GeoJSON с цепочкой запасных вариантов,
   центры стран, площади и соседство (кто с кем граничит).
   ============================================================ */

const Geo = {
  features: [],
  byId: {},
  meta: {},        // id → { centroid:{lat,lng}, bbox:[minX,minY,maxX,maxY], area, neighbors:[] }
  source: '',

  // Если локальный файл не загрузился — пробуем интернет
  REMOTE: [
    'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@master/example/datasets/ne_110m_admin_0_countries.geojson',
    'https://unpkg.com/globe.gl@2.46.2/example/datasets/ne_110m_admin_0_countries.geojson',
    'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'
  ],

  async load(onStep) {
    let data = null;
    if (window.WORLD_GEO && Array.isArray(window.WORLD_GEO.features) && window.WORLD_GEO.features.length > 50) {
      data = window.WORLD_GEO;
      this.source = 'local';
    } else {
      for (const url of this.REMOTE) {
        try {
          onStep && onStep('Локальная карта недоступна, загрузка из сети…');
          data = await this.fetchJSON(url, 9000);
          if (data && data.features && data.features.length > 50) { this.source = 'cdn'; break; }
          data = null;
        } catch (e) {
          console.warn('[Geo] не удалось загрузить', url, e.message);
        }
      }
    }
    if (!data) {
      console.warn('[Geo] используется аварийная схематичная карта');
      data = this.emergency();
      this.source = 'emergency';
    }
    this.features = this.normalize(data);
    this.features.forEach(f => { this.byId[f.properties.id] = f; });
    this.computeMeta();
    return this.source;
  },

  async fetchJSON(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  },

  // Приводим любые варианты GeoJSON (наш или «сырой» Natural Earth) к одному формату свойств
  normalize(fc) {
    const seen = new Set();
    const out = [];
    for (const f of fc.features) {
      if (!f || !f.geometry || !/Polygon/.test(f.geometry.type)) continue;
      const p = f.properties || {};
      let id = p.id || p.ADM0_A3 || p.ISO_A3 || p.iso_a3;
      if (!id || id === '-99' || seen.has(id)) continue;
      seen.add(id);
      out.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          id,
          name: p.name || p.NAME_RU || p.NAME || p.ADMIN || id,
          pop: +p.pop || +p.POP_EST || 1e6,
          gdp: +p.gdp || +p.GDP_MD_EST || 5000
        }
      });
    }
    return out;
  },

  // Перебор внешних колец всех полигонов страны
  outerRings(geom) {
    if (geom.type === 'Polygon') return [geom.coordinates[0]];
    return geom.coordinates.map(p => p[0]);
  },

  ringArea(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return Math.abs(a / 2);
  },

  ringCentroid(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f;
      cx += (ring[j][0] + ring[i][0]) * f;
      cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) return { lng: ring[0][0], lat: ring[0][1] };
    return { lng: cx / (3 * a), lat: cy / (3 * a) };
  },

  computeMeta() {
    for (const f of this.features) {
      const id = f.properties.id;
      const rings = this.outerRings(f.geometry);
      let best = rings[0], bestA = -1, total = 0;
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      for (const r of rings) {
        const a = this.ringArea(r);
        total += a;
        if (a > bestA) { bestA = a; best = r; }
        for (const [x, y] of r) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      const centroid = CENTROID_OVERRIDES[id] || this.ringCentroid(best);
      this.meta[id] = { centroid, bbox: [minX, minY, maxX, maxY], area: total, neighbors: [] };
    }
    this.computeNeighbors();
  },

  /* Соседство: раскладываем все вершины границ по сетке 1°×1° и ищем
     вершины разных стран, которые ближе ~100 км. Это быстро: сравниваем только соседние ячейки. */
  computeNeighbors() {
    const CELL = 1, TH = 0.9, TH2 = TH * TH;
    const grid = new Map();
    this.features.forEach((f, idx) => {
      const rings = this.outerRings(f.geometry);
      for (const r of rings) {
        for (let i = 0; i < r.length; i += 1) {
          const [x, y] = r[i];
          const key = Math.floor(x / CELL) + ':' + Math.floor(y / CELL);
          let cell = grid.get(key);
          if (!cell) { cell = new Map(); grid.set(key, cell); }
          let pts = cell.get(idx);
          if (!pts) { pts = []; cell.set(idx, pts); }
          pts.push(x, y);
        }
      }
    });

    const pairs = new Set();
    const close = (a, b) => {
      for (let i = 0; i < a.length; i += 2) {
        const coslat = Math.cos(a[i + 1] * Math.PI / 180);
        for (let j = 0; j < b.length; j += 2) {
          let dx = Math.abs(a[i] - b[j]);
          if (dx > 180) dx = 360 - dx;
          dx *= coslat;
          const dy = a[i + 1] - b[j + 1];
          if (dx * dx + dy * dy < TH2) return true;
        }
      }
      return false;
    };

    for (const [key, cell] of grid) {
      const [cx, cy] = key.split(':').map(Number);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          let nx = cx + ox;
          if (nx < -180) nx += 360; if (nx >= 180) nx -= 360;
          const other = grid.get(nx + ':' + (cy + oy));
          if (!other) continue;
          for (const [a, pa] of cell) {
            for (const [b, pb] of other) {
              if (a >= b) continue;
              const k = a + '|' + b;
              if (pairs.has(k)) continue;
              if (close(pa, pb)) pairs.add(k);
            }
          }
        }
      }
    }

    const link = (ia, ib) => {
      const A = this.meta[ia], B = this.meta[ib];
      if (!A || !B || ia === ib) return;
      if (!A.neighbors.includes(ib)) A.neighbors.push(ib);
      if (!B.neighbors.includes(ia)) B.neighbors.push(ia);
    };
    for (const k of pairs) {
      const [a, b] = k.split('|').map(Number);
      link(this.features[a].properties.id, this.features[b].properties.id);
    }
    // Проливы: соседи, даже если граница не нашлась геометрически, но связь — морская
    this.sea = new Set();
    SEA_LINKS.forEach(([a, b]) => {
      link(a, b);
      this.sea.add(a + '|' + b);
      this.sea.add(b + '|' + a);
    });
  },

  isSea(a, b) { return !!this.sea && this.sea.has(a + '|' + b); },

  // Расстояние по большой окружности, в градусах дуги
  arcDistance(a, b) {
    const r = Math.PI / 180;
    const s = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
    return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / r;
  },

  /* Аварийная карта: если не удалось загрузить ни один GeoJSON, страны рисуются
     прямоугольниками. Выглядит схематично, зато игра остаётся играбельной. */
  emergency() {
    const boxes = {
      RUS: ['РСФСР', 30, 50, 179, 75, 140e6, 3e6], UKR: ['Украина', 22, 44.5, 40, 52, 44e6, 3e5], BLR: ['Белоруссия', 23.5, 51.5, 31.5, 56, 9e6, 1e5],
      KAZ: ['Казахстан', 47, 41, 87, 50, 18e6, 4e5], UZB: ['Узбекистан', 56, 37, 72, 41, 30e6, 2e5], TKM: ['Туркмения', 52, 35.5, 56, 41, 5e6, 9e4],
      GEO: ['Грузия', 40, 41.5, 46.5, 43.5, 4e6, 4e4], ARM: ['Армения', 43.5, 39, 46, 41.5, 3e6, 3e4], AZE: ['Азербайджан', 46, 38.5, 50, 41.5, 1e7, 1e5],
      LTU: ['Литва', 21, 54, 26.5, 56, 3e6, 8e4], LVA: ['Латвия', 21, 56, 28, 58, 2e6, 5e4], EST: ['Эстония', 22, 58, 28, 59.6, 1e6, 4e4],
      MDA: ['Молдавия', 27, 45.5, 30, 48.5, 3e6, 2e4], KGZ: ['Киргизия', 72, 39.5, 80, 43, 6e6, 2e4], TJK: ['Таджикистан', 67.5, 36.7, 72, 39.5, 9e6, 2e4],
      POL: ['Польша', 14, 49, 24, 54.5, 38e6, 1e6], DEU: ['Германия', 6, 47.5, 14, 55, 80e6, 4e6], FRA: ['Франция', -4.5, 43, 6, 51, 67e6, 2.7e6],
      ESP: ['Испания', -9, 36, 3, 43.5, 46e6, 1.7e6], ITA: ['Италия', 7, 38, 18, 46.5, 60e6, 2.2e6], GBR: ['Великобритания', -6, 50, 1.7, 58.5, 66e6, 2.8e6],
      TUR: ['Турция', 26, 36, 44.5, 42, 80e6, 1.7e6], IRN: ['Иран', 44.5, 26, 63, 39.5, 82e6, 1.4e6], CHN: ['Китай', 75, 22, 134, 49, 1.3e9, 2e7],
      MNG: ['Монголия', 88, 42, 119, 51.5, 3e6, 4e4], IND: ['Индия', 68, 8, 89, 32, 1.3e9, 8e6], JPN: ['Япония', 130, 31, 145, 45, 126e6, 4.9e6],
      USA: ['США', -124, 25, -67, 49, 326e6, 1.8e7], CAN: ['Канада', -140, 49, -55, 70, 36e6, 1.6e6], MEX: ['Мексика', -117, 15, -87, 32, 124e6, 2.3e6],
      BRA: ['Бразилия', -73, -33, -35, 5, 207e6, 3e6], ARG: ['Аргентина', -73, -55, -54, -22, 44e6, 8e5], EGY: ['Египет', 25, 22, 35, 31.5, 97e6, 1.1e6],
      DZA: ['Алжир', -8, 19, 11.5, 37, 41e6, 6e5], NGA: ['Нигерия', 3, 4.5, 14.5, 13.5, 190e6, 1e6], ZAF: ['ЮАС', 16.5, -34.5, 32.5, -22.5, 55e6, 7e5],
      SAU: ['Саудовская Аравия', 36.5, 16.5, 55.5, 32, 28e6, 1.7e6], AUS: ['Австралия', 114, -38.5, 153, -12, 23e6, 1.2e6], IDN: ['Индонезия', 95, -8.5, 140, 5, 260e6, 3e6],
      SWE: ['Швеция', 11, 55.5, 23.5, 68.5, 10e6, 5e5], FIN: ['Финляндия', 21, 60, 31.5, 70, 5.5e6, 2.2e5], NOR: ['Норвегия', 5, 58, 11, 70.5, 5e6, 3.6e5],
      ROU: ['Румыния', 20.5, 44, 29.5, 48, 21e6, 4.4e5], HUN: ['Венгрия', 16.5, 46, 22.5, 48.5, 10e6, 2.7e5], AFG: ['Афганистан', 61, 30, 74.5, 38.5, 34e6, 6e4],
      PAK: ['Пакистан', 61, 24, 75, 36.5, 200e6, 1e6], KOR: ['Южная Корея', 126, 34.5, 129.5, 38, 51e6, 1.9e6], PRK: ['КНДР', 124.5, 38, 130, 42.5, 25e6, 4e4]
    };
    const features = Object.entries(boxes).map(([id, [name, x1, y1, x2, y2, pop, gdp]]) => ({
      type: 'Feature',
      properties: { id, name, pop, gdp },
      geometry: { type: 'Polygon', coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] }
    }));
    return { type: 'FeatureCollection', features };
  }
};
