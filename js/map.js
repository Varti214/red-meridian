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
        GlobeRenderer.init(this.el, this.regionFeatures());
        this.impl = GlobeRenderer;
        this.mode = 'globe';
      } catch (e) {
        console.error('[Map] 3D-глобус не запустился, переключаемся на 2D:', e);
        this.el.innerHTML = '';
        Bus.emit('toast', '3D-режим недоступен — включена 2D-карта', 'warn');
      }
    }
    if (!this.impl) {
      FlatRenderer.init(this.el, this.regionFeatures());
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

  focus(id) { this.impl && Regions.center(id) && this.impl.focus(id); },

  /* ---- Регионы как многоугольники карты (строятся один раз) ---- */
  regionFeatures() {
    Regions.build();
    if (!this._rf) {
      this._rf = Regions.list.map(r => ({
        type: 'Feature', properties: { id: r.id, cid: r.cid },
        geometry: { type: 'MultiPolygon', coordinates: r.polys.map(p => [p.concat([p[0]])]) }
      }));
    }
    return this._rf;
  },
  // Контуры государств — жирные линии поверх тонких границ регионов
  countryOutlines() {
    if (!this._co) {
      this._co = [];
      for (const f of Geo.features) {
        if (!f.geometry) continue;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const p of polys) {
          const ring = p[0].filter((v, i) => i % 2 === 0 || i === p[0].length - 1);
          this._co.push({ pts: ring.map(([lng, lat]) => [lat, lng]), color: 'rgba(6,9,14,0.7)', w: 1.1, dash: 1, gap: 0, time: 0, outline: true });
        }
      }
    }
    return this._co;
  },

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
    try { this.impl.refreshOverlays(); this.trackLosses(); } catch (e) { console.error('[Map] armies', e); }
  },

  // Регионы, куда выбранная армия может наступать (соседние, с которыми война; у ВДВ — все в радиусе)
  armyTargets() {
    const a = this.selectedArmy && Game.army(this.selectedArmy, Game.me);
    if (!a) return null;
    const set = new Set(Regions.nb(a.loc).filter(n => Game.atWar(Game.r(n), Game.me)));
    if (Game.isAirborne(a)) {
      for (const r of Game.regionList()) if (r.ctrl !== Game.me && Game.atWar(r, Game.me) && Game.airDistance(r, Game.me) <= CFG.AIRBORNE.range) set.add(r.id);
    }
    return set;
  },

  /* ---- Единая логика стиля региона для обоих рендереров ---- */
  style(id) {
    const r = Game.S && Game.r(id);
    if (!r) return { cap: '#33404d', side: '#1a2129', stroke: 'rgba(255,255,255,0.15)', alt: 0.005 };
    const hov = id === this.hovered, sel = id === this.selected;
    const me = Game.me, N = Game.ownerNation(r);
    const front = Game.atWar(r, me);
    let base, side;
    if (r.radioactive) { base = COLORS.waste; side = '#1c2208'; }
    else if (front) { base = COLORS.front; side = '#5a2a08'; }
    else if (this.layer === 'ide' && N && !N.inert && Game.gov(N)) { base = IDEOLOGIES[Game.gov(N).ide].color; side = U.shade(base, -0.55); }
    else if (Game.isPower(r.ctrl)) { const D = POWERS[r.ctrl]; base = D.color; side = D.side; }
    else { const F = FACTIONS[N ? N.faction : 'NEU'] || FACTIONS.NEU; base = F.color; side = F.side; }
    // Оккупированный регион (держит не его страна) — чуть темнее
    const home = Game.c(r.cid);
    if (home && r.ctrl !== home.ctrl && !front && !r.radioactive) base = U.shade(base, -0.14);

    let cap = base;
    if (front && (hov || sel)) cap = COLORS.frontHi;
    else if (sel) cap = U.shade(base, 0.35);
    else if (hov) cap = U.shade(base, 0.22);

    let strokeColor = front ? 'rgba(255,215,140,0.55)' : 'rgba(8,10,14,0.38)';
    if (N && N.cb && N.cb[me]) strokeColor = COLORS.justify;
    const targets = this.armyTargetsCache;
    const target = targets && targets.has(id);
    if (target) strokeColor = '#ffe14d';
    if (sel) strokeColor = COLORS.selected;
    // Регион, который мы требуем в мирном договоре
    if (typeof UI !== 'undefined' && UI.pc && UI.pc.sel.has(id)) { cap = U.shade(POWERS[me].color, 0.12); strokeColor = '#ffe680'; }

    const alt = 0.006 + (Game.isPower(r.ctrl) ? 0.004 : 0) + (front ? 0.006 : 0) + (hov ? 0.008 : 0) + (sel ? 0.016 : 0) + (target ? 0.006 : 0);
    return { cap, capA: U.rgba(cap, 0.93), side: U.rgba(side, 0.9), stroke: strokeColor, alt };
  },

  /* ---- Сражения, которые видит игрок: наши наступления и удары по нашим землям ---- */
  battles() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    const me = Game.me, groups = {};
    for (const tag of Game.tags()) {
      for (const a of Game.armies(tag)) {
        if (a.order.type !== 'attack' || !a.battle) continue;
        const r = Game.r(a.order.target);
        if (!r || (tag !== me && r.ctrl !== me)) continue;
        const k = tag + '>' + r.id;
        (groups[k] = groups[k] || { tag, c: r, armies: [] }).armies.push(a);
      }
    }
    for (const g of Object.values(groups)) {
      g.front = Regions.center(g.c.id);
      g.defTag = g.c.ctrl;
      const last = g.armies[0].battle.last;
      g.ratio = last ? last.ratio : 1;
      g.att = g.armies.reduce((s, a) => s + a.divs, 0);
      const est = Game.estDivs(g.c, me);
      g.def = g.defTag === me ? U.fmt(Game.landDefenders(g.c, me), 0) : est.exact ? U.fmt(est.mid, 0) : '~' + est.lo + '–' + est.hi;
      g.days = Math.max(...g.armies.map(a => a.battle.days));
      out.push(g);
    }
    return out;
  },
  // Гарнизоны ИИ в вражеских регионах у нашего фронта
  garrisons() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    const me = Game.me, busy = new Set(this.battles().map(b => b.c.id));
    for (const r of Game.frontRegions(me)) {
      if (busy.has(r.id) || Game.isPower(r.ctrl) || r.radioactive) continue;
      const ours = Regions.nb(r.id).find(n => { const t = Game.r(n); return t && t.ctrl === me; });
      const p = ours ? Regions.toward(r.id, ours, 0.45) : Regions.center(r.id);
      const est = Game.estDivs(r, me);
      if (est.hi < 1) continue;
      out.push({ c: r, lat: p.lat, lng: p.lng, tag: r.ctrl, text: est.exact ? U.fmt(est.mid, 0) : '~' + est.hi });
    }
    return out;
  },
  // Сравниваем потери с прошлым разом и показываем «−0,4» над фишками
  lossMem: {},
  trackLosses() {
    if (!this.impl || !this.impl.addFloat) return;
    for (const g of this.battles()) {
      for (const a of g.armies) {
        const b = a.battle, m = this.lossMem[a.id];
        if (m && m.start === b.start && b.days > m.days) {
          const da = b.attLost - m.att, dd = b.defLost - m.def;
          const p = this.armyPos(a, g.tag);
          if (p && da > 0.04) this.impl.addFloat({ lat: p.lat, lng: p.lng, text: '−' + U.fmt(da, 1), color: g.tag === Game.me ? '#ff6b5b' : '#ffd36b' });
          if (dd > 0.04) this.impl.addFloat({ lat: g.front.lat, lng: g.front.lng, text: '−' + U.fmt(dd, 1), color: g.tag === Game.me ? '#ffd36b' : '#ff6b5b' });
        }
        this.lossMem[a.id] = { start: b.start, days: b.days, att: b.attLost, def: b.defLost };
      }
    }
  },

  /* ---- Метки на карте ---- */
  markers() {
    const out = [];
    if (!Game.S) return out;
    const me = Game.me;
    for (const tag of Game.tags()) {
      const D = POWERS[tag], cap = Game.r(Game.capitalRegion(tag));
      if (cap && cap.ctrl === tag) out.push({ key: 'capital-' + tag, kind: tag === me ? 'capital' : 'capital-other', icon: 'i-pp', ...D.capitalPos, label: D.capitalName });
    }
    Game.eachRegion(r => { if (r.radioactive) { const p = Regions.center(r.id); out.push({ key: 'rad-' + r.id, kind: 'rad', icon: 'i-nuke', lat: p.lat, lng: p.lng }); } });
    Game.eachCountry(c => {
      const m = Geo.meta[c.id];
      if (!m || c.inert || (c.ctrl !== c.id && !Game.isPowerHome(c))) return;
      const pos = m.centroid;
      if (Game.atWar(c, me)) out.push({ key: 'war-' + c.id, kind: 'war', icon: 'i-swords', lat: pos.lat, lng: pos.lng });
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
      const from = this.armyPos(a, Game.me), to = Regions.center(a.order.target);
      if (!from || !to) continue;
      const sel = a.id === this.selectedArmy;
      out.push({
        sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng,
        color: a.order.air ? ['rgba(150,210,255,0.95)', 'rgba(255,255,255,1)'] : ['rgba(255,60,40,0.95)', 'rgba(255,215,90,1)'], stroke: sel ? 0.45 : 0.3, dash: 0.4, gap: 0.12, time: 1100, init: 0
      });
    }
    return out;
  },

  /* ---- Линия фронта: общие границы наших регионов с вражескими ---- */
  frontLines() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    const me = Game.me;
    const attacking = new Set(Game.armies(me).filter(a => a.order.type === 'attack').map(a => a.loc + '>' + a.order.target));
    for (const r of Game.lands(me)) {
      const g = Regions.get(r.id);
      if (!g) continue;
      for (const n of g.nb) {
        const e = Game.r(n);
        if (!e || !Game.atWar(e, me)) continue;
        const hot = attacking.has(r.id + '>' + n);
        const runs = g.border[n];
        if (runs && runs.length) {
          for (const run of runs) out.push({ pts: run.map(([lng, lat]) => [lat, lng]), color: hot ? ['#ffe14d', '#ff2d1f'] : ['#ff1f1f', '#b30000'], w: hot ? 4.5 : 3, dash: 1, gap: 0, time: 0 });
        } else {
          const A = Regions.center(r.id), B = Regions.center(n);
          const pts = [[A.lat, A.lng], [B.lat, B.lng]];
          pts.sea = true;
          out.push({ pts, color: ['#ff1f1f', '#b30000'], w: 2.5, dash: 0.03, gap: 0.02, time: 0 });
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
      const pts = [this.armyPos(a, Game.me)].concat(a.order.path.map(id => Regions.center(id))).map(p => [p.lat, p.lng]);
      out.push({ pts, color: ['rgba(255,255,255,0.9)', 'rgba(160,220,255,0.9)'], w: 2, dash: 0.02, gap: 0.015, time: 4000 });
    }
    return out;
  },

  /* ---- Где на карте стоит фишка армии: в своём регионе, ближе к врагу ---- */
  armyPos(a, tag) {
    const loc = a.loc;
    if (a.order.type === 'attack' && !a.order.air) return Regions.toward(loc, a.order.target, 0.7);
    if (a.order.type === 'attack') return Regions.center(loc);
    const enemy = Regions.nb(loc).find(n => Game.atWar(Game.r(n), tag));
    if (enemy) return Regions.toward(loc, enemy, 0.5);
    return Regions.center(loc);
  },

  /* ---- Фишки армий: свои (кликабельные) и армии других игроков у наших границ ---- */
  armyMarkers() {
    const out = [];
    if (!Game.S || !Game.P(Game.me)) return out;
    const me = Game.me, stack = {};
    for (const tag of Game.tags()) {
      for (const a of Game.armies(tag)) {
        const mine = tag === me;
        const loc = Game.r(a.loc);
        if (!mine && (!loc || !(Game.bordersPower(a.loc, me) || loc.ctrl === me))) continue;
        const p = this.armyPos(a, tag);
        if (!p) continue;
        const k = Math.round(p.lat * 2) + ':' + Math.round(p.lng * 2);
        const i = stack[k] = (stack[k] || 0) + 1;
        const home = Game.c(POWERS[tag].capital);
        const intel = mine ? 100 : (home ? Game.intel(home, me) : 0);
        out.push({
          key: 'army-' + a.id, kind: 'army', id: a.id, tag, mine,
          lat: p.lat - (i - 1) * 0.9, lng: p.lng,
          divs: mine || intel >= 80 ? String(Math.round(a.divs)) : '~' + Math.max(5, Math.round(a.divs / 5) * 5),
          org: a.org, name: a.name, order: a.order.type, sel: a.id === this.selectedArmy
        });
      }
    }
    return out;
  },

  // Откуда рисовать дугу удара: из ближайшего нашего региона (или из столицы)
  sourceFor(targetId, tag = Game.me) {
    const home = POWERS[tag] ? POWERS[tag].capitalPos : CFG.CAPITAL_POS;
    const nb = Regions.nb(targetId).filter(n => { const r = Game.r(n); return r && r.ctrl === tag; });
    return nb.length ? Regions.center(nb[0]) : home;
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
    this.features = features;

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
    this.clearLabels();
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
    MapView.armyTargetsCache = MapView.armyTargets();
    try { this.updateLabels(); } catch (e) { console.error('[Map] labels', e); }
    const st = f => MapView.style(f.properties.id);
    this.g.polygonCapColor(f => st(f).capA)
      .polygonSideColor(f => st(f).side)
      .polygonStrokeColor(f => st(f).stroke)
      .polygonAltitude(f => st(f).alt);
  },

  refreshOverlays() {
    if (!this.g) return;
    this.g.arcsData(MapView.frontArcs().concat(this.tempArcs));
    this.g.pathsData(MapView.countryOutlines().concat(MapView.frontLines(), MapView.movePaths()));
    this.g.ringsData(this.tempRings.slice());
    this.g.htmlElementsData(MapView.markers().concat(MapView.armyMarkers()));
  },

  /* ---- Названия стран: лента с текстом на поверхности глобуса (изгибается вместе с ним) ---- */
  labelGroup: null,
  labelMeshes: new Map(),
  LABEL_ALT: 0.05,              // выше самых «поднятых» стран, чтобы буквы не тонули
  updateLabels() {
    const T = window.THREE;
    if (!this.g || !T || typeof this.g.getCoords !== 'function') return;
    if (!this.labelGroup) {
      this.labelGroup = new T.Group();
      this.labelGroup.name = 'country-labels';
      this.g.scene().add(this.labelGroup);
    }
    const keep = new Set();
    for (const L of Labels.all()) {
      const id = L.key + '|' + L.text;
      keep.add(id);
      if (this.labelMeshes.has(id)) continue;
      const m = this.labelMesh(L);
      if (m) { this.labelGroup.add(m); this.labelMeshes.set(id, m); }
    }
    for (const [id, m] of this.labelMeshes) {
      if (keep.has(id)) continue;
      this.labelGroup.remove(m);
      this.disposeMesh(m);
      this.labelMeshes.delete(id);
    }
  },
  disposeMesh(m) { m.geometry.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); },
  clearLabels() {
    for (const m of this.labelMeshes.values()) this.disposeMesh(m);
    this.labelMeshes.clear();
    this.labelGroup = null;
  },
  labelMesh(L) {
    const T = window.THREE, g = this.g;
    const { top, bot } = Labels.ribbon(L);
    const n = top.length;
    let len = 0;
    for (let i = 1; i < n; i++) {
      const a = L.pts[i - 1], b = L.pts[i], kc = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
      len += Math.hypot((b.lng - a.lng) * kc, b.lat - a.lat);
    }
    const tex = new T.CanvasTexture(Labels.canvasFor(L, len / L.h));
    tex.anisotropy = Math.min(8, g.renderer().capabilities.getMaxAnisotropy());
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
    for (let i = 0; i < n; i++) {
      const a = g.getCoords(top[i].lat, top[i].lng, this.LABEL_ALT), b = g.getCoords(bot[i].lat, bot[i].lng, this.LABEL_ALT);
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      const u = i / (n - 1);
      uv.set([u, 1, u, 0], i * 4);
      if (i < n - 1) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: T.DoubleSide });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 5;
    mesh.raycast = () => {};        // подписи не мешают кликам по странам
    return mesh;
  },

  markerEl(d) {
    if (d.kind === 'army') return this.armyEl(d);
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
    const c = Regions.center(id), g = Regions.get(id), m = Geo.meta[id];
    const area = g ? g.area * 4 : m ? m.area : 50;
    const cur = this.g.pointOfView();
    let alt = cur.altitude;
    if (alt < 0.9 || alt > 2.8) alt = U.clamp(0.6 + Math.sqrt(area) / 22, 0.95, 2.2);
    this.g.pointOfView({ lat: c.lat, lng: c.lng, altitude: alt }, 900);
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
    const to = Regions.center(targetId), from = MapView.sourceFor(targetId, tag);
    this.addTempArc({ sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng, color: ['rgba(255,60,40,1)', 'rgba(255,240,180,1)'],
      stroke: 1.1, dash: 0.25, gap: 3, init: 1, time: 900 }, 1000);
    const col = success ? [255, 190, 60] : [255, 70, 50];
    this.addTempRing({ lat: to.lat, lng: to.lng, maxR: 5, speed: 4, period: 450, color: t => `rgba(${col},${(1 - t) * 0.9})` }, 2600);
  },

  fxEnemyAttack(srcId, targetId, success) {
    if (!this.g) return;
    const from = Regions.center(srcId), to = Regions.center(targetId);
    this.addTempArc({ sLat: from.lat, sLng: from.lng, eLat: to.lat, eLng: to.lng, color: ['rgba(120,160,255,1)', 'rgba(255,60,60,1)'],
      stroke: 0.9, dash: 0.25, gap: 3, init: 1, time: 1000 }, 1100);
    this.addTempRing({ lat: to.lat, lng: to.lng, maxR: 4, speed: 3, period: 500,
      color: t => `rgba(${success ? '255,50,50' : '120,170,255'},${(1 - t) * 0.85})` }, 2200);
  },

  fxNuke(targetId, from) {
    if (!this.g) return;
    const to = Regions.center(targetId);
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
    // Контуры государств — для жирных границ поверх регионов
    this.countryShapes = Geo.features.filter(f => f.geometry).map(f => {
      const path = new Path2D();
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        poly[0].forEach(([x, y], i) => { const [px, py] = this.proj(x, y); if (i === 0) path.moveTo(px, py); else path.lineTo(px, py); });
        path.closePath();
      }
      return path;
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
    const m = Regions.center(id);
    const [x, y] = this.proj(m.lng, m.lat);
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
    // Тонкие границы регионов, затем жирные — государств, затем выделенный регион
    ctx.lineWidth = 0.6 / v.scale;
    for (const s of this.shapes) { ctx.strokeStyle = MapView.style(s.id).stroke; ctx.stroke(s.path); }
    ctx.lineWidth = 1.4 / v.scale;
    ctx.strokeStyle = 'rgba(6,9,14,0.75)';
    for (const p of this.countryShapes) ctx.stroke(p);
    for (const s of this.shapes) {
      if (s.id !== MapView.selected && s.id !== MapView.hovered) continue;
      ctx.lineWidth = 2.2 / v.scale;
      ctx.strokeStyle = MapView.style(s.id).stroke;
      ctx.stroke(s.path);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(ctx);
    this.drawFrontLines(ctx, now);
    this.drawArcs(ctx, now);
    this.drawMarkers(ctx);
    this.drawGarrisons(ctx);
    this.drawArmies(ctx);
    this.drawBattles(ctx, now);
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

  /* ---- Фишка (как у армий): цвет владельца, знак пехоты НАТО, число дивизий ---- */
  counter(ctx, cx, cy, color, stroke, text, extra) {
    const w = 46, h = 22, x = cx - w / 2, y = cy - h / 2;
    ctx.fillStyle = color; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = 'rgba(6,10,16,0.92)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stroke; ctx.lineWidth = 1;
    ctx.strokeRect(x + 3, y + 4, 14, 10);
    ctx.beginPath(); ctx.moveTo(x + 3, y + 4); ctx.lineTo(x + 17, y + 14); ctx.moveTo(x + 17, y + 4); ctx.lineTo(x + 3, y + 14); ctx.stroke();
    ctx.font = '700 11px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    ctx.fillText(text, x + 21, y + 9);
    if (extra != null) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 2, y + h - 4, w - 4, 2);
      ctx.fillStyle = extra < 35 ? '#f08a24' : '#4fc97a'; ctx.fillRect(x + 2, y + h - 4, (w - 4) * extra / 100, 2);
    }
  },
  drawGarrisons(ctx) {
    for (const g of MapView.garrisons()) {
      const [x, y] = this.toScreen(g.lng, g.lat);
      const col = Regions.ownerColor(g.tag);
      this.counter(ctx, x, y, col, '#ffd0c0', g.text, null);
    }
  },

  /* ---- Сражения: фишка противника, значок боя, трассеры, разрывы ---- */
  drawBattles(ctx, now) {
    const me = Game.me;
    for (const b of MapView.battles()) {
      const a0 = MapView.armyPos(b.armies[0], b.tag);
      if (!a0) continue;
      const [ax, ay] = this.toScreen(a0.lng, a0.lat);
      const [ex, ey] = this.toScreen(b.front.lng, b.front.lat);
      const attMine = b.tag === me;
      // Фишка обороняющихся в регионе, за который идёт бой
      const defCol = Regions.ownerColor(b.defTag);
      this.counter(ctx, ex, ey, defCol, b.defTag === me ? '#fff' : '#ffd0c0', b.def, null);
      // Трассеры: наш огонь — жёлтый, ответный — красный
      const hseed = [...b.c.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
      for (let i = 0; i < 6; i++) {
        const t = ((now / 650) + i / 6) % 1;
        const x = ax + (ex - ax) * t, y = ay + (ey - ay) * t + Math.sin((t + i) * 9) * 3;
        ctx.fillStyle = attMine ? 'rgba(255,230,120,0.95)' : 'rgba(255,90,70,0.95)';
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        if (i % 2 === 0) {
          const t2 = ((now / 800) + i / 6 + 0.33) % 1;
          ctx.fillStyle = attMine ? 'rgba(255,90,70,0.85)' : 'rgba(255,230,120,0.85)';
          ctx.beginPath(); ctx.arc(ex + (ax - ex) * t2, ey + (ay - ey) * t2, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Разрывы вокруг позиции обороняющихся
      for (let i = 0; i < 4; i++) {
        const phase = (now / 300 + i * 0.27) % 1, slot = Math.floor(now / 300 + i * 0.27) + i * 13 + hseed;
        const rx = Math.sin(slot * 12.9898) * 43758.5453, ry = Math.sin(slot * 78.233) * 12543.123;
        const px = ex + ((rx - Math.floor(rx)) - 0.5) * 46, py = ey + ((ry - Math.floor(ry)) - 0.5) * 30;
        const r = 3 + phase * 11;
        const gr = ctx.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, `rgba(255,240,200,${(1 - phase) * 0.9})`);
        gr.addColorStop(0.5, `rgba(255,140,40,${(1 - phase) * 0.6})`);
        gr.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      }
      // Значок боя посередине
      const mx = ax + (ex - ax) * 0.55, my = ay + (ey - ay) * 0.55;
      const win = attMine ? b.ratio : 1 / Math.max(0.01, b.ratio);
      const ring = win >= 1.1 ? '#4fc97a' : win >= 0.9 ? '#f5d742' : '#ff5a50';
      const pulse = 1 + 0.15 * Math.sin(now / 160);
      ctx.beginPath(); ctx.arc(mx, my, 13 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,12,18,0.92)'; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = ring; ctx.stroke();
      ctx.font = '700 14px "Segoe UI Symbol", "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = ring;
      ctx.fillText('⚔', mx, my + 1);
      // Подпись: силы сторон, день боя и контроль региона
      const label = `${U.fmt(b.att, 0)} ⚔ ${b.def} · день ${b.days}`;
      ctx.font = '700 11px "Bahnschrift", "Segoe UI", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(8,12,18,0.88)'; ctx.fillRect(mx - tw / 2, my - 34, tw, 17);
      ctx.strokeStyle = ring; ctx.lineWidth = 1; ctx.strokeRect(mx - tw / 2, my - 34, tw, 17);
      ctx.fillStyle = '#fff'; ctx.fillText(label, mx, my - 25);
      const bw = 44;
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(mx - bw / 2, my + 17, bw, 4);
      ctx.fillStyle = '#ff9a3c'; ctx.fillRect(mx - bw / 2, my + 17, bw * b.c.control / 100, 4);
    }
  },

  // Всплывающие цифры потерь
  addFloat(f) { this.addFx({ type: 'float', dur: 1700, ...f }); },

  drawLabels(ctx) {
    if (!this.labelData || this.labelDirty !== false) { this.labelData = Labels.all(); this.labelDirty = false; }
    const pxDeg = this.view.scale * this.H0 / 180;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const L of this.labelData) {
      const px = L.h * pxDeg * 0.82;
      if (px < 7) continue;
      const P = L.pts.map(p => this.toScreen(p.lng, p.lat));
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const total = cum[cum.length - 1];
      if (!total) continue;
      const chars = [...L.text];
      ctx.font = `700 ${px.toFixed(1)}px Georgia, "Times New Roman", serif`;
      let j = 0;
      chars.forEach((ch, i) => {
        const d = (i + 0.5) / chars.length * total;
        while (j < cum.length - 2 && cum[j + 1] < d) j++;
        const t = (d - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
        const x = P[j][0] + (P[j + 1][0] - P[j][0]) * t, y = P[j][1] + (P[j + 1][1] - P[j][1]) * t;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(P[j + 1][1] - P[j][1], P[j + 1][0] - P[j][0]));
        ctx.lineWidth = px * 0.08;
        ctx.strokeStyle = LABEL_STYLE.stroke;
        ctx.strokeText(ch, 0, 0);
        ctx.fillStyle = L.sub ? LABEL_STYLE.subFill : LABEL_STYLE.fill;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
    }
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
      } else if (fx.type === 'float') {
        const [x, y] = this.toScreen(fx.lng, fx.lat);
        ctx.font = '800 14px "Bahnschrift", "Segoe UI", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = Math.min(1, (1 - t) * 1.6);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(fx.text, x, y - 18 - t * 34);
        ctx.fillStyle = fx.color; ctx.fillText(fx.text, x, y - 18 - t * 34);
        ctx.globalAlpha = 1;
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
    const to = Regions.center(targetId), from = MapView.sourceFor(targetId, tag);
    this.addFx({ type: 'arc', from, to, color: 'rgba(255,90,60,0.95)', width: 3, dur: 900 });
    this.addFx({ type: 'ring', lat: to.lat, lng: to.lng, r: 46, rgb: success ? '255,190,60' : '255,70,50', dur: 2200 });
  },

  fxEnemyAttack(srcId, targetId, success) {
    const from = Regions.center(srcId), to = Regions.center(targetId);
    this.addFx({ type: 'arc', from, to, color: 'rgba(130,170,255,0.95)', width: 2.5, dur: 1000 });
    this.addFx({ type: 'ring', lat: to.lat, lng: to.lng, r: 36, rgb: success ? '255,50,50' : '120,170,255', dur: 2000 });
  },

  fxNuke(targetId, from) {
    const to = Regions.center(targetId);
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
