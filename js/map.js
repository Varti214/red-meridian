'use strict';
/* ============================================================
   КАРТА: общий фасад MapView и два рендерера:
   • GlobeRenderer — 3D-глобус на globe.gl + Three.js;
   • FlatRenderer  — 2D-карта на Canvas (запасной вариант, если нет WebGL).
   Оба рендерера берут цвета и метки из одних и тех же функций MapView,
   поэтому выглядят и ведут себя одинаково.
   ============================================================ */

const COLORS = {
  front: '#ec7a1c', frontHi: '#ffc94a', frontStroke: '#ffd78a',
  waste: '#3a4710', wasteStroke: '#c8f04a',
  justify: '#ffd34d', selected: '#ffe680'
};

const MapView = {
  impl: null,
  mode: null,
  layer: 'bloc',            // раскраска карты: блоки или идеологии
  el: null,
  hovered: null,
  selected: null,
  holdUntil: 0,
  pending: false,
  onClick: () => {},
  onHover: () => {},
  onArmy: () => {},          // клик по фишке армии
  onRight: () => {},         // правый клик по стране (приказ выбранной армии)
  selectedArmy: null,

  webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  },
  canGlobe() { return typeof window.Globe === 'function' && this.webglAvailable(); },

  init(el, mode, handlers) {
    this.el = el;
    this.onClick = handlers.click;
    this.onHover = handlers.hover;
    this.onArmy = handlers.army || (() => {});
    this.onRight = handlers.right || (() => {});
    return this.setMode(mode);
  },

  setMode(mode) {
    if (this.impl) {
      try { this.impl.destroy(); } catch (e) { console.warn(e); }
      this.impl = null;
      this.el.innerHTML = '';
    }
    if (mode === 'globe' && this.canGlobe()) {
      try {
        GlobeRenderer.init(this.el, Geo.features);
        this.impl = GlobeRenderer;
        this.mode = 'globe';
      } catch (e) {
        console.error('[Map] 3D-глобус не запустился, переключаемся на 2D:', e);
        this.el.innerHTML = '';
        Bus.emit('toast', '3D-режим недоступен — включена 2D-карта', 'warn');
      }
    }
    if (!this.impl) {
      FlatRenderer.init(this.el, Geo.features);
      this.impl = FlatRenderer;
      this.mode = 'flat';
    }
    this.refresh(true);
    return this.mode;
  },

  resize() { this.impl && this.impl.resize(); },

  // Перекраска откладывается до следующего кадра, чтобы десяток изменений за такт дали одну перерисовку
  refresh(force) {
    if (!this.impl) return;
    const wait = this.holdUntil - performance.now();
    if (wait > 0 && !force) {
      if (!this.pending) {
        this.pending = true;
        setTimeout(() => { this.pending = false; this.refresh(); }, wait + 20);
      }
      return;
    }
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      try { this.impl.refresh(); } catch (e) { console.error('[Map] refresh', e); }
    });
  },

  hold(ms) { this.holdUntil = performance.now() + ms; },

  setHovered(id) {
    if (this.hovered === id) return;
    this.hovered = id;
    this.impl && this.impl.refreshPolygons();
  },

  setSelected(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.impl && this.impl.refreshPolygons();
  },

  focus(id) { this.impl && Geo.meta[id] && this.impl.focus(id); },

  setSelectedArmy(id) {
    this.selectedArmy = id;
    this.impl && this.impl.refreshPolygons();
    this.refreshArmies(true);
  },

  // Фишки армий и линии фронта обновляются каждый игровой день, но не чаще 4 раз в секунду
  refreshArmies(force) {
    if (!this.impl) return;
    const now = performance.now();
    if (!force && now - (this.lastArmies || 0) < 250) return;
    this.lastArmies = now;
    try { this.impl.refreshOverlays(); } catch (e) { console.error('[Map] armies', e); }
  },

  // Земли, куда выбранная армия может наступать (соседи, с которыми война)
  armyTargets() {
    const a = this.selectedArmy && Game.army(this.selectedArmy, Game.me);
    if (!a) return null;
    return new Set((Geo.meta[a.loc] || { neighbors: [] }).neighbors.filter(n => Game.atWar(Game.c(n), Game.me)));
  },

  /* ---- Единая логика стиля страны для обоих рендереров ---- */
  style(id) {
    const c = Game.S && Game.c(id);
    if (!c) return { cap: '#33404d', side: '#1a2129', stroke: 'rgba(255,255,255,0.15)', alt: 0.005 };
    const hov = id === this.hovered, sel = id === this.selected;
    const me = Game.me;
    const front = Game.atWar(c, me);
    let base, side, stroke;
    if (c.radioactive) { base = COLORS.waste; side = '#1c2208'; stroke = COLORS.wasteStroke; }
    else if (front) { base = COLORS.front; side = '#5a2a08'; stroke = COLORS.frontStroke; }
    else if (this.layer === 'ide' && !c.inert && Game.gov(c)) { base = IDEOLOGIES[Game.gov(c).ide].color; side = U.shade(base, -0.55); stroke = '#ffffff'; }
    else if (Game.isPower(c.ctrl)) { const D = POWERS[c.ctrl]; base = D.color; side = D.side; stroke = D.stroke; }
    else { const F = FACTIONS[c.faction] || FACTIONS.NEU; base = F.color; side = F.side; stroke = F.stroke; }

    let cap = base;
    if (front && (hov || sel)) cap = COLORS.frontHi;
    else if (sel) cap = U.shade(base, 0.35);
    else if (hov) cap = U.shade(base, 0.22);

    let strokeColor = U.rgba(stroke, 0.55);
    if (c.cb[me]) strokeColor = COLORS.justify;
    const targets = this.armyTargetsCache;
    const target = targets && targets.has(id);
    if (target) strokeColor = '#ffe14d';
    if (sel) strokeColor = COLORS.selected;

    const alt = 0.006 + (Game.isPower(c.ctrl) ? 0.004 : 0) + (front ? 0.006 : 0) + (hov ? 0.008 : 0) + (sel ? 0.016 : 0) + (target ? 0.006 : 0);
    return { cap, capA: U.rgba(cap, 0.93), side: U.rgba(side, 0.9), stroke: strokeColor, alt };
  },

  /* ---- Названия стран, как в HOI4 ----
     Независимая страна — своё имя; столица державы — имя державы крупно;
     присоединённые и оккупированные земли — своё имя мельче и бледнее.
     base — «размер» подписи в градусах карты (растёт с площадью страны). */
  labelCache: new Map(),
  labels() {
    if (!Game.S) return [];
    const out = [];
    Game.eachCountry(c => {
      const m = Geo.meta[c.id];
      if (!m || c.inert) return;
      const tag = Game.isPower(c.ctrl) ? c.ctrl : null;
      const main = c.ctrl === c.id || (tag && POWERS[tag].capital === c.id);
      const text = tag && main ? POWERS[tag].name : c.name;
      // У державы подпись крупнее: учитываем все её земли
      // Площадь в «градусах» на высоких широтах завышена — поправка на косинус широты
      const real = l => { const g = Geo.meta[l.id] || Geo.meta[l]; return g ? g.area * Math.cos(g.centroid.lat * Math.PI / 180) : 0; };
      const area = tag && main ? Game.lands(tag).reduce((s, l) => s + real(l), 0) * 0.7 + real(c) * 0.3 : real(c);
      const base = Math.min(7.5, Math.sqrt(Math.max(0.3, area)) * 0.3) * (main ? 1 : 0.7);
      const bb = m.bbox, dy = Math.min(3, (bb[3] - bb[1]) * 0.12);
      let d = this.labelCache.get(c.id);
      if (!d) { d = { key: 'lbl-' + c.id, kind: 'label', id: c.id }; this.labelCache.set(c.id, d); }
      d.text = text; d.base = base; d.sub = !main; d.lat = m.centroid.lat + dy; d.lng = m.centroid.lng;
      out.push(d);
    });
    return out;
  },

  /* ---- Метки на карте ---- */
  markers() {
    const out = [];
    if (!Game.S) return out;
    const me = Game.me;
    for (const tag of Game.tags()) {
      const D = POWERS[tag], cap = Game.c(D.capital);
      if (cap && cap.ctrl === tag) out.push({ key: 'capital-' + tag, kind: tag === me ? 'capital' : 'capital-other', icon: 'i-pp', ...D.capitalPos, label: D.capitalName });
    }
    Game.eachCountry(c => {
      const m = Geo.meta[c.id];
      if (!m) return;
      const pos = m.centroid;
      if (c.radioactive) out.push({ key: 'rad-' + c.id, kind: 'rad', icon: 'i-nuke', lat: pos.lat, lng: pos.lng });
      else if (Game.atWar(c, me)) out.push({ key: 'war-' + c.id, kind: 'war', icon: 'i-swords', lat: pos.lat, lng: pos.lng });
      else if (c.cb[me] === true) out.push({ key: 'cb-' + c.id, kind: 'cb', icon: 'i-flag', lat: pos.lat, lng: pos.lng });
      else if (c.cb[me] || (c.influence && c.influence.by === me) || (c.integrate && c.integrate.by === me)) out.push({ key: 'prj-' + c.id, kind: 'prj', icon: c.cb[me] ? 'i-flag' : 'i-pp', lat: pos.lat, lng: pos.lng });
    });
    return out;
  },

  /* ---- Стрелки наступлений: от фишки армии к цели ---- */
  frontArcs() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    for (const a of Game.armies(Game.me)) {
      if (a.order.type !== 'attack') continue;
      const from = this.armyPos(a, Game.me), to = Geo.meta[a.order.target] && Geo.meta[a.order.target].centroid;
      if (!from || !to) continue;
      const sel = a.id === this.selectedArmy;
      out.push({
        sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng,
        color: ['rgba(255,60,40,0.95)', 'rgba(255,215,90,1)'], stroke: sel ? 0.45 : 0.3, dash: 0.4, gap: 0.12, time: 1100, init: 0
      });
    }
    return out;
  },

  /* ---- Линия фронта: участки границы между нашими землями и врагом ---- */
  frontLines() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    const me = Game.me;
    const attacking = new Set(Game.armies(me).filter(a => a.order.type === 'attack').map(a => a.loc + '>' + a.order.target));
    for (const c of Game.lands(me)) {
      for (const n of (Geo.meta[c.id] || { neighbors: [] }).neighbors) {
        const e = Game.c(n);
        if (!e || !Game.atWar(e, me)) continue;
        const hot = attacking.has(c.id + '>' + n);
        for (const pts of Geo.borderLines(c.id, n)) {
          out.push({ pts, color: hot ? ['#ffe14d', '#ff2d1f'] : ['#ff1f1f', '#b30000'], w: hot ? 4.5 : 3,
            dash: pts.sea ? 0.03 : 1, gap: pts.sea ? 0.02 : 0, time: pts.sea ? 0 : 0 });
        }
      }
    }
    return out;
  },

  /* ---- Маршруты армий на марше ---- */
  movePaths() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    for (const a of Game.armies(Game.me)) {
      if (a.order.type !== 'move' || !a.order.path.length) continue;
      const pts = [this.armyPos(a, Game.me)].concat(a.order.path.map(id => Geo.meta[id].centroid)).map(p => [p.lat, p.lng]);
      out.push({ pts, color: ['rgba(255,255,255,0.9)', 'rgba(160,220,255,0.9)'], w: 2, dash: 0.02, gap: 0.015, time: 4000 });
    }
    return out;
  },

  /* ---- Где на карте стоит фишка армии ---- */
  armyPos(a, tag) {
    const loc = a.loc;
    if (a.order.type === 'attack') return Geo.frontAnchor(loc, a.order.target, 0.25);
    // В обороне: у границы с ближайшим врагом, иначе в центре земли
    const enemy = (Geo.meta[loc] || { neighbors: [] }).neighbors.find(n => Game.atWar(Game.c(n), tag));
    if (enemy) return Geo.frontAnchor(loc, enemy, 0.3);
    return Geo.meta[loc] && Geo.meta[loc].centroid;
  },

  /* ---- Фишки армий: свои (кликабельные) и армии других игроков у наших границ ---- */
  armyMarkers() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    const me = Game.me, stack = {};
    for (const tag of Game.tags()) {
      for (const a of Game.armies(tag)) {
        const mine = tag === me;
        if (!mine) {
          // Чужую армию видно, только если она стоит у наших границ или на нашей земле
          const loc = Game.c(a.loc);
          if (!loc || !(Game.bordersPower(a.loc, me) || loc.ctrl === me)) continue;
        }
        const p = this.armyPos(a, tag);
        if (!p) continue;
        const k = Math.round(p.lat * 2) + ':' + Math.round(p.lng * 2);
        const i = stack[k] = (stack[k] || 0) + 1;
        const intel = mine ? 100 : Game.intel(Game.c(a.loc), me);
        out.push({
          key: 'army-' + a.id, kind: 'army', id: a.id, tag, mine,
          lat: p.lat - (i - 1) * 1.1, lng: p.lng,
          divs: mine || intel >= 80 ? String(Math.round(a.divs)) : '~' + Math.max(5, Math.round(a.divs / 5) * 5),
          org: a.org, name: a.name, order: a.order.type, sel: a.id === this.selectedArmy
        });
      }
    }
    return out;
  },

  // Откуда рисовать дугу удара: от ближайшей нашей территории, но не дальше 12° —
  // иначе дуга к Финляндии тянулась бы из центра Сибири (центр огромной РСФСР)
  sourceFor(targetId, tag = Game.me) {
    const home = POWERS[tag] ? POWERS[tag].capitalPos : CFG.CAPITAL_POS;
    const meta = Geo.meta[targetId];
    if (!meta) return home;
    const to = meta.centroid;
    const nb = meta.neighbors.map(n => Game.c(n)).filter(c => c && c.ctrl === tag);
    if (!nb.length) return home;
    let best = null, bestD = Infinity;
    for (const c of nb) {
      const d = Geo.arcDistance(to, Geo.meta[c.id].centroid);
      if (d < bestD) { bestD = d; best = Geo.meta[c.id].centroid; }
    }
    const MAX = 12;
    if (bestD <= MAX) return best;
    let dl = best.lng - to.lng;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    const t = MAX / bestD;
    let lng = to.lng + dl * t;
    if (lng > 180) lng -= 360;
    if (lng < -180) lng += 360;
    return { lat: to.lat + (best.lat - to.lat) * t, lng };
  },

  /* ---- Эффекты ---- */
  fxBattle(targetId, success, tag) { this.impl && this.impl.fxBattle(targetId, success, tag); },
  fxEnemyAttack(srcId, targetId, success) { this.impl && this.impl.fxEnemyAttack(srcId, targetId, success); },
  fxNuke(targetId, fromPos) {
    this.hold(1900);
    this.impl && this.impl.fxNuke(targetId, fromPos || POWERS[Game.me].capitalPos);
  }
};

/* ============================================================
   3D-ГЛОБУС
   ============================================================ */
const GlobeRenderer = {
  g: null,
  el: null,
  tempArcs: [],
  tempRings: [],
  markerEls: new Map(),

  init(el, features) {
    this.el = el;
    const g = new Globe(el, {
      animateIn: true,
      waitForGlobeReady: false,
      rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' }
    });
    this.g = g;
    const id = f => f.properties.id;

    g.backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#3f86e0')
      .atmosphereAltitude(0.19)
      .showGraticules(true)
      .polygonsData(features)
      .polygonCapCurvatureResolution(4)
      .polygonsTransitionDuration(280)
      .polygonLabel(() => '')
      .onPolygonHover(f => MapView.onHover(f ? id(f) : null))
      .onPolygonClick(f => MapView.onClick(id(f)))
      .onGlobeClick(() => MapView.onClick(null))
      .onPolygonRightClick(f => MapView.onRight(id(f)))
      .pathPoints('pts').pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathPointAlt(0.013)
      .pathColor('color').pathStroke('w').pathDashLength('dash').pathDashGap('gap').pathDashAnimateTime('time')
      .pathTransitionDuration(0)
      .arcStartLat('sLat').arcStartLng('sLng').arcEndLat('eLat').arcEndLng('eLng')
      .arcColor('color').arcStroke('stroke')
      .arcDashLength('dash').arcDashGap('gap').arcDashInitialGap('init').arcDashAnimateTime('time')
      .arcAltitudeAutoScale(0.38)
      .arcsTransitionDuration(0)
      .ringLat('lat').ringLng('lng').ringColor('color')
      .ringMaxRadius('maxR').ringPropagationSpeed('speed').ringRepeatPeriod('period')
      .htmlLat('lat').htmlLng('lng').htmlAltitude(0.02)
      .htmlTransitionDuration(0)
      .htmlElement(d => this.markerEl(d));

    // Тёмный «тактический» океан вместо текстуры — никаких внешних картинок
    const mat = g.globeMaterial();
    if (mat.color) mat.color.set('#0a1a2c');
    if (mat.emissive) { mat.emissive.set('#061424'); mat.emissiveIntensity = 0.6; }
    if (mat.specular) mat.specular.set('#1e4066');
    if ('shininess' in mat) mat.shininess = 14;

    const controls = g.controls();
    controls.minDistance = 125;
    controls.maxDistance = 650;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.8;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    // При зуме подписи меняют размер (не чаще раза за кадр)
    // Камера может лететь сама (переход к стране) — раз в 300 мс сверяем положение
    this.lblTimer = setInterval(() => {
      if (!this.g) return;
      const p = this.g.pointOfView(), k = p.lat.toFixed(1) + p.lng.toFixed(1) + p.altitude.toFixed(2);
      if (k !== this.lblKey) { this.lblKey = k; this.scaleLabels(); }
    }, 300);
    controls.addEventListener('change', () => {
      if (this.lblRaf) return;
      this.lblRaf = requestAnimationFrame(() => { this.lblRaf = 0; this.scaleLabels(); });
    });

    g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    g.renderer().domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      Bus.emit('toast', 'Видеокарта сбросила 3D-контекст — переключаемся на 2D-карту', 'warn');
      setTimeout(() => MapView.setMode('flat'), 50);
    });

    if (window.THREE) this.addStars();
    g.pointOfView({ lat: 48, lng: 55, altitude: 2.35 }, 0);
    this.resize();
  },

  destroy() {
    clearInterval(this.lblTimer);
    try { this.g.pauseAnimation(); } catch (e) { /* уже остановлен */ }
    try { this.g._destructor(); } catch (e) { /* в старых версиях метода может не быть */ }
    this.g = null;
    this.markerEls.clear();
    this.tempArcs = [];
    this.tempRings = [];
  },

  resize() {
    if (!this.g) return;
    this.g.width(this.el.clientWidth).height(this.el.clientHeight);
  },

  refresh() {
    this.refreshPolygons();
    this.refreshOverlays();
  },

  refreshPolygons() {
    if (!this.g) return;
    this.labelData = MapView.labels();
    MapView.armyTargetsCache = MapView.armyTargets();
    const st = f => MapView.style(f.properties.id);
    this.g.polygonCapColor(f => st(f).capA)
      .polygonSideColor(f => st(f).side)
      .polygonStrokeColor(f => st(f).stroke)
      .polygonAltitude(f => st(f).alt);
  },

  refreshOverlays() {
    if (!this.g) return;
    this.g.arcsData(MapView.frontArcs().concat(this.tempArcs));
    this.g.pathsData(MapView.frontLines().concat(MapView.movePaths()));
    this.g.ringsData(this.tempRings.slice());
    this.g.htmlElementsData(this.labelData.concat(MapView.markers(), MapView.armyMarkers()));
    this.scaleLabels();
  },
  labelData: [],

  // Размер подписи в пикселях: градусы × пикселей на градус при текущей высоте камеры
  scaleLabels() {
    if (!this.g) return;
    const alt = this.g.pointOfView().altitude;
    this.ppd = 0.0194 * this.el.clientHeight / (1 + alt);
    this.pov = this.g.pointOfView();
    for (const d of this.labelData) {
      const el = this.markerEls.get(d.key);
      if (el) this.sizeLabel(el, d);
    }
  },
  sizeLabel(el, d) {
    const px = Math.min(40, d.base * (this.ppd || 4));
    const span = el.firstChild;
    // Обратная сторона глобуса и край диска — подпись прячем
    const v = this.pov || { lat: 0, lng: 0 }, r = Math.PI / 180;
    const cosAng = Math.sin(d.lat * r) * Math.sin(v.lat * r) + Math.cos(d.lat * r) * Math.cos(v.lat * r) * Math.cos((d.lng - v.lng) * r);
    if (px < 9 || cosAng < 0.3) { span.style.display = 'none'; return; }
    span.style.display = '';
    span.style.opacity = cosAng < 0.5 ? ((cosAng - 0.3) / 0.2).toFixed(2) : '';
    span.style.fontSize = px.toFixed(1) + 'px';
    span.style.letterSpacing = px > 22 ? '0.2em' : px > 14 ? '0.12em' : '0.05em';
  },

  labelEl(d) {
    let el = this.markerEls.get(d.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'gl-lbl';
      el.appendChild(document.createElement('span'));
      this.markerEls.set(d.key, el);
    }
    el.classList.toggle('sub', d.sub);
    if (el.firstChild.textContent !== d.text) el.firstChild.textContent = d.text;
    this.sizeLabel(el, d);
    return el;
  },

  markerEl(d) {
    if (d.kind === 'army') return this.armyEl(d);
    if (d.kind === 'label') return this.labelEl(d);
    let el = this.markerEls.get(d.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'gm gm-' + d.kind;
      el.innerHTML = `<svg><use href="#${d.icon}"/></svg>`;
      this.markerEls.set(d.key, el);
    }
    return el;
  },

  // Фишка армии (как в HOI4): знак НАТО, число дивизий, полоска организации
  armyEl(d) {
    let el = this.markerEls.get(d.key);
    if (!el) {
      el = document.createElement('div');
      el.addEventListener('mousedown', e => e.stopPropagation());
      el.addEventListener('click', e => { e.stopPropagation(); MapView.onArmy(el.dataset.id, el.dataset.tag); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
      this.markerEls.set(d.key, el);
    }
    fillArmyEl(el, d);
    return el;
  },

  focus(id) {
    const m = Geo.meta[id];
    const cur = this.g.pointOfView();
    let alt = cur.altitude;
    if (alt < 0.9 || alt > 2.8) alt = U.clamp(0.6 + Math.sqrt(m.area) / 22, 0.95, 2.2);
    this.g.pointOfView({ lat: m.centroid.lat, lng: m.centroid.lng, altitude: alt }, 900);
  },

  addStars() {
    const THREE = window.THREE;
    const n = 2600;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const r = 1500 + Math.random() * 1500;
      pos[i * 3] = r * s * Math.cos(th);
      pos[i * 3 + 1] = r * u;
      pos[i * 3 + 2] = r * s * Math.sin(th);
      const k = 0.55 + Math.random() * 0.45, warm = Math.random() < 0.15;
      col[i * 3] = k; col[i * 3 + 1] = k * (warm ? 0.85 : 0.95); col[i * 3 + 2] = k * (warm ? 0.7 : 1.05);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
    this.g.scene().add(new THREE.Points(geom, mat));
  },

  addTempArc(arc, ms) {
    this.tempArcs.push(arc);
    this.refreshOverlays();
    setTimeout(() => {
      this.tempArcs = this.tempArcs.filter(a => a !== arc);
      this.refreshOverlays();
    }, ms);
  },

  addTempRing(ring, ms) {
    this.tempRings.push(ring);
    this.refreshOverlays();
    setTimeout(() => {
      this.tempRings = this.tempRings.filter(r => r !== ring);
      this.refreshOverlays();
    }, ms);
  },

  fxBattle(targetId, success, tag) {
    if (!this.g) return;
    const to = Geo.meta[targetId].centroid, from = MapView.sourceFor(targetId, tag);
    this.addTempArc({ sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng, color: ['rgba(255,60,40,1)', 'rgba(255,240,180,1)'],
      stroke: 1.1, dash: 0.25, gap: 3, init: 1, time: 900 }, 1000);
    const col = success ? [255, 190, 60] : [255, 70, 50];
    this.addTempRing({ lat: to.lat, lng: to.lng, maxR: 5, speed: 4, period: 450, color: t => `rgba(${col},${(1 - t) * 0.9})` }, 2600);
  },

  fxEnemyAttack(srcId, targetId, success) {
    if (!this.g) return;
    const from = Geo.meta[srcId].centroid, to = Geo.meta[targetId].centroid;
    this.addTempArc({ sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng, color: ['rgba(120,160,255,1)', 'rgba(255,60,60,1)'],
      stroke: 0.9, dash: 0.25, gap: 3, init: 1, time: 1000 }, 1100);
    this.addTempRing({ lat: to.lat, lng: to.lng, maxR: 4, speed: 3, period: 500,
      color: t => `rgba(${success ? '255,50,50' : '120,170,255'},${(1 - t) * 0.85})` }, 2200);
  },

  fxNuke(targetId, from) {
    if (!this.g) return;
    const to = Geo.meta[targetId].centroid;
    this.addTempArc({ sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng, color: ['rgba(255,255,255,1)', 'rgba(255,90,40,1)'],
      stroke: 1.4, dash: 0.18, gap: 3, init: 1, time: 1700 }, 1750);
    setTimeout(() => {
      if (!this.g) return;
      this.addTempRing({ lat: to.lat, lng: to.lng, maxR: 14, speed: 7, period: 380, color: t => `rgba(255,${Math.round(240 - 160 * t)},${Math.round(200 - 180 * t)},${1 - t})` }, 4200);
      this.addTempRing({ lat: to.lat, lng: to.lng, maxR: 22, speed: 5, period: 1400, color: t => `rgba(255,255,255,${(1 - t) * 0.6})` }, 3000);
      this.mushroom(to.lat, to.lng);
    }, 1700);
  },

  /* Ядерный гриб из примитивов Three.js: огненный шар, ствол, шапка, ударная волна и вспышка света */
  mushroom(lat, lng) {
    const THREE = window.THREE;
    if (!THREE || !this.g) return;
    const scene = this.g.scene();
    const p = this.g.getCoords(lat, lng, 0.004);
    const normal = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const group = new THREE.Group();
    group.position.set(p.x, p.y, p.z);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

    const mk = (geo, color, extra = {}) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, ...extra }));
    const fireball = mk(new THREE.SphereGeometry(1, 24, 16), 0xfff4d0, { blending: THREE.AdditiveBlending });
    const stem = mk(new THREE.CylinderGeometry(0.45, 1.0, 1, 18, 1, true), 0xff8a3d, { side: THREE.DoubleSide });
    const cap = mk(new THREE.SphereGeometry(1, 28, 18), 0xff7a2a);
    const skirt = mk(new THREE.TorusGeometry(1, 0.35, 12, 36), 0xffa050);
    const shock = mk(new THREE.RingGeometry(0.85, 1, 64), 0xffffff, { side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    shock.rotation.x = -Math.PI / 2;
    skirt.rotation.x = -Math.PI / 2;
    const light = new THREE.PointLight(0xffb066, 0, 90, 0);
    light.position.set(0, 4, 0);
    group.add(fireball, stem, cap, skirt, shock, light);
    scene.add(group);

    const t0 = performance.now(), DUR = 6500;
    const hot = new THREE.Color(0xff7a2a), cold = new THREE.Color(0x4d4038);
    const tick = () => {
      const t = (performance.now() - t0) / DUR;
      if (t >= 1 || !this.g) {
        scene.remove(group);
        group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        return;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, t / 0.45), 3);
      const fade = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
      const h = 9 * grow;

      fireball.scale.setScalar(t < 0.12 ? 4 * (t / 0.12) : 4 * Math.max(0, 1 - (t - 0.12) / 0.25));
      fireball.material.opacity = Math.max(0, 1 - t / 0.35);

      stem.scale.set(1 + grow * 0.4, Math.max(0.01, h), 1 + grow * 0.4);
      stem.position.y = h / 2;
      stem.material.opacity = 0.85 * fade;

      const r = 1.5 + 3.2 * grow;
      cap.scale.set(r, r * 0.6, r);
      cap.position.y = h + r * 0.15;
      cap.material.color.copy(hot).lerp(cold, U.clamp((t - 0.15) / 0.6, 0, 1));
      cap.material.opacity = 0.95 * fade;
      skirt.scale.setScalar(r * 0.9);
      skirt.position.y = h * 0.7;
      skirt.material.color.copy(cap.material.color);
      skirt.material.opacity = 0.6 * fade;

      shock.scale.setScalar(1 + 22 * Math.min(1, t / 0.5));
      shock.material.opacity = Math.max(0, 0.9 * (1 - t / 0.5));
      light.intensity = t < 0.08 ? 40 * (t / 0.08) : 40 * Math.max(0, 1 - (t - 0.08) / 0.4);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
};

/* ============================================================
   2D-КАРТА (равнопромежуточная проекция на Canvas)
   ============================================================ */
const FlatRenderer = {
  W0: 2000, H0: 1000,
  canvas: null, ctx: null, el: null,
  shapes: [],
  view: { scale: 1, tx: 0, ty: 0 },
  effects: [],
  dirty: true,
  raf: 0,
  drag: null,
  listeners: [],

  init(el, features) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'flat-canvas';
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.shapes = features.map(f => {
      const path = new Path2D();
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          ring.forEach(([x, y], i) => {
            const [px, py] = this.proj(x, y);
            if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
          });
          path.closePath();
        }
      }
      return { id: f.properties.id, path };
    });
    this.bind();
    this.resize();
    const c = this.proj(70, 50);
    this.view.scale = Math.max(this.el.clientWidth / this.W0, this.el.clientHeight / this.H0) * 1.6;
    this.view.tx = this.el.clientWidth / 2 - c[0] * this.view.scale;
    this.view.ty = this.el.clientHeight / 2 - c[1] * this.view.scale;
    this.clampView();
    this.loop();
  },

  destroy() {
    cancelAnimationFrame(this.raf);
    this.listeners.forEach(([t, e, f]) => t.removeEventListener(e, f));
    this.listeners = [];
    this.effects = [];
  },

  on(target, evt, fn, opts) {
    target.addEventListener(evt, fn, opts);
    this.listeners.push([target, evt, fn]);
  },

  proj(lng, lat) { return [(lng + 180) / 360 * this.W0, (90 - lat) / 180 * this.H0]; },
  toScreen(lng, lat) {
    const [x, y] = this.proj(lng, lat);
    return [x * this.view.scale + this.view.tx, y * this.view.scale + this.view.ty];
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.el.clientWidth * dpr);
    this.canvas.height = Math.round(this.el.clientHeight * dpr);
    this.canvas.style.width = this.el.clientWidth + 'px';
    this.canvas.style.height = this.el.clientHeight + 'px';
    this.clampView();
    this.dirty = true;
  },

  clampView() {
    const v = this.view, w = this.el.clientWidth, h = this.el.clientHeight;
    const minScale = Math.max(w / this.W0, h / this.H0);
    v.scale = U.clamp(v.scale, minScale, minScale * 9);
    v.tx = U.clamp(v.tx, w - this.W0 * v.scale, 0);
    v.ty = U.clamp(v.ty, h - this.H0 * v.scale, 0);
  },

  bind() {
    const cv = this.canvas;
    this.on(cv, 'mousedown', e => { this.drag = { x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty, moved: false }; });
    this.on(window, 'mousemove', e => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        this.view.tx = this.drag.tx + dx;
        this.view.ty = this.drag.ty + dy;
        this.clampView();
        this.dirty = true;
      } else if (e.target === cv) {
        MapView.onHover(this.hit(e));
      }
    });
    this.on(window, 'mouseup', e => {
      if (this.drag && !this.drag.moved && e.target === cv) {
        const army = this.hitArmy(e);
        if (army) MapView.onArmy(army.id, army.tag);
        else MapView.onClick(this.hit(e));
      }
      this.drag = null;
    });
    this.on(cv, 'mouseleave', () => { if (!this.drag) MapView.onHover(null); });
    this.on(cv, 'contextmenu', e => { e.preventDefault(); const id = this.hit(e); if (id) MapView.onRight(id); });
    this.on(cv, 'wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * 0.0015);
      const v = this.view, old = v.scale;
      v.scale *= k;
      this.clampView();
      const real = v.scale / old;
      v.tx = mx - (mx - v.tx) * real;
      v.ty = my - (my - v.ty) * real;
      this.clampView();
      this.dirty = true;
    }, { passive: false });
  },

  hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr;
    const v = this.view, ctx = this.ctx;
    ctx.setTransform(v.scale * this.dpr, 0, 0, v.scale * this.dpr, v.tx * this.dpr, v.ty * this.dpr);
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (ctx.isPointInPath(this.shapes[i].path, x, y)) return this.shapes[i].id;
    }
    return null;
  },

  refresh() { this.dirty = true; },
  refreshPolygons() { MapView.armyTargetsCache = MapView.armyTargets(); this.labelDirty = true; this.dirty = true; },
  refreshOverlays() { this.dirty = true; },
  hitArmy(e) {
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return (this.armyBoxes || []).find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  },

  focus(id) {
    const m = Geo.meta[id];
    const [x, y] = this.proj(m.centroid.lng, m.centroid.lat);
    const v = this.view, w = this.el.clientWidth, h = this.el.clientHeight;
    const from = { tx: v.tx, ty: v.ty };
    const to = { tx: w / 2 - x * v.scale, ty: h / 2 - y * v.scale };
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 600), e = 1 - Math.pow(1 - t, 3);
      v.tx = U.lerp(from.tx, to.tx, e);
      v.ty = U.lerp(from.ty, to.ty, e);
      this.clampView();
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    const animated = this.effects.length > 0 || (Game.S && Game.fronts(Game.me).length > 0);
    const now = performance.now();
    if (!this.dirty && !(animated && now - (this.lastDraw || 0) > 33)) return;
    this.lastDraw = now;
    this.dirty = false;
    this.draw(now);
  },

  draw(now) {
    const ctx = this.ctx, v = this.view, dpr = this.dpr;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    grad.addColorStop(0, '#0c1e33');
    grad.addColorStop(1, '#040a12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.tx * dpr, v.ty * dpr);
    // Координатная сетка
    ctx.strokeStyle = 'rgba(120,170,220,0.09)';
    ctx.lineWidth = 1 / v.scale;
    ctx.beginPath();
    for (let lng = -180; lng <= 180; lng += 15) { const [x] = this.proj(lng, 0); ctx.moveTo(x, 0); ctx.lineTo(x, this.H0); }
    for (let lat = -90; lat <= 90; lat += 15) { const [, y] = this.proj(0, lat); ctx.moveTo(0, y); ctx.lineTo(this.W0, y); }
    ctx.stroke();

    // Страны
    ctx.lineJoin = 'round';
    for (const s of this.shapes) {
      const st = MapView.style(s.id);
      ctx.fillStyle = st.cap;
      ctx.fill(s.path);
    }
    for (const s of this.shapes) {
      const st = MapView.style(s.id);
      const strong = s.id === MapView.selected || s.id === MapView.hovered;
      ctx.lineWidth = (strong ? 2 : 0.8) / v.scale;
      ctx.strokeStyle = st.stroke;
      ctx.stroke(s.path);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(ctx);
    this.drawFrontLines(ctx, now);
    this.drawArcs(ctx, now);
    this.drawMarkers(ctx);
    this.drawArmies(ctx);
    this.drawEffects(ctx, now);
  },

  curve(a, b) {
    const [x1, y1] = this.toScreen(a.lng, a.lat), [x2, y2] = this.toScreen(b.lng, b.lat);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.25;
    return { x1, y1, x2, y2, mx, my };
  },

  drawArcs(ctx, now) {
    for (const a of MapView.frontArcs()) {
      const c = this.curve({ lat: a.sLat, lng: a.sLng }, { lat: a.eLat, lng: a.eLng });
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -(now / 40) % 16;
      ctx.strokeStyle = 'rgba(255,150,60,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      ctx.quadraticCurveTo(c.mx, c.my, c.x2, c.y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  },

  drawFrontLines(ctx, now) {
    for (const l of MapView.frontLines().concat(MapView.movePaths())) {
      ctx.beginPath();
      l.pts.forEach(([lat, lng], i) => { const [x, y] = this.toScreen(lng, lat); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      const move = l.w < 2.5;
      ctx.setLineDash(move || l.pts.sea ? [6, 5] : []);
      ctx.lineDashOffset = move ? -(now / 60) % 11 : 0;
      ctx.strokeStyle = Array.isArray(l.color) ? l.color[0] : l.color;
      ctx.lineWidth = move ? 2 : l.w > 4 ? 4 : 3;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  },

  drawArmies(ctx) {
    this.armyBoxes = [];
    ctx.font = '700 11px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const d of MapView.armyMarkers()) {
      const [cx, cy] = this.toScreen(d.lng, d.lat);
      const w = 46, h = 22, x = cx - w / 2, y = cy - h / 2;
      ctx.fillStyle = d.sel ? '#ffe680' : POWERS[d.tag].color;
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = 'rgba(6,10,16,0.92)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = POWERS[d.tag].stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 3, y + 4, 14, 10);
      ctx.beginPath(); ctx.moveTo(x + 3, y + 4); ctx.lineTo(x + 17, y + 14); ctx.moveTo(x + 17, y + 4); ctx.lineTo(x + 3, y + 14); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(d.divs, x + 21, y + 9);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + 2, y + h - 4, w - 4, 2);
      ctx.fillStyle = d.org < 35 ? '#f08a24' : '#4fc97a';
      ctx.fillRect(x + 2, y + h - 4, (w - 4) * d.org / 100, 2);
      if (d.mine) this.armyBoxes.push({ x, y, w, h, id: d.id, tag: d.tag });
    }
  },

  drawLabels(ctx) {
    if (!this.labelData || this.labelDirty !== false) { this.labelData = MapView.labels(); this.labelDirty = false; }
    const ppd = this.view.scale * this.W0 / 360;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const d of this.labelData) {
      const px = Math.min(40, d.base * ppd);
      if (px < 9) continue;
      const [x, y] = this.toScreen(d.lng, d.lat);
      const sp = px > 22 ? 0.2 : px > 14 ? 0.12 : 0.05;
      ctx.font = `${d.sub ? 500 : 700} ${px.toFixed(1)}px "Bahnschrift", "Segoe UI", sans-serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = (px * sp).toFixed(1) + 'px';
      const t = d.text.toUpperCase();
      ctx.lineWidth = Math.max(2, px / 5);
      ctx.strokeStyle = 'rgba(4,8,14,0.75)';
      ctx.strokeText(t, x, y);
      ctx.fillStyle = d.sub ? 'rgba(225,232,240,0.55)' : 'rgba(245,248,252,0.9)';
      ctx.fillText(t, x, y);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  },

  drawMarkers(ctx) {
    const colors = { capital: '#ffd34d', 'capital-other': '#c9d2da', war: '#ffb347', rad: '#c8f04a', cb: '#ffd34d', prj: '#e8e8e8' };
    ctx.font = '600 13px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = { capital: '★', 'capital-other': '★', war: '⚔', rad: '☢', cb: '⚑', prj: '⌛' };
    for (const m of MapView.markers()) {
      const [x, y] = this.toScreen(m.lng, m.lat);
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6,10,16,0.82)';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = colors[m.kind];
      ctx.stroke();
      ctx.fillStyle = colors[m.kind];
      ctx.fillText(glyph[m.kind], x, y + 1);
    }
  },

  drawEffects(ctx, now) {
    this.effects = this.effects.filter(fx => now - fx.t0 < fx.dur);
    for (const fx of this.effects) {
      const t = (now - fx.t0) / fx.dur;
      if (t < 0) continue;   // эффект ещё не начался (например, взрыв ждёт подлёта ракеты)
      if (fx.type === 'ring') {
        const [x, y] = this.toScreen(fx.lng, fx.lat);
        for (let k = 0; k < 3; k++) {
          const tt = (t * 2 + k / 3) % 1;
          ctx.beginPath();
          ctx.arc(x, y, fx.r * tt, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${fx.rgb},${(1 - tt) * (1 - t)})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      } else if (fx.type === 'arc') {
        const c = this.curve(fx.from, fx.to);
        const e = Math.min(1, t * 1.15);
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = fx.width;
        ctx.beginPath();
        ctx.moveTo(c.x1, c.y1);
        const steps = 30;
        for (let i = 1; i <= steps * e; i++) {
          const s = i / steps;
          const x = (1 - s) * (1 - s) * c.x1 + 2 * (1 - s) * s * c.mx + s * s * c.x2;
          const y = (1 - s) * (1 - s) * c.y1 + 2 * (1 - s) * s * c.my + s * s * c.y2;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (fx.type === 'blast') {
        const [x, y] = this.toScreen(fx.lng, fx.lat);
        const r = 10 + 90 * Math.sqrt(t);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,230,${1 - t})`);
        g.addColorStop(0.4, `rgba(255,150,50,${(1 - t) * 0.8})`);
        g.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  addFx(fx) { fx.t0 = fx.t0 || performance.now(); this.effects.push(fx); this.dirty = true; },

  fxBattle(targetId, success, tag) {
    const to = Geo.meta[targetId].centroid, from = MapView.sourceFor(targetId, tag);
    this.addFx({ type: 'arc', from, to, color: 'rgba(255,90,60,0.95)', width: 3, dur: 900 });
    this.addFx({ type: 'ring', lat: to.lat, lng: to.lng, r: 46, rgb: success ? '255,190,60' : '255,70,50', dur: 2200 });
  },

  fxEnemyAttack(srcId, targetId, success) {
    const from = Geo.meta[srcId].centroid, to = Geo.meta[targetId].centroid;
    this.addFx({ type: 'arc', from, to, color: 'rgba(130,170,255,0.95)', width: 2.5, dur: 1000 });
    this.addFx({ type: 'ring', lat: to.lat, lng: to.lng, r: 36, rgb: success ? '255,50,50' : '120,170,255', dur: 2000 });
  },

  fxNuke(targetId, from) {
    const to = Geo.meta[targetId].centroid;
    this.addFx({ type: 'arc', from, to, color: 'rgba(255,255,255,0.95)', width: 3, dur: 1700 });
    const t0 = performance.now() + 1700;
    this.addFx({ type: 'blast', lat: to.lat, lng: to.lng, dur: 3500, t0 });
    this.addFx({ type: 'ring', lat: to.lat, lng: to.lng, r: 120, rgb: '255,220,160', dur: 3500, t0 });
  }
};

// Содержимое фишки армии: знак пехоты НАТО (прямоугольник с крестом), число дивизий, организация
function fillArmyEl(el, d) {
  el.className = 'army-cnt' + (d.mine ? ' mine' : ' foreign') + (d.sel ? ' sel' : '') +
    (d.order === 'attack' ? ' attacking' : d.order === 'move' ? ' moving' : '');
  el.dataset.id = d.id;
  el.dataset.tag = d.tag;
  el.style.setProperty('--pc', POWERS[d.tag].color);
  el.title = d.name + (d.mine ? '' : ' (' + POWERS[d.tag].name + ')');
  const html = `<svg class="nato" viewBox="0 0 16 11"><rect x=".5" y=".5" width="15" height="10"/><path d="M.5 .5l15 10M15.5 .5l-15 10"/></svg>` +
    `<b>${d.divs}</b><span class="org"><i style="width:${Math.round(d.org)}%"></i></span>`;
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
