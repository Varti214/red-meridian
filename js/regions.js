'use strict';
/* ============================================================
   РЕГИОНЫ: каждая страна поделена на области (как штаты в HOI4).
   У ключевых стран — настоящие области (REGION_SEEDS: название и точка),
   у остальных — автоматически по сторонам света; число областей растёт с площадью.
   Форма области — ячейка Вороного вокруг точки, обрезанная по границе страны.

   Регион — это настоящая земля: у него свой владелец (S.regions[id].ctrl),
   заводы, население, укрепления и контроль; на регионах стоят армии,
   за них идут бои. Страна (S.countries) — это государство: политика,
   блок, войны, выборы. Здесь — только неизменная география (форма,
   соседи, границы, столицы); она одинаково строится в браузере и на сервере.
   ============================================================ */

const REGION_SEEDS = {
  RUS: [['Москва и Центр', 55.7, 37.6], ['Северо-Запад', 59.9, 30.3], ['Калининград', 54.7, 20.5], ['Юг России', 47.2, 39.7],
    ['Северный Кавказ', 43.3, 45.0], ['Поволжье', 53.2, 50.1], ['Урал', 56.8, 60.6], ['Русский Север', 64.5, 40.5], ['Коми', 63.0, 54.0],
    ['Ханты-Мансийск', 61.0, 69.0], ['Ямал', 67.0, 72.0], ['Западная Сибирь', 55.0, 82.9], ['Красноярский край', 58.0, 93.0],
    ['Таймыр', 72.0, 100.0], ['Прибайкалье', 53.0, 104.3], ['Забайкалье', 52.0, 114.0], ['Якутия', 63.0, 125.0], ['Приморье', 44.5, 133.5],
    ['Хабаровский край', 52.0, 136.0], ['Магадан', 61.0, 151.0], ['Камчатка', 56.0, 159.0], ['Чукотка', 66.5, 172.0], ['Сахалин', 50.0, 142.8]],
  UKR: [['Киевщина', 50.45, 30.5], ['Галиция', 49.8, 24.0], ['Волынь', 51.0, 25.5], ['Подолье', 49.2, 28.5], ['Одесса', 46.6, 30.2],
    ['Харьковщина', 49.9, 36.2], ['Донбасс', 48.1, 38.2], ['Днепропетровщина', 48.5, 35.0], ['Таврия', 47.0, 34.2], ['Крым', 45.1, 34.1],
    ['Черниговщина', 51.5, 31.6], ['Полтавщина', 49.6, 33.8], ['Закарпатье', 48.4, 23.0]],
  BLR: [['Минская область', 53.9, 27.6], ['Брестская область', 52.5, 25.0], ['Гомельская область', 52.4, 30.0], ['Витебская область', 55.2, 29.0], ['Гродненская область', 53.6, 24.5]],
  USA: [['Новая Англия', 43.5, -71.0], ['Нью-Йорк', 42.5, -75.0], ['Пенсильвания', 40.9, -77.5], ['Вирджиния', 37.5, -78.5], ['Флорида', 28.0, -82.0],
    ['Джорджия', 32.7, -83.4], ['Огайо', 40.4, -82.7], ['Иллинойс', 41.0, -89.0], ['Миннесота', 46.0, -94.0], ['Великие равнины', 39.0, -98.0],
    ['Техас', 31.0, -99.0], ['Луизиана', 31.5, -92.0], ['Теннесси', 35.9, -86.0], ['Колорадо', 39.5, -106.0], ['Аризона', 34.2, -111.7],
    ['Невада', 39.0, -117.0], ['Калифорния', 36.7, -120.0], ['Северо-Запад', 46.0, -121.0], ['Монтана', 47.0, -109.6], ['Аляска', 64.0, -150.0]],
  CHN: [['Пекин', 39.9, 116.4], ['Шанхай', 31.2, 121.0], ['Гуандун', 23.1, 113.3], ['Сычуань', 30.6, 104.0], ['Хубэй', 30.6, 112.5],
    ['Маньчжурия', 46.5, 127.0], ['Ляонин', 41.8, 123.4], ['Шаньдун', 36.6, 118.0], ['Внутренняя Монголия', 42.5, 112.0], ['Синьцзян', 41.5, 85.0],
    ['Тибет', 31.5, 88.0], ['Цинхай', 35.5, 96.0], ['Ганьсу', 38.5, 101.0], ['Юньнань', 25.0, 101.7], ['Гуанси', 23.5, 108.5],
    ['Фуцзянь', 26.0, 118.0], ['Хэнань', 34.0, 113.6], ['Шэньси', 35.0, 108.9]],
  DEU: [['Берлин и Бранденбург', 52.5, 13.4], ['Бавария', 48.8, 11.5], ['Рейн-Рур', 51.2, 7.0], ['Северная Германия', 53.5, 9.5],
    ['Саксония', 51.0, 13.5], ['Баден-Вюртемберг', 48.5, 9.0], ['Гессен', 50.6, 9.0]],
  FRA: [['Иль-де-Франс', 48.8, 2.35], ['Бретань', 48.0, -3.0], ['Аквитания', 44.8, -0.6], ['Прованс', 43.6, 5.8], ['Лион и Овернь', 45.5, 3.8],
    ['Эльзас и Лотарингия', 48.6, 6.5], ['Нор', 50.2, 2.8], ['Бургундия', 47.2, 4.8], ['Гвиана', 4.0, -53.0]],
  POL: [['Мазовия', 52.2, 21.0], ['Малопольша', 50.06, 19.9], ['Великопольша', 52.4, 16.9], ['Поморье', 54.2, 18.0], ['Силезия', 51.1, 17.0], ['Люблин', 51.2, 22.8]],
  KAZ: [['Астана', 51.1, 71.4], ['Алматы', 44.0, 77.5], ['Актобе', 49.5, 57.2], ['Караганда', 48.0, 73.1], ['Шымкент', 42.5, 69.0],
    ['Атырау', 47.1, 51.9], ['Восточный Казахстан', 49.5, 82.6], ['Кызылорда', 44.8, 64.0], ['Мангистау', 44.0, 54.0], ['Костанай', 52.5, 63.6]],
  TUR: [['Стамбул', 41.0, 28.9], ['Анкара', 39.9, 32.8], ['Измир', 38.4, 27.6], ['Анталья', 37.0, 30.7], ['Курдистан', 38.2, 41.5],
    ['Трабзон', 40.8, 39.7], ['Адана', 37.2, 35.5], ['Кония', 37.9, 32.5]],
  GBR: [['Лондон', 51.5, -0.1], ['Шотландия', 56.8, -4.2], ['Уэльс', 52.3, -3.7], ['Северная Англия', 54.2, -2.0], ['Северная Ирландия', 54.6, -6.7], ['Мидлендс', 52.6, -1.5]],
  IND: [['Дели', 28.6, 77.2], ['Махараштра', 19.0, 75.0], ['Бенгалия', 23.0, 88.0], ['Тамилнад', 11.0, 78.5], ['Карнатака', 14.5, 76.0],
    ['Раджастхан', 26.9, 73.8], ['Уттар-Прадеш', 26.8, 80.9], ['Гуджарат', 22.5, 71.5], ['Кашмир', 34.0, 76.0], ['Ассам', 26.2, 92.9],
    ['Телангана', 17.4, 79.0], ['Мадхья-Прадеш', 23.3, 77.4], ['Одиша', 20.5, 84.5], ['Керала', 10.0, 76.5]],
  CAN: [['Онтарио', 47.0, -82.0], ['Квебек', 50.0, -71.0], ['Британская Колумбия', 53.7, -125.0], ['Альберта', 54.0, -114.0], ['Прерии', 52.0, -104.0],
    ['Атлантическая Канада', 46.5, -63.0], ['Нунавут', 66.0, -90.0], ['Северо-Западные территории', 64.0, -118.0], ['Юкон', 63.0, -135.0],
    ['Лабрадор', 54.0, -62.0], ['Арктические острова', 75.0, -95.0]],
  BRA: [['Сан-Паулу', -22.5, -48.5], ['Рио-де-Жанейро', -22.5, -42.8], ['Минас-Жерайс', -18.5, -44.5], ['Бразилиа и Гояс', -15.8, -49.0],
    ['Баия', -12.5, -41.7], ['Пернамбуку', -8.3, -37.5], ['Амазонас', -4.0, -64.0], ['Пара', -4.0, -52.5], ['Мату-Гросу', -12.6, -56.0],
    ['Парана', -24.6, -51.5], ['Риу-Гранди-ду-Сул', -30.0, -53.2], ['Мараньян', -5.0, -45.0], ['Рондония', -10.8, -63.0]],
  AUS: [['Новый Южный Уэльс', -32.0, 147.0], ['Виктория', -37.0, 144.5], ['Квинсленд', -22.0, 144.0], ['Западная Австралия', -26.0, 121.0],
    ['Южная Австралия', -30.0, 135.0], ['Северная территория', -19.5, 133.0], ['Тасмания', -42.0, 146.5]],
  IRN: [['Тегеран', 35.7, 51.4], ['Исфахан', 32.6, 51.7], ['Хорасан', 35.5, 59.0], ['Тебриз', 38.1, 46.3], ['Хузестан', 31.3, 48.7], ['Фарс', 29.6, 52.5], ['Белуджистан', 28.0, 61.0]],
  JPN: [['Канто', 36.0, 139.7], ['Кансай', 34.7, 135.5], ['Кюсю', 32.8, 130.7], ['Хоккайдо', 43.1, 142.5], ['Тохоку', 39.5, 140.5], ['Тюбу', 36.2, 137.5]],
  ITA: [['Лацио', 41.9, 12.5], ['Ломбардия', 45.5, 9.5], ['Венеция', 45.7, 12.0], ['Тоскана', 43.5, 11.2], ['Кампания', 40.9, 14.8], ['Сицилия', 37.5, 14.0], ['Сардиния', 40.0, 9.0], ['Апулия', 41.0, 16.5]],
  ESP: [['Мадрид', 40.4, -3.7], ['Каталония', 41.6, 1.6], ['Андалусия', 37.4, -4.8], ['Галисия', 42.8, -8.0], ['Валенсия', 39.4, -0.6], ['Страна Басков', 43.0, -2.6], ['Кастилия и Леон', 41.8, -4.8]],
  MEX: [['Мехико', 19.4, -99.1], ['Нижняя Калифорния', 29.0, -114.0], ['Чиуауа', 28.6, -106.0], ['Нуэво-Леон', 25.7, -100.3], ['Халиско', 20.6, -103.3], ['Юкатан', 20.5, -89.0], ['Оахака', 17.0, -96.7], ['Сонора', 29.1, -110.9]],
  ARG: [['Буэнос-Айрес', -35.0, -59.5], ['Кордова', -31.4, -64.2], ['Мендоса', -33.0, -68.8], ['Патагония', -45.0, -69.0], ['Чако', -26.0, -61.0], ['Сальта', -24.8, -65.4]],
  SAU: [['Эр-Рияд', 24.7, 46.7], ['Хиджаз', 22.0, 40.0], ['Восточная провинция', 25.5, 50.5], ['Асир', 18.5, 43.0], ['Табук', 28.4, 37.0], ['Руб-эль-Хали', 20.0, 50.0]],
  EGY: [['Каир', 30.0, 31.2], ['Александрия', 31.0, 29.5], ['Синай', 29.5, 33.8], ['Верхний Египет', 25.5, 32.5], ['Западная пустыня', 26.5, 27.5]],
  PAK: [['Пенджаб', 31.0, 73.0], ['Синд', 26.0, 68.5], ['Белуджистан', 28.5, 65.5], ['Хайбер-Пахтунхва', 34.5, 72.0]],
  IDN: [['Ява', -7.3, 110.0], ['Суматра', 0.0, 101.5], ['Калимантан', 0.0, 114.0], ['Сулавеси', -2.0, 121.0], ['Папуа', -4.0, 138.0]],
  SWE: [['Стокгольм', 59.3, 18.0], ['Гётеборг', 57.7, 12.5], ['Норрланд', 65.0, 18.0], ['Сконе', 56.0, 13.5]],
  NOR: [['Осло', 60.0, 10.7], ['Западная Норвегия', 61.0, 6.5], ['Трёнделаг', 63.5, 11.0], ['Северная Норвегия', 68.5, 17.0]],
  FIN: [['Хельсинки', 60.6, 25.0], ['Турку', 61.0, 22.5], ['Карелия', 62.6, 29.5], ['Лапландия', 67.5, 26.0], ['Остроботния', 63.5, 23.5]],
  ROU: [['Бухарест', 44.4, 26.1], ['Трансильвания', 46.5, 24.2], ['Молдова', 47.0, 27.0], ['Банат', 45.7, 21.5], ['Добруджа', 44.5, 28.3]],
  GEO: [['Тбилиси', 41.7, 44.8], ['Имеретия', 42.2, 42.7], ['Абхазия', 43.0, 41.0], ['Аджария', 41.6, 42.0]],
  MDA: [['Кишинёв', 47.0, 28.8], ['Приднестровье', 47.2, 29.6], ['Бессарабия', 47.8, 28.0], ['Гагаузия', 46.2, 28.6]],
  SYR: [['Дамаск', 33.5, 36.3], ['Алеппо', 36.2, 37.2], ['Латакия', 35.5, 35.9], ['Дейр-эз-Зор', 35.3, 40.1], ['Хомс', 34.7, 37.5]],
  KOR: [['Сеул', 37.5, 127.0], ['Пусан', 35.3, 128.8], ['Чолла', 35.0, 126.9], ['Канвондо', 37.8, 128.5]],
  PRK: [['Пхеньян', 39.0, 125.7], ['Хамгён', 41.0, 129.5], ['Янгандо', 41.0, 127.5], ['Хванхэ', 38.3, 125.5]]
};

const REGION_DIRS = ['Восток', 'Северо-Восток', 'Север', 'Северо-Запад', 'Запад', 'Юго-Запад', 'Юг', 'Юго-Восток'];

const Regions = {
  list: [],                    // все регионы: { id, cid, name, polys: [[[lng, lat]…]…], c: {lat, lng} }
  byCountry: {},               // id страны → массив регионов (порядок постоянный)
  built: false,

  build() {
    if (this.built || typeof Geo === 'undefined' || !Geo.features) return;
    this.built = true;
    for (const f of Geo.features) {
      const id = f.properties.id;
      try { this.byCountry[id] = this.buildCountry(f); } catch (e) { console.warn('[regions]', id, e); this.byCountry[id] = []; }
      this.list.push(...this.byCountry[id]);
    }
    this.link();
    this.setup();
    if (typeof Resources !== 'undefined') Resources.build();
  },

  // Внешние кольца всех частей страны
  outerRings(f) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.map(p => p[0]);
  },

  buildCountry(f) {
    const id = f.properties.id, name = f.properties.name;
    const meta = Geo.meta[id];
    if (!meta) return [];
    const rings = this.outerRings(f);
    const lng0 = meta.centroid.lng, lat0 = meta.centroid.lat;
    const k = Math.max(0.25, Math.cos(lat0 * Math.PI / 180));
    // Локальная проекция: долгота «разворачивается» вокруг центра (Чукотка, Аляска), умножается на cos широты
    const proj = ([lng, lat]) => { let x = lng; while (x - lng0 > 180) x -= 360; while (x - lng0 < -180) x += 360; return [(x - lng0) * k, lat - lat0]; };
    const unproj = ([x, y], shift) => [x / k + lng0 - shift, y + lat0];
    const P = rings.map(r => {
      const pr = r.map(proj);
      // На сколько сдвинута эта часть страны при «разворачивании» — вернём сдвиг после обрезки
      const shift = proj(r[0])[0] / k + lng0 - r[0][0];
      return { pr, shift };
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { pr } of P) for (const [x, y] of pr) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const area = P.reduce((s, { pr }) => s + Math.abs(this.area(pr)), 0);

    // Точки-центры регионов: настоящие области или автоматические
    let seeds;
    const named = REGION_SEEDS[id];
    if (named) {
      seeds = named.map(([n, lat, lng]) => ({ name: n, p: proj([lng, lat]) }));
    } else {
      const N = U.clamp(Math.round(Math.sqrt(area) * 0.55), 1, 16);
      seeds = this.kmeans(P.map(x => x.pr), N, minX, minY, maxX, maxY).map(p => ({ p }));
      this.nameSeeds(seeds, name);
    }
    if (seeds.length === 1) {
      return [{ id: id + ':0', cid: id, name: seeds[0].name || name, polys: rings.map(r => r.slice()), c: { lat: meta.centroid.lat, lng: meta.centroid.lng } }];
    }

    // Ячейка Вороного каждой точки (выпуклая) ∩ части страны
    const pad = Math.max(maxX - minX, maxY - minY) + 5;
    const box = [[minX - pad, minY - pad], [maxX + pad, minY - pad], [maxX + pad, maxY + pad], [minX - pad, maxY + pad]];
    const out = [];
    seeds.forEach((s, i) => {
      let cell = box;
      for (let j = 0; j < seeds.length && cell.length; j++) {
        if (j === i) continue;
        const q = seeds[j].p;
        // Полуплоскость точек, которые ближе к s, чем к q
        const nx = q[0] - s.p[0], ny = q[1] - s.p[1];
        const c = (nx * (q[0] + s.p[0]) + ny * (q[1] + s.p[1])) / 2;
        cell = this.clipHalf(cell, nx, ny, c);
      }
      if (cell.length < 3) return;
      const polys = [];
      let ax = 0, ay = 0, aw = 0;
      for (const { pr, shift } of P) {
        const clipped = this.clipConvex(pr, cell);
        const a = Math.abs(this.area(clipped));
        if (clipped.length < 3 || a < 0.002) continue;
        const cc = this.centroid(clipped);
        ax += cc[0] * a; ay += cc[1] * a; aw += a;
        polys.push(clipped.map(p => unproj(p, shift)));
      }
      if (!polys.length) return;
      const cen = unproj([ax / aw, ay / aw], 0);
      out.push({ id: id + ':' + i, cid: id, name: s.name || name, polys, c: { lat: cen[1], lng: cen[0] }, area: aw });
    });
    return out.length ? out : [{ id: id + ':0', cid: id, name, polys: rings.map(r => r.slice()), c: { lat: meta.centroid.lat, lng: meta.centroid.lng } }];
  },

  // Автоматические центры: k-средних по точкам внутри страны (одинаковые от игры к игре)
  kmeans(rings, N, minX, minY, maxX, maxY) {
    const cell = Math.max(maxX - minX, maxY - minY) / 40;
    const pts = [];
    for (let y = minY + cell / 2; y < maxY; y += cell) for (let x = minX + cell / 2; x < maxX; x += cell) if (rings.some(r => this.inside(r, x, y))) pts.push([x, y]);
    if (pts.length <= N) return pts.length ? pts : [[(minX + maxX) / 2, (minY + maxY) / 2]];
    let C = Array.from({ length: N }, (_, i) => pts[Math.floor((i + 0.5) * pts.length / N)].slice());
    for (let it = 0; it < 10; it++) {
      const acc = C.map(() => [0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        C.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
        acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2]++;
      }
      C = C.map((c, i) => acc[i][2] ? [acc[i][0] / acc[i][2], acc[i][1] / acc[i][2]] : c);
    }
    return C;
  },

  // Названия автоматических регионов: «Центр» и стороны света
  nameSeeds(seeds, country) {
    if (seeds.length === 1) { seeds[0].name = country; return; }
    const mx = seeds.reduce((s, x) => s + x.p[0], 0) / seeds.length, my = seeds.reduce((s, x) => s + x.p[1], 0) / seeds.length;
    const R = Math.max(...seeds.map(x => Math.hypot(x.p[0] - mx, x.p[1] - my))) || 1;
    const used = {};
    for (const s of seeds) {
      const dx = s.p[0] - mx, dy = s.p[1] - my;
      let dir = Math.hypot(dx, dy) < R * 0.3 ? 'Центр' : REGION_DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
      used[dir] = (used[dir] || 0) + 1;
      if (used[dir] > 1) dir += ' ' + ['', 'I', 'II', 'III', 'IV', 'V'][used[dir]];
      s.name = `${country}: ${dir.toLowerCase()}`;
    }
  },

  /* ---- Геометрия ---- */
  // Площадь со знаком: > 0, если обход против часовой стрелки
  area(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; },
  centroid(r) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; a += f;
    }
    if (Math.abs(a) < 1e-12) return r[0];
    return [cx / (3 * a), cy / (3 * a)];
  },
  inside(r, x, y) {
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  },
  // Отсечь многоугольник полуплоскостью n·p <= c
  clipHalf(poly, nx, ny, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
      if (da <= 0) out.push(a);
      if ((da < 0) !== (db < 0) && da !== db) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  },
  // Сазерленд — Ходжмен: произвольный многоугольник ∩ выпуклая ячейка
  clipConvex(subject, cell) {
    const ccw = this.area(cell) > 0;
    let out = subject;
    for (let i = 0; i < cell.length && out.length; i++) {
      const a = cell[i], b = cell[(i + 1) % cell.length];
      // Внутренняя сторона ребра a→b
      let nx = b[1] - a[1], ny = -(b[0] - a[0]);
      if (!ccw) { nx = -nx; ny = -ny; }
      out = this.clipHalf(out, nx, ny, nx * a[0] + ny * a[1]);
    }
    return out;
  },

  /* ============================================================
     СВЯЗИ МЕЖДУ РЕГИОНАМИ
     Два региона — соседи, если у них общий участок границы (совпадают
     хотя бы две вершины). Острова без соседей соединяются с ближайшим
     регионом своей страны «морем»; морские переправы между странами
     (SEA_LINKS) — с ближайшей парой регионов.
     ============================================================ */
  link() {
    const EPS = 0.006, Q = 0.02;
    const grid = new Map();
    const key = (x, y) => Math.round(x / Q) + ',' + Math.round(y / Q);
    for (const r of this.list) {
      r.nb = []; r.sea = {}; r.border = {};
      r.polys.forEach((ring, pi) => ring.forEach(([x, y], vi) => {
        const k = key(x, y);
        (grid.get(k) || grid.set(k, []).get(k)).push({ r, x, y, pi, vi });
      }));
    }
    // Совпадающие вершины разных регионов
    const shared = new Map();   // «a|b» → Set вершин региона a (pi:vi)
    for (const r of this.list) {
      r.polys.forEach((ring, pi) => ring.forEach(([x, y], vi) => {
        const gx = Math.round(x / Q), gy = Math.round(y / Q);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get((gx + dx) + ',' + (gy + dy));
          if (!cell) continue;
          for (const o of cell) {
            if (o.r === r || Math.abs(o.x - x) > EPS || Math.abs(o.y - y) > EPS) continue;
            const k = r.id + '|' + o.r.id;
            (shared.get(k) || shared.set(k, new Set()).get(k)).add(pi + ':' + vi);
          }
        }
      }));
    }
    const byId = this.byId = Object.fromEntries(this.list.map(r => [r.id, r]));
    const connect = (a, b, sea) => {
      if (a.nb.includes(b.id)) return;
      a.nb.push(b.id); b.nb.push(a.id);
      if (sea) { a.sea[b.id] = true; b.sea[a.id] = true; }
    };
    for (const [k, set] of shared) {
      if (set.size < 2) continue;
      const [ia, ib] = k.split('|');
      const a = byId[ia], b = byId[ib];
      connect(a, b, false);
      // Линия общей границы: подряд идущие общие вершины кольца региона a
      const runs = [];
      a.polys.forEach((ring, pi) => {
        let run = [];
        for (let vi = 0; vi <= ring.length; vi++) {
          const i = vi % ring.length;
          if (vi < ring.length && set.has(pi + ':' + i)) run.push(ring[i]);
          else { if (run.length >= 2) runs.push(run); run = []; }
        }
      });
      if (runs.length) a.border[b.id] = runs;
    }
    const dist = (a, b) => Math.hypot((((a.c.lng - b.c.lng + 540) % 360) - 180) * Math.cos((a.c.lat + b.c.lat) / 2 * Math.PI / 180), a.c.lat - b.c.lat);
    const closestPair = (A, B) => {
      let best = null, bd = Infinity;
      for (const a of A) for (const b of B) { const d = dist(a, b); if (d < bd) { bd = d; best = [a, b]; } }
      return best;
    };
    // Острова: соединяем с ближайшим регионом своей страны
    for (const [cid, R] of Object.entries(this.byCountry)) {
      if (R.length < 2) continue;
      // Компоненты связности внутри страны
      const seen = new Set(), comps = [];
      for (const r of R) {
        if (seen.has(r.id)) continue;
        const comp = [], q = [r];
        seen.add(r.id);
        while (q.length) {
          const x = q.shift(); comp.push(x);
          for (const n of x.nb) { const y = byId[n]; if (y.cid === cid && !seen.has(n)) { seen.add(n); q.push(y); } }
        }
        comps.push(comp);
      }
      comps.sort((a, b) => b.length - a.length);
      for (let i = 1; i < comps.length; i++) {
        const p = closestPair(comps[i], comps.slice(0, i).flat());
        if (p) connect(p[0], p[1], true);
      }
    }
    // Соседние страны (по суше и через проливы) — если общей вершины не нашлось, ближайшая пара
    for (const f of Geo.features) {
      const a = f.properties.id, m = Geo.meta[a];
      if (!m) continue;
      for (const b of m.neighbors) {
        if (a > b) continue;
        const A = this.byCountry[a] || [], B = this.byCountry[b] || [];
        if (!A.length || !B.length) continue;
        const linked = A.some(r => r.nb.some(n => byId[n].cid === b));
        if (linked) continue;
        const p = closestPair(A, B);
        if (p) connect(p[0], p[1], Geo.isSea(a, b));
      }
    }
  },

  /* ---- Столичные регионы и веса (для раздела заводов и населения) ---- */
  setup() {
    for (const [cid, R] of Object.entries(this.byCountry)) {
      if (!R.length) continue;
      const cap = (typeof POWERS !== 'undefined' && Object.values(POWERS).find(p => p.capital === cid) || {}).capitalPos || CAPITALS[cid];
      let capR = R[0];
      if (cap) {
        capR = R.find(r => r.polys.some(ring => this.inside(ring, cap.lng, cap.lat))) ||
          R.slice().sort((a, b) => Math.hypot(a.c.lng - cap.lng, a.c.lat - cap.lat) - Math.hypot(b.c.lng - cap.lng, b.c.lat - cap.lat))[0];
      } else if (!REGION_SEEDS[cid]) {
        const m = Geo.meta[cid].centroid;
        capR = R.slice().sort((a, b) => Math.hypot(a.c.lng - m.lng, a.c.lat - m.lat) - Math.hypot(b.c.lng - m.lng, b.c.lat - m.lat))[0];
      }
      for (const r of R) {
        r.capital = r === capR;
        // Заводы и люди тянутся к столице и южнее полярного круга
        r.w = Math.pow(Math.max(0.05, r.area || 1), 0.3) * (r.capital ? 4 : 1) * (Math.abs(r.c.lat) > 60 ? 0.5 : 1);
      }
      this.capitalOf[cid] = capR.id;
    }
  },
  capitalOf: {},

  // Разделить целое число между регионами пропорционально весам (метод наибольших остатков)
  split(cid, total) {
    const R = this.byCountry[cid] || [];
    const W = R.reduce((s, r) => s + r.w, 0) || 1;
    const raw = R.map(r => total * r.w / W);
    const out = raw.map(Math.floor);
    let rest = total - out.reduce((s, x) => s + x, 0);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) out[i]++; });
    return out;
  },

  /* ---- Справочные функции ---- */
  get(id) { return this.byId && this.byId[id]; },
  nb(id) { const r = this.get(id); return r ? r.nb : []; },
  isSea(a, b) { const r = this.get(a); return !!(r && r.sea[b]); },
  adjacent(a, b) { return this.nb(a).includes(b); },
  center(id) { const r = this.get(id); return r ? r.c : (Geo.meta[id] && Geo.meta[id].centroid); },
  // Точка на общей границе двух регионов (для фишек и стрелок)
  borderPoint(a, b) {
    const r = this.get(a), runs = r && r.border[b];
    if (runs && runs.length) {
      const run = runs.reduce((x, y) => (y.length > x.length ? y : x));
      const p = run[Math.floor(run.length / 2)];
      return { lat: p[1], lng: p[0] };
    }
    const A = this.center(a), B = this.center(b);
    return A && B ? { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 } : A;
  },
  // Точка внутри региона a, сдвинутая к соседу b (k — доля пути от центра к границе)
  toward(a, b, k = 0.5) {
    const A = this.center(a), P = this.borderPoint(a, b);
    if (!A || !P) return A;
    return { lat: A.lat + (P.lat - A.lat) * k, lng: A.lng + (P.lng - A.lng) * k };
  },
  ownerName(tag) { return Game.isPower(tag) ? POWERS[tag].name : (Game.c(tag) || {}).name || tag; },
  ownerColor(tag) {
    if (Game.isPower(tag)) return POWERS[tag].color;
    const c = Game.c(tag);
    return (FACTIONS[c && c.faction] || FACTIONS.NEU).color;
  }
};

// Столицы стран (для столичного региона): широта, долгота
const CAPITALS = {
  FRA: { lat: 48.86, lng: 2.35 }, DEU: { lat: 52.52, lng: 13.4 }, GBR: { lat: 51.5, lng: -0.12 }, ITA: { lat: 41.9, lng: 12.5 },
  ESP: { lat: 40.42, lng: -3.7 }, POL: { lat: 52.23, lng: 21.0 }, TUR: { lat: 39.93, lng: 32.86 }, IRN: { lat: 35.7, lng: 51.4 },
  IND: { lat: 28.6, lng: 77.2 }, JPN: { lat: 35.68, lng: 139.7 }, BRA: { lat: -15.8, lng: -47.9 }, CAN: { lat: 45.42, lng: -75.7 },
  AUS: { lat: -35.3, lng: 149.1 }, MEX: { lat: 19.43, lng: -99.13 }, ARG: { lat: -34.6, lng: -58.4 }, SAU: { lat: 24.7, lng: 46.7 },
  EGY: { lat: 30.04, lng: 31.24 }, PAK: { lat: 33.7, lng: 73.05 }, IDN: { lat: -6.2, lng: 106.8 }, KAZ: { lat: 51.16, lng: 71.45 },
  BLR: { lat: 53.9, lng: 27.56 }, KOR: { lat: 37.57, lng: 126.98 }, PRK: { lat: 39.03, lng: 125.75 }, SWE: { lat: 59.33, lng: 18.07 },
  NOR: { lat: 59.91, lng: 10.75 }, FIN: { lat: 60.17, lng: 24.94 }, ROU: { lat: 44.43, lng: 26.1 }, GEO: { lat: 41.72, lng: 44.79 },
  MDA: { lat: 47.01, lng: 28.86 }, SYR: { lat: 33.51, lng: 36.29 }, UKR: { lat: 50.45, lng: 30.52 }, RUS: { lat: 55.75, lng: 37.62 },
  USA: { lat: 38.9, lng: -77.04 }, CHN: { lat: 39.9, lng: 116.4 }, NGA: { lat: 9.06, lng: 7.49 }, ZAF: { lat: -25.75, lng: 28.19 },
  ETH: { lat: 9.03, lng: 38.74 }, COD: { lat: -4.32, lng: 15.31 }, DZA: { lat: 36.75, lng: 3.06 }, LBY: { lat: 32.89, lng: 13.19 },
  SDN: { lat: 15.5, lng: 32.56 }, IRQ: { lat: 33.31, lng: 44.36 }, AFG: { lat: 34.53, lng: 69.17 }, MNG: { lat: 47.92, lng: 106.92 },
  THA: { lat: 13.75, lng: 100.5 }, VNM: { lat: 21.03, lng: 105.85 }, MMR: { lat: 19.76, lng: 96.08 }, PER: { lat: -12.05, lng: -77.04 },
  COL: { lat: 4.71, lng: -74.07 }, VEN: { lat: 10.48, lng: -66.9 }, CHL: { lat: -33.45, lng: -70.67 }, BOL: { lat: -16.5, lng: -68.15 },
  KEN: { lat: -1.29, lng: 36.82 }, TZA: { lat: -6.16, lng: 35.75 }, AGO: { lat: -8.84, lng: 13.23 }, MAR: { lat: 34.02, lng: -6.83 },
  UZB: { lat: 41.3, lng: 69.24 }, TKM: { lat: 37.95, lng: 58.38 }, YEM: { lat: 15.37, lng: 44.19 }, OMN: { lat: 23.59, lng: 58.41 },
  GRC: { lat: 37.98, lng: 23.73 }, BGR: { lat: 42.7, lng: 23.32 }, SRB: { lat: 44.79, lng: 20.45 }, HUN: { lat: 47.5, lng: 19.04 },
  CZE: { lat: 50.08, lng: 14.44 }, AUT: { lat: 48.21, lng: 16.37 }, PRT: { lat: 38.72, lng: -9.14 }, NLD: { lat: 52.37, lng: 4.9 },
  MLI: { lat: 12.64, lng: -8.0 }, NER: { lat: 13.51, lng: 2.11 }, TCD: { lat: 12.13, lng: 15.06 }, MRT: { lat: 18.09, lng: -15.98 },
  CMR: { lat: 3.85, lng: 11.5 }, ZMB: { lat: -15.39, lng: 28.32 }, ZWE: { lat: -17.83, lng: 31.05 }, MOZ: { lat: -25.97, lng: 32.57 },
  MDG: { lat: -18.88, lng: 47.51 }, NAM: { lat: -22.56, lng: 17.08 }, BWA: { lat: -24.65, lng: 25.91 }, SOM: { lat: 2.05, lng: 45.32 },
  PNG: { lat: -9.44, lng: 147.18 }, NZL: { lat: -41.29, lng: 174.78 }, PHL: { lat: 14.6, lng: 120.98 }, MYS: { lat: 3.14, lng: 101.69 },
  CUB: { lat: 23.11, lng: -82.37 }, ECU: { lat: -0.18, lng: -78.47 }, PRY: { lat: -25.26, lng: -57.58 }, URY: { lat: -34.9, lng: -56.16 },
  ISL: { lat: 64.15, lng: -21.94 }, IRL: { lat: 53.35, lng: -6.26 }, LKA: { lat: 6.93, lng: 79.85 }, BGD: { lat: 23.81, lng: 90.41 },
  NPL: { lat: 27.72, lng: 85.32 }, KHM: { lat: 11.56, lng: 104.92 }, LAO: { lat: 17.97, lng: 102.63 }, TWN: { lat: 25.03, lng: 121.56 },
  ISR: { lat: 31.77, lng: 35.21 }, JOR: { lat: 31.95, lng: 35.93 }, ARE: { lat: 24.45, lng: 54.38 }, KGZ: { lat: 42.87, lng: 74.59 },
  TJK: { lat: 38.56, lng: 68.79 }, AZE: { lat: 40.41, lng: 49.87 }, ARM: { lat: 40.18, lng: 44.51 }
};

