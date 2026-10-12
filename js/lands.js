'use strict';
/* ============================================================
   ЗЕМЛЯ: регионы как настоящие территории (как штаты в HOI4).

   S.regions[id] — регион: { id, cid, name, ctrl, core, factories, pop,
     control, fort, radioactive, lostFrom, alerted }.
     cid  — страна, которой регион принадлежит исторически;
     ctrl — кто им сейчас владеет: тег державы-игрока или id ИИ-страны;
     core — чья это «родная земля» (держава для стартовых земель).
   S.countries[id] — государство: политика, блок, войны, разведка,
     армия ИИ (c.divs — общая для всех её регионов; гарнизоны тянутся к фронту).
     c.ctrl у государства — кто им правит: само (независимо), держава или аннексия.
   Заводы, укрепления, контроль и заражение страны — это сумма/сводка
   по её регионам (свойства-«геттеры», в сохранение не попадают).

   Армии стоят в регионах (a.loc — id региона), ходят по своим регионам
   и наступают на соседние вражеские. Захват региона — переход владельца;
   ИИ-государство капитулирует, когда теряет столичный регион.
   ============================================================ */

Object.assign(Game, {
  /* ---------------- Доступ к регионам ---------------- */
  r(id) { return this.S && this.S.regions && this.S.regions[id]; },
  regionList() { return this.S ? Object.values(this.S.regions) : []; },
  eachRegion(fn) { for (const id in this.S.regions) fn(this.S.regions[id]); },
  isRegion(x) { return !!x && typeof x.cid === 'string'; },
  // Регионы страны (все, кому бы они ни принадлежали)
  regionsOf(cid) { return (Regions.byCountry[cid] || []).map(g => this.S.regions[g.id]).filter(Boolean); },
  // Регионы, которые держит само государство c
  heldRegions(c) { return this.regionsOf(c.id).filter(r => r.ctrl === c.ctrl); },
  capitalRegion(tag) { return Regions.capitalOf[POWERS[tag] ? POWERS[tag].capital : tag]; },
  isCapitalRegion(r, tag) {
    if (tag) return r.id === this.capitalRegion(tag);
    return Regions.capitalOf[r.cid] === r.id;
  },
  // Государство-владелец региона: для державы — её «домашняя» страна
  ownerNation(r) {
    if (!r) return null;
    if (this.isPower(r.ctrl)) return this.c(POWERS[r.ctrl].capital);
    return this.c(r.ctrl);
  },

  /* ---------------- Создание регионов в новой игре ---------------- */
  initRegions() {
    Regions.build();
    const S = this.S;
    S.regions = {};
    this.eachCountry(c => {
      const R = Regions.byCountry[c.id] || [];
      const fac = Regions.split(c.id, Math.max(0, Math.round(c.factories || 0)));
      const W = R.reduce((s, g) => s + g.w, 0) || 1;
      R.forEach((g, i) => {
        S.regions[g.id] = {
          id: g.id, cid: c.id, name: g.name, ctrl: c.ctrl, core: c.core || c.id,
          factories: fac[i] || 0, pop: Math.round((c.pop || 1e6) * g.w / W),
          control: 100, fort: c.fort || 0, radioactive: false, lostFrom: null, alerted: false
        };
      });
      for (const k of ['factories', 'fort', 'control', 'radioactive', 'lostFrom', 'siege', 'alerted']) delete c[k];
      this.bindNation(c);
    });
  },

  /* Сводные свойства государства — из его регионов (не сохраняются: считаются на лету) */
  bindNation(c) {
    if (!c || c.__bound) return;
    const self = this;
    const held = () => self.heldRegions(c);
    Object.defineProperty(c, '__bound', { value: true, enumerable: false, configurable: true });
    Object.defineProperty(c, 'factories', {
      enumerable: false, configurable: true,
      get() { return held().reduce((s, r) => s + r.factories, 0); },
      set(v) {
        let d = Math.round(v) - this.factories;
        const H = held().filter(r => !r.radioactive);
        if (!H.length || !d) return;
        if (d > 0) { (H.find(r => self.isCapitalRegion(r)) || H.sort((a, b) => b.factories - a.factories)[0]).factories += d; return; }
        for (const r of H.sort((a, b) => b.factories - a.factories)) { const t = Math.min(r.factories, -d); r.factories -= t; d += t; if (!d) break; }
      }
    });
    Object.defineProperty(c, 'fort', {
      enumerable: false, configurable: true,
      get() { return held().reduce((m, r) => Math.max(m, r.fort), 0); },
      set(v) { held().forEach(r => { r.fort = U.clamp(Math.round(v), 0, 3); }); }
    });
    Object.defineProperty(c, 'control', {
      enumerable: false, configurable: true,
      get() { const H = held(); return H.length ? H.reduce((s, r) => s + r.control, 0) / H.length : 100; },
      set(v) { held().forEach(r => { r.control = U.clamp(v, 0, 100); }); }
    });
    Object.defineProperty(c, 'radioactive', {
      enumerable: false, configurable: true,
      get() { const H = held(); return H.length > 0 && H.every(r => r.radioactive); },
      set(v) { if (v) held().forEach(r => { r.radioactive = true; }); }
    });
  },
  bindAll() { this.eachCountry(c => { delete c.__bound; this.bindNation(c); }); },

  /* ---------------- Выборки по земле ---------------- */
  lands(tag = this.cur) { return this.regionList().filter(r => r.ctrl === tag); },
  playerLands() { return this.lands(); },
  annexedLands(tag = this.cur) { return this.lands(tag).filter(r => r.core !== tag && !r.radioactive); },
  // Государства, с которыми воюет держава (для списков фронтов)
  fronts(tag = this.cur) { return this.list(c => !c.inert && (c.ctrl === c.id || this.isPowerHome(c)) && this.atWar(c, tag)); },
  // Вражеские регионы, граничащие с нашими
  frontRegions(tag = this.cur) {
    const out = [];
    this.eachRegion(r => {
      if (r.ctrl === tag || !this.atWar(r, tag)) return;
      if (Regions.nb(r.id).some(n => { const t = this.r(n); return t && t.ctrl === tag; })) out.push(r);
    });
    return out;
  },
  // Граничит ли государство (или регион) с землями держави tag
  bordersPower(id, tag = this.cur) {
    const regs = this.r(id) ? [this.r(id)] : this.regionsOf(id).filter(r => r.ctrl !== tag);
    return regs.some(r => Regions.nb(r.id).some(n => { const t = this.r(n); return t && t.ctrl === tag; }));
  },
  wastelands() { return this.regionList().filter(r => r.radioactive).length; },

  // Снабжение наступления на регион: сухопутная граница — 100%, только через пролив — 80%, без границы — 55%
  supplyFactor(id, tag = this.cur) {
    const ids = this.r(id) ? [id] : this.regionsOf(id).map(r => r.id);
    let best = 0.55;
    for (const rid of ids) for (const n of Regions.nb(rid)) {
      const t = this.r(n);
      if (!t || t.ctrl !== tag) continue;
      best = Math.max(best, Regions.isSea(rid, n) ? 0.8 : 1);
    }
    return best;
  },
  // Стойкость: как медленно падает контроль. У региона — от его заводов и столичности
  resilience(x) {
    if (this.isRegion(x)) return 1 + x.factories / 4 + (this.isCapitalRegion(x) ? 1 : 0);
    return x.ctrl === x.id ? 1 + x.factories / 15 : 1.2;
  },
  aiTech(c) {
    const n = this.isRegion(c) ? this.ownerNation(c) : c;
    const years = this.S.day / 365;
    return 1 + years * (n && BLOCS.includes(n.faction) ? 0.06 : 0.03);
  },
  playerFactories(tag = this.cur) { return this.lands(tag).reduce((s, r) => s + r.factories, 0); },
  worldFactories() { let s = 0; this.eachRegion(r => { const c = this.c(r.cid); if (!c || !c.inert) s += r.factories; }); return s; },

  /* ---------------- Гарнизоны ИИ ----------------
     Армия ИИ-государства — общая (c.divs). Она распределяется по его регионам:
     прифронтовые получают вчетверо больше, столица — вдвое. */
  garrisonWeights(N) {
    const day = this.S.day;
    if (!this._gw || this._gw.day !== day) this._gw = { day, map: {} };
    let g = this._gw.map[N.id];
    if (g) return g;
    const w = {};
    let sum = 0;
    for (const r of this.lands(N.id)) {
      const front = Regions.nb(r.id).some(n => {
        const t = this.r(n);
        if (!t || t.ctrl === N.id) return false;
        return this.isPower(t.ctrl) ? !!N.wars[t.ctrl] : !!(this.c(t.ctrl) && this.c(t.ctrl).wars && Object.keys(N.wars).length);
      });
      const k = (front ? 4 : 1) * (Regions.capitalOf[N.id] === r.id ? 2 : 1);
      w[r.id] = k; sum += k;
    }
    return (this._gw.map[N.id] = { w, sum: sum || 1 });
  },
  garrison(r) {
    const N = this.c(r.ctrl);
    if (!N || this.isPower(r.ctrl)) return 0;
    const g = this.garrisonWeights(N);
    return (N.divs || 0) * (g.w[r.id] || 0) / g.sum;
  },
  regionDefenders(r) { const Y = this.powerOf(r); return Y ? this.landDefenders(r, Y) : this.garrison(r); },

  // Оценка сил с учётом разведданных: регион — его защитники, государство — вся армия
  estDivs(x, tag = this.cur) {
    const region = this.isRegion(x);
    const N = region ? this.ownerNation(x) : x;
    const Y = this.powerOf(x);
    const real = region ? this.regionDefenders(x) : (Y && Y !== tag ? this.totalDivs(Y) : x.divs);
    const intel = N ? this.intel(N, tag) : 0;
    if (intel >= 80 || x.ctrl === tag || (N && this.isAlly(N, tag))) return { mid: real, lo: Math.round(real), hi: Math.round(real), exact: true };
    const err = (1 - intel / 100) * 0.5;
    const mid = Math.max(0, real * (1 + (N ? N.noise : 0) * err * 0.6));
    return { mid, lo: Math.max(0, Math.floor(mid * (1 - err))), hi: Math.max(1, Math.ceil(mid * (1 + err))), exact: false };
  },

  dailyMP() {
    let s = 0;
    const tag = this.cur;
    for (const r of this.lands(tag)) if (!r.radioactive) s += r.pop * CFG.MP_PER_POP * (r.core === tag ? 1 : CFG.ANNEXED_MP);
    return s * (1 + this.mods.mpMult);
  },
  addFactories(n, announce) {
    let target = this.r(this.capitalRegion(this.cur));
    if (!target || target.ctrl !== this.cur || target.radioactive) {
      const lands = this.lands().filter(r => !r.radioactive);
      if (!lands.length) return;
      target = U.pick(lands);
    }
    target.factories = Math.max(0, target.factories + n);
    if (announce) this.log('success', 'Новый завод', `Введено в строй предприятий: ${n}. Регион: ${target.name}.`, target.id);
  },

  /* ---------------- Армии на регионах ---------------- */
  landDefenders(r, Y = r.ctrl) {
    if (!this.isPower(Y)) return this.garrison(r);
    let s = this.armiesAt(r.id, Y).reduce((t, a) => t + a.divs, 0);
    if (r.id === this.capitalRegion(Y)) s += this.P(Y).divs;
    return s;
  },
  landDefense(r, Y = r.ctrl) {
    const mix = {};
    for (const a of this.armiesAt(r.id, Y)) this.addMix(mix, a.mix);
    if (r.id === this.capitalRegion(Y)) this.addMix(mix, this.P(Y).rmix);
    const st = this.mixStats(mix, Y);
    return { divs: st.divs, def: st.def, at: st.at };
  },
  takeLosses(r, Y, n) {
    if (n <= 0) return 0;
    const A = this.armiesAt(r.id, Y);
    const cap = r.id === this.capitalRegion(Y) ? this.P(Y).divs : 0;
    const total = A.reduce((s, a) => s + a.divs, 0) + cap;
    if (total <= 0) return 0;
    n = Math.min(n, total);
    for (const a of A) this.scaleMix(a, a.divs - n * a.divs / total);
    if (cap) this.loseReserve(n * cap / total, Y);
    this.P(Y).stats.divLost += n;
    this.cleanArmies(Y);
    return n;
  },
  newArmy(tag, name, divs, loc, mix) {
    const P = this.P(tag), d = POWERS[tag];
    P.armySeq++;
    const a = {
      id: tag + P.armySeq, name: name || this.armyName(tag, P.armySeq),
      general: d.generals[(P.armySeq - 1) % d.generals.length],
      divs, mix: mix || { [this.defaultTpl(tag)]: divs }, loc: loc || this.capitalRegion(tag), org: 100, order: { type: 'hold' }, battle: null
    };
    P.armies.push(a);
    return a;
  },
  // Стартовая позиция армии: регион по названию (если он наш), иначе столичный
  startRegion(tag, a) {
    if (a.reg) {
      const g = (Regions.byCountry[POWERS[tag].capital] || []).find(x => x.name === a.reg);
      if (g && this.r(g.id) && this.r(g.id).ctrl === tag) return g.id;
    }
    return this.capitalRegion(tag);
  },
  stepDays(a, b, army) {
    const base = Regions.isSea(a, b) ? CFG.ARMY.seaStepDays : CFG.ARMY.stepDays;
    const speed = army ? this.mixStats(army.mix).speed : 1;
    return Math.max(1, Math.round(base / speed));
  },
  armyPath(from, to, tag = this.cur) {
    if (from === to) return [];
    const prev = { [from]: null }, queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of Regions.nb(cur)) {
        if (n in prev) continue;
        const r = this.r(n);
        if (!r || r.ctrl !== tag) continue;
        prev[n] = cur;
        if (n === to) {
          const path = [];
          for (let p = to; p !== from; p = prev[p]) path.unshift(p);
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  },
  armySupply(fromId, toId) { return Regions.isSea(fromId, toId) ? Math.min(1, 0.8 + this.mods.amph) : 1; },

  canMove(a, r) {
    if (!a) return 'Армия не найдена';
    if (this.outReason()) return this.outReason();
    if (!r || r.ctrl !== this.cur) return 'Двигаться можно только по своей территории';
    if (r.id === a.loc) return 'Армия уже здесь';
    if (!this.armyPath(a.loc, r.id)) return 'Нет пути по нашей территории';
    return null;
  },
  orderMove(id, targetId) {
    const a = this.army(id), r = this.r(targetId), why = this.canMove(a, r);
    if (why) return this.fail(why);
    if (a.battle) this.finishBattle(a, 'stopped');
    const path = this.armyPath(a.loc, r.id);
    a.order = { type: 'move', path, left: this.stepDays(a.loc, path[0], a), to: r.id };
    const days = path.reduce((s, p, i) => s + this.stepDays(i ? path[i - 1] : a.loc, p, a), 0);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name} выступает: ${r.name}, ~${U.days(days)}` };
  },
  canOrderAttack(a, r) {
    if (!a) return 'Армия не найдена';
    if (this.outReason()) return this.outReason();
    if (!r || r.ctrl === this.cur) return 'Это наша территория';
    if (!this.atWar(r)) return 'Нет состояния войны';
    if (a.order.type === 'move') return 'Армия на марше';
    if (!Regions.adjacent(a.loc, r.id)) return 'Армия должна стоять в соседнем регионе';
    if (a.org < CFG.ARMY.haltOrg + 10) return `Армия измотана (организация ${Math.round(a.org)}%) — дайте ей отдохнуть`;
    return null;
  },
  orderAttack(id, targetId) {
    const a = this.army(id), r = this.r(targetId), why = this.canOrderAttack(a, r);
    if (why) return this.fail(why);
    if (a.battle && a.battle.target !== r.id) this.finishBattle(a, 'stopped');
    a.order = { type: 'attack', target: r.id };
    if (!a.battle) a.battle = { target: r.id, start: this.S.day, days: 0, attLost: 0, defLost: 0, ctrlStart: r.control, ratioSum: 0, last: null, orgStart: a.org };
    const Y = this.powerOf(r);
    if (Y) this.log('alert', 'Вражеское наступление', `${POWERS[this.cur].name}: ${a.name} переходит в наступление. Направление: ${r.name}.`, r.id, Y);
    this.log('mil', 'Наступление начато', `${a.name} атакует. Направление: ${r.name}.`, r.id);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name}: наступление — ${r.name}` };
  },

  /* --- Воздушный десант: расстояния от края наших регионов --- */
  distanceKm(a, b) {
    const p = Regions.center(a), q = Regions.center(b);
    if (!p || !q) return Infinity;
    const k = Math.PI / 180;
    const h = Math.sin((q.lat - p.lat) * k / 2) ** 2 + Math.cos(p.lat * k) * Math.cos(q.lat * k) * Math.sin((q.lng - p.lng) * k / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  },
  edgePts(id) {
    if (!this._edge) this._edge = {};
    if (!this._edge[id]) {
      const g = Regions.get(id), pts = [];
      if (g) for (const ring of g.polys) ring.forEach((v, i) => { if (i % 3 === 0) pts.push(v); });
      this._edge[id] = pts;
    }
    return this._edge[id];
  },
  airDistance(r, tag = this.cur) {
    const q = Regions.center(r.id);
    if (!q) return Infinity;
    const k = Math.PI / 180, cq = Math.cos(q.lat * k);
    let best = Infinity;
    for (const l of this.lands(tag)) {
      for (const [lng, lat] of this.edgePts(l.id)) {
        const h = Math.sin((lat - q.lat) * k / 2) ** 2 + cq * Math.cos(lat * k) * Math.sin((lng - q.lng) * k / 2) ** 2;
        const d = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
        if (d < best) best = d;
      }
    }
    return best;
  },
  orderAirborne(id, targetId) {
    const a = this.army(id), r = this.r(targetId), why = this.canAirdrop(a, r);
    if (why) return this.fail(why);
    this.P().pp -= CFG.AIRBORNE.pp;
    a.airCd = this.S.day + CFG.AIRBORNE.cooldown;
    a.order = { type: 'attack', target: r.id, air: true };
    a.battle = { target: r.id, start: this.S.day, days: 0, attLost: 0, defLost: 0, ctrlStart: r.control, ratioSum: 0, last: null, orgStart: a.org, air: true };
    const Y = this.powerOf(r);
    if (Y) this.log('alert', 'Вражеский десант', `${POWERS[this.cur].name} высаживает воздушный десант. Направление: ${r.name}.`, r.id, Y);
    this.log('mil', 'Воздушный десант', `${a.name} высаживается в тылу врага. Цель: ${r.name}.`, r.id);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name}: десант — ${r.name}` };
  },

  tickArmies() {
    const P = this.P(), m = this.mods;
    for (const a of P.armies) {
      const o = a.order;
      if (o.type === 'move') {
        a.org = Math.min(100, a.org + m.orgRegen * 0.5);
        if (--o.left > 0) continue;
        const next = o.path.shift();
        const r = this.r(next);
        if (!r || r.ctrl !== this.cur) {
          a.order = { type: 'hold' };
          this.log('mil', 'Марш прерван', `${a.name} остановилась: путь отрезан.`, a.loc);
          continue;
        }
        a.loc = next;
        if (o.path.length) o.left = this.stepDays(a.loc, o.path[0], a);
        else {
          a.order = { type: 'hold' };
          this.log('mil', 'Армия на позициях', `${a.name} заняла оборону: ${r.name}.`, r.id);
        }
      } else if (o.type === 'hold') {
        a.org = Math.min(100, a.org + m.orgRegen);
      }
    }
  },

  tickBattles() {
    for (const X of this.alive()) {
      this.as(X, () => {
        const groups = {};
        for (const a of this.armies()) {
          if (a.order.type !== 'attack') continue;
          const r = this.r(a.order.target);
          const adj = a.order.air || Regions.adjacent(a.loc, a.order.target);
          if (!r || r.ctrl === X || !this.atWar(r) || !adj) { this.finishBattle(a, 'invalid'); continue; }
          (groups[r.id] = groups[r.id] || []).push(a);
        }
        for (const [id, list] of Object.entries(groups)) this.battleDay(this.r(id), list);
      });
    }
  },

  battleDay(r, list) {
    const X = this.cur, P = this.P(), Y = this.powerOf(r);
    const N = Y ? null : this.c(r.ctrl);
    const res = Combat.battleDay(r, list);
    const total = list.reduce((s, a) => s + a.divs, 0);
    for (const a of list) {
      const share = a.divs / total;
      const lost = res.attLoss * share;
      this.scaleMix(a, a.divs - lost);
      a.org = Math.max(0, a.org - res.orgLoss);
      const b = a.battle;
      b.days++; b.attLost += lost; b.defLost += res.defLoss * share; b.ratioSum += res.ratio; b.last = res;
    }
    P.stats.divLost += res.attLoss;
    P.stats.enemyKilled += res.defLoss;
    if (Y) this.takeLosses(r, Y, res.defLoss);
    else if (N) N.divs = Math.max(0, N.divs - res.defLoss);
    r.control = Math.max(0, r.control - res.ctrlDrop);
    if (Y && res.ratio >= 1 && r.control < 50 && !r.alerted) {
      r.alerted = true;
      this.log('alert', 'Фронт трещит', `Противник (${POWERS[X].name}) прорывает оборону: ${r.name}, контроль ${Math.round(r.control)}%.`, r.id, Y);
    }
    // Захват региона: армии входят в него, фронт сдвигается
    if (r.control <= 0 || (!Y && res.ratio >= 1 && this.garrison(r) < 0.15 && r.control < 60)) {
      const prev = r.ctrl;
      const gained = this.transferRegion(r, X);
      if (Y) this.log('alert', 'Регион потерян', `Противник (${POWERS[X].name}) захватил регион: ${r.name}.`, r.id, Y);
      list.forEach((a, i) => { a.loc = r.id; this.finishBattle(a, 'captured', gained, i > 0); });
      this.addTension(this.isCapitalRegion(r) ? 2 : 0.4);
      if (!this.isPower(prev)) this.checkCapitulation(this.c(prev), X);
      Bus.emit('mapDirty');
    } else {
      list.forEach(a => { if (a.org < CFG.ARMY.haltOrg || a.divs < 0.5) this.finishBattle(a, 'halted'); });
    }
    this.cleanArmies(X);
  },

  finishBattle(a, result, gained = 0, quiet = false) {
    const b = a.battle;
    a.battle = null;
    a.order = { type: 'hold' };
    if (!b || !b.days) return;
    const r = this.r(b.target);
    const P = this.P(), X = this.cur;
    const avg = b.ratioSum / b.days;
    const last = b.last;
    if (b.air && (result === 'halted' || result === 'stopped')) {
      const lost = a.divs * CFG.AIRBORNE.cutOff;
      this.scaleMix(a, a.divs - lost);
      b.attLost += lost;
      P.stats.divLost += lost;
      this.log('alert', 'Десант отрезан', `${a.name}: десант не взял цель и прорывался к своим. Потеряно ${U.fmt(lost, 1)} див.`, r.id);
    }
    if (result === 'captured') P.stats.won++; else if (result === 'halted') P.stats.lost++;
    const title = { captured: 'Регион взят', halted: 'Наступление выдохлось', stopped: 'Наступление остановлено', invalid: 'Наступление прекращено' }[result];
    this.log(result === 'captured' ? 'success' : 'mil', `${a.name}: ${title.toLowerCase()}`,
      `Направление: ${r.name}. ${U.days(b.days)} боёв, наши потери ${U.fmt(b.attLost, 1)} див., противник ${U.fmt(b.defLost, 1)} див.`, r.id);
    if (quiet || (result !== 'captured' && result !== 'halted')) return;
    const Y = last.defender;
    const N = this.c(r.cid);
    Bus.emit('battle', {
      kind: 'offensive', by: X, defender: Y, result,
      op: a.name, general: a.general, days: b.days,
      date: this.S.date, targetId: r.id, targetName: r.name, targetFaction: N ? N.faction : 'NEU',
      targetColor: Y ? POWERS[Y].color : null,
      att: Object.assign({}, last.att, { divs: Math.round(a.divs + b.attLost) }),
      def: last.def,
      ratio: avg, outcome: Combat.outcomeFor(result === 'captured' ? Math.max(avg, 1) : Math.min(avg, 0.99)),
      playerLost: Math.round(b.attLost * 10) / 10, playerMPLost: Math.round(b.attLost * CFG.DIV.mp),
      enemyLost: Math.round(b.defLost * 10) / 10, enemyAfter: this.regionDefenders(r),
      controlBefore: b.ctrlStart, controlAfter: result === 'captured' ? 0 : r.control,
      capitulated: false, captured: result === 'captured', liberation: r.core === X,
      annexedFactories: gained, loot: 0, resilience: last.resilience,
      orgCost: Math.round(b.orgStart - a.org), orgLeft: a.org, tension: 0, ppGain: 0
    });
  },

  // Армии державы Y из потерянного региона отступают в соседний свой (или гибнут в котле)
  retreatArmies(r, Y) {
    const A = this.armiesAt(r.id, Y);
    if (!A.length) return;
    const back = Regions.nb(r.id).map(n => this.r(n)).find(t => t && t.ctrl === Y);
    for (const a of A) {
      if (a.battle) this.as(Y, () => this.finishBattle(a, 'invalid', 0, true));
      a.order = { type: 'hold' };
      if (back) {
        a.loc = back.id;
        this.scaleMix(a, a.divs * 0.8);
        a.org = 0;
        this.log('alert', 'Отступление', `${a.name} отступила с потерями: ${back.name}.`, back.id, Y);
      } else {
        this.scaleMix(a, 0);
        this.log('alert', 'Котёл', `${a.name} попала в окружение и уничтожена: ${r.name}.`, r.id, Y);
      }
    }
    this.cleanArmies(Y);
  },

  /* Передача региона владельцу X. Возвращает число заводов, доставшихся X. */
  transferRegion(r, X, opts = {}) {
    const prev = r.ctrl;
    const liberation = r.core === X || (this.isPower(X) && POWERS[X].capital === r.cid) || r.cid === X;
    if (!opts.peaceful && !liberation && !r.radioactive) r.factories = Math.floor(r.factories * 0.7);
    const keep = r.radioactive ? 0 : r.factories;
    // Гарнизон ИИ в потерянном регионе частично гибнет
    if (!this.isPower(prev) && !opts.peaceful) { const N = this.c(prev); if (N) N.divs = Math.max(0, N.divs - this.garrison(r) * 0.5); }
    r.ctrl = X;
    r.control = 100;
    r.alerted = false;
    r.lostFrom = liberation ? null : prev;
    this._gw = null;
    const N = this.c(r.cid);
    if (N) N.intel[X] = 100;
    if (this.isPower(prev) && prev !== X) this.retreatArmies(r, prev);
    if (this.isPower(prev)) this.checkEnd();
    Bus.emit('mapDirty');
    return keep;
  },

  /* Государство c целиком переходит к X (капитуляция, интеграция союзника) */
  annexNation(c, X, opts = {}) {
    let gained = 0;
    for (const r of this.regionList().filter(r => r.ctrl === c.id)) gained += this.transferRegion(r, X, opts);
    // Регионы этой страны, захваченные ИИ-оккупантом, остаются у него до мира
    c.ctrl = X;
    c.faction = this.isPower(X) ? POWERS[X].faction : (this.c(X) || c).faction;
    c.wars = {}; c.warDays = 0; c.cb = {}; c.influence = null; c.integrate = null;
    c.divs = 0; c.sab = 0; c.sabDays = 0;
    c.intel[X] = 100;
    this._gw = null;
    Bus.emit('mapDirty');
    return gained;
  },
  transferLand(c, X, opts = {}) { return this.isRegion(c) ? this.transferRegion(c, X, opts) : this.annexNation(c, X, opts); },

  /* Капитуляция ИИ-государства: теряет столичный регион — сдаётся державе X */
  checkCapitulation(N, X) {
    if (!N || N.ctrl !== N.id || N.inert || !this.isPower(X)) return;
    const cap = this.r(Regions.capitalOf[N.id]);
    const held = this.heldRegions(N).length;
    if ((cap && cap.ctrl !== N.id) || held === 0) this.capitulate(N, X);
  },
  // capitulate — в peace.js (мирная конференция)

  /* --- Наступление ИИ на регион державы --- */
  enemyOffensive(src, target) {
    const Y = target.ctrl, N = this.c(src.ctrl);
    if (!N) return;
    const res = Combat.resolveEnemyOffensive(src, target);
    res.playerLost = Math.round(this.takeLosses(target, Y, res.playerLost) * 10) / 10;
    N.divs = Math.max(0, N.divs - res.enemyLost);
    // Высадкой через пролив можно измотать оборону, но не захватить регион целиком
    const floor = res.sea ? 25 : 0;
    const before = target.control;
    target.control = Math.max(Math.min(target.control, floor), target.control - res.controlDrop);
    res.controlDrop = Math.round(before - target.control);
    if (res.ratio >= 1) {
      this.log('mil', res.sea ? 'Вражеский десант' : 'Вражеское наступление',
        `${N.name} атакует. Направление: ${target.name}. Контроль −${res.controlDrop}%, наши потери: ${res.playerLost} див.`, target.id, Y);
    } else {
      this.log('mil', 'Атака отбита',
        `Оборона выстояла. Направление: ${target.name}. Противник (${N.name}) потерял ${U.fmt(res.enemyLost, 1)} див.`, target.id, Y);
    }
    Bus.emit('enemyAttack', { by: N.id, srcId: src.id, targetId: target.id, ratio: res.ratio, power: Y, controlDrop: res.controlDrop, control: target.control });
    if (target.control <= 0) this.loseRegion(target, N);
    Bus.emit('stateChanged');
  },
  loseRegion(t, N) {
    const Y = t.ctrl;
    t.ctrl = N.id;
    t.control = 60;
    t.fort = Math.max(0, t.fort - 1);
    t.lostFrom = Y;
    t.alerted = false;
    this._gw = null;
    const home = this.c(t.cid);
    if (home) home.intel[Y] = Math.min(home.intel[Y] || 60, 60);
    this.retreatArmies(t, Y);
    this.log('alert', 'Регион потерян', `Фронт прорван. Под контролем противника (${N.name}): ${t.name}.`, t.id, Y);
    Bus.emit('mapDirty');
    if (t.id !== this.capitalRegion(Y)) {
      this.popup({
        id: 'sys_lost_' + t.id, art: 'i-swords', cat: 'alert',
        title: 'Прорыв фронта',
        text: `Противник прорвал оборону. Регион «${t.name}» оккупирован, его заводы больше не работают на нас. Освободить его можно наступлением.`,
        options: [{ label: 'Ни шагу назад!', tip: 'Организуйте контрнаступление', fx: () => {} }]
      }, {}, Y);
    }
    this.checkEnd();
  },

  /* --- Мир (статус-кво): занятые в войне регионы возвращаются --- */
  peaceTarget(x) {
    if (this.isRegion(x)) return this.ownerNation(x);
    if (this.isPower(x.ctrl)) return x;
    return x.ctrl === x.id ? x : this.c(x.ctrl);
  },
  peaceChance(c) {
    const S = this.S, enemy = this.peaceTarget(c);
    if (!enemy || this.isPower(enemy.ctrl)) return 0;
    const occupied = this.lands(enemy.id).filter(r => r.cid !== enemy.id).length;
    const lost = this.regionsOf(enemy.id).filter(r => r.ctrl === this.cur).length;
    const total = this.regionsOf(enemy.id).length || 1;
    const fatigue = Math.min(0.3, (enemy.warDays || 0) / 365 * 0.15);
    const p = 0.25 + lost / total * 0.6 + (enemy.divs < this.P().divs * 0.5 ? 0.15 : 0) + fatigue - S.tension / 400 - occupied * 0.05;
    return U.clamp(p, 0.05, 0.9);
  },
  // Вернуть регионы, отнятые друг у друга в войне сторон a и b
  restoreBetween(a, b) {
    for (const r of this.regionList()) {
      if (r.ctrl === a && r.lostFrom === b) this.transferRegion(r, b, { peaceful: true });
      else if (r.ctrl === b && r.lostFrom === a) this.transferRegion(r, a, { peaceful: true });
    }
  },
  makePeace(enemy, X = this.cur) {
    if (!enemy || !enemy.wars[X]) return false;
    delete enemy.wars[X];
    enemy.warDays = 0;
    this.restoreBetween(enemy.id, X);
    this.addTension(-5);
    this.log('dip', 'Белый мир', `Подписан мир на условиях довоенного статус-кво. Сторона договора: ${enemy.name}.`, enemy.id, X);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    return true;
  },
  makePowerPeace(X, Y) {
    const k = this.pairKey(X, Y);
    if (!this.S.pwars[k]) return;
    delete this.S.pwars[k];
    this.restoreBetween(X, Y);
    this.addTension(-5);
    this.news('Мир между державами', `${POWERS[X].name} и ${POWERS[Y].name} подписывают мир на условиях статус-кво.`, null, 'war');
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },

  /* --- Укрепления — в регионе --- */
  canFortify(r) {
    if (this.outReason()) return this.outReason();
    if (!r || r.ctrl !== this.cur) return 'Только на своей территории';
    if (r.fort >= 3) return 'Максимальный уровень';
    if (this.P().pp < CFG.FORTIFY_PP) return `Нужно ${CFG.FORTIFY_PP} ПВ`;
    return null;
  },
  fortify(id) {
    const r = this.r(id), why = this.canFortify(r);
    if (why) return this.fail(why);
    this.P().pp -= CFG.FORTIFY_PP;
    r.fort++;
    this.log('mil', 'Укрепрайон', `Возведён оборонительный рубеж ${r.fort}-го уровня. Регион: ${r.name}.`, id);
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* --- Ядерный удар — по региону --- */
  canNuke(r) {
    if (this.outReason()) return this.outReason();
    if (!this.mods.nukes) return 'Требуется межконтинентальная ракета (4-й уровень ядерной ветки)';
    if (!r || r.ctrl === this.cur) return 'Это наша территория';
    const N = this.ownerNation(r);
    if (!N || N.inert) return 'Здесь нет государства';
    if (this.isAlly(N)) return 'Союзник по блоку';
    if (r.radioactive) return 'Уже радиоактивная пустошь';
    if (this.P().warheads < 1) return 'Нет боеголовок';
    return null;
  },
  nuke(id) {
    const S = this.S, X = this.cur, r = this.r(id);
    const why = this.canNuke(r);
    if (why) return this.fail(why);
    const P = this.P();
    P.warheads--;
    P.stats.nukes++;
    const Y = this.powerOf(r), N = this.ownerNation(r);
    const before = { factories: r.factories, divs: this.regionDefenders(r), control: r.control };
    const wasWar = this.atWar(r);
    const faction = N.faction;
    if (!Y) N.divs = Math.max(0, N.divs - this.garrison(r) * (this.mods.thermo ? 1 : 0.85));
    this.applyNuclearDamage(r, true);
    if (Y) this.takeLosses(r, Y, this.landDefenders(r, Y) * (this.mods.thermo ? 1 : 0.85));
    const after = { factories: r.factories, divs: this.regionDefenders(r), control: r.control };
    const dt = faction === 'NEU' ? 35 : CFG.NUKE_TENSION;
    this.addTension(dt);
    if (this.mods.thermo) {
      for (const n of Regions.nb(id)) {
        const t = this.r(n);
        if (!t || t.ctrl === X) continue;
        const M = this.ownerNation(t);
        if (M && !this.isPower(t.ctrl) && !this.isAlly(M)) M.divs *= 0.92;
      }
    }
    let capitulated = false, gained = 0;
    if (wasWar && r.control <= 0) {
      capitulated = true;
      const prev = r.ctrl;
      gained = this.transferRegion(r, X);
      if (!this.isPower(prev)) this.checkCapitulation(this.c(prev), X);
    } else if (!wasWar) {
      if (Y) S.pwars[this.pairKey(X, Y)] = { since: S.day };
      else if (N.ctrl === N.id) { N.wars[X] = true; N.warDays = 0; AI.onPlayerDeclares(N, X); }
    }
    const usa = this.c('USA');
    const usaAI = usa && usa.ctrl === 'USA' && !usa.radioactive && r.cid !== 'USA';
    let retaliation = false;
    if (usaAI && (faction === 'WEST' || usa.wars[X]) && U.chance(0.6)) {
      retaliation = true;
      S.scheduled.push({ day: S.day + U.randi(3, 6), type: 'retaliation', by: 'USA', victim: X });
      if (!usa.wars[X]) this.aiDeclareWar('USA', X, 'Вашингтон отвечает на ядерный удар');
    }
    this.log('nuke', 'Стратегический удар', `Ракета поразила цель: ${r.name}. Регион превращён в радиоактивную пустошь.`, id, null);
    this.news(`Ядерный удар: ${r.name}`, `Держава «${POWERS[X].name}» применила ядерное оружие. Мир на грани.`, id, 'war');
    if (Y) {
      this.popup({
        id: 'sys_nuked', art: 'i-nuke', cat: 'nuke', title: 'Ядерный удар по нашей территории',
        text: `${POWERS[X].name} нанесли ядерный удар. Цель: ${r.name}. Регион превращён в радиоактивную пустошь, войска на этом участке уничтожены.`,
        options: [{ label: 'Мы выстоим', tip: 'Регион потерял все заводы', fx: () => {} }]
      }, {}, Y);
    }
    Bus.emit('nuke', {
      by: X, targetId: id, name: r.name, before, after, reinforced: 0,
      tension: dt, retaliation, capitulated, gained, thermo: this.mods.thermo, wastelands: this.wastelands()
    });
    Bus.emit('stateChanged');
    this.checkEnd();
    return { ok: true };
  },
  applyNuclearDamage(r, byPower) {
    r.radioactive = true;
    r.factories = 0;
    r.pop = Math.round(r.pop * 0.6);
    r.fort = 0;
    if (byPower) { if (this.atWar(r)) r.control = Math.max(0, r.control - 70); }
    else r.control = Math.max(0, r.control - 50);
    Bus.emit('mapDirtyDelayed');
  },

  /* --- Конец игры: столичный регион державы --- */
  checkEnd() {
    const S = this.S;
    if (!S || S.over) return;
    if (this.wastelands() >= CFG.NUCLEAR_WINTER) return this.end('defeat', 'winter', null);
    for (const tag of this.alive()) {
      const cap = this.r(this.capitalRegion(tag));
      if (!cap || cap.ctrl !== tag) {
        this.P(tag).out = true;
        this.log('alert', 'Капитуляция державы', `${POWERS[tag].name}: столица (${POWERS[tag].capitalName}) пала. Держава выбывает из борьбы.`, cap && cap.id, null);
        Bus.emit('powerOut', { power: tag });
      }
    }
    const alive = this.alive(), all = this.tags();
    if (!alive.length) return this.end('defeat', 'capital', null);
    if (all.length > 1 && alive.length === 1) return this.end('victory', 'lastStanding', alive[0]);
    if (S.victoryShown) return;
    for (const tag of alive) {
      if (this.industryShare(tag) >= CFG.VICTORY_SHARE) return this.end('victory', 'industry', tag);
      const rivals = POWERS[tag].rivals.map(id => this.r(Regions.capitalOf[id])).filter(Boolean);
      if (rivals.length && rivals.every(r => r.ctrl === tag)) return this.end('victory', 'rivals', tag);
    }
  }
});
