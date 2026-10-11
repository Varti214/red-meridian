'use strict';
/* ============================================================
   ИГРА: состояние, ежедневный такт, экономика и действия игроков.
   Всё состояние лежит в одном объекте Game.S — сохранение игры
   это просто JSON.stringify(Game.S).

   ДЕРЖАВЫ. Люди играют за «державы»: СССР (SOV), США (WST), Рейх (AXS).
   У каждой — свои ресурсы, наука, фокусы и разведданные: Game.S.powers[тег].
   Блок, который никто не выбрал, ведёт ИИ как обычные страны.

   ПЕРСПЕКТИВА. Game.cur — тег державы, «от лица» которой сейчас считается
   код: Game.P() — её ресурсы, Game.mods — её бонусы. Game.as(тег, fn)
   временно переключает перспективу. Так одни и те же функции работают
   и в одиночной игре (cur = me), и на сервере (as(игрок, действие)).
   ============================================================ */

const TECH_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));
const FOCUS_BY_ID = Object.fromEntries(FOCUSES.map(f => [f.id, f]));
const DAY_MS = 86400000;

const Game = {
  S: null,
  cur: 'SOV',          // чья перспектива сейчас
  me: 'SOV',           // за кого играет этот браузер
  server: false,       // true — код работает на сервере сетевой игры
  diff: DIFFICULTY.normal,
  modsCache: {},
  pending: {},         // события, ждущие решения игрока: iid → { def, ctx, power, day }
  eventSeq: 0,

  /* ---------------- ПЕРСПЕКТИВА ---------------- */
  P(tag = this.cur) { return this.S && this.S.powers[tag]; },
  get mods() { return this.modsFor(this.cur); },
  as(tag, fn) {
    const prev = this.cur;
    this.cur = tag;
    try { return fn(); } finally { this.cur = prev; }
  },
  tags() { return this.S ? Object.keys(this.S.powers) : []; },
  alive() { return this.tags().filter(t => !this.S.powers[t].out); },
  isPower(tag) { return !!(this.S && tag && this.S.powers[tag]); },
  powerOf(c) { return c && this.isPower(c.ctrl) ? c.ctrl : null; },
  mine(c, tag = this.cur) { return !!c && c.ctrl === tag; },
  def(tag = this.cur) { return POWERS[tag]; },
  // Союзник державы: независимая страна её блока (для СССР — Коминтерн)
  isAlly(c, tag = this.cur) { return !!c && c.ctrl === c.id && !c.inert && POWERS[tag].family.includes(c.faction); },

  /* ---------------- СОЗДАНИЕ ИГРЫ ---------------- */
  newGame(difficulty = 'normal', tags = ['SOV'], names = {}) {
    const S = {
      v: 2, day: 0, date: CFG.START_DATE, difficulty,
      speed: 1, paused: true,
      tension: CFG.START.tension,
      countries: {}, powers: {}, pwars: {},
      log: [], logSeq: 0,
      flags: {}, firedEvents: {}, lastEvent: {}, nextRandomEvent: {},
      scheduled: [],
      over: null, victoryShown: false,
      me: this.server ? null : this.me     // за кого играет браузер (для одиночных сохранений)
    };
    this.S = S;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.modsCache = {};
    this.pending = {};
    for (const f of Geo.features) S.countries[f.properties.id] = this.makeCountry(f);

    // Если за СССР никто не играет — союзные республики подчинены Москве как единая ИИ-держава
    if (!tags.includes('SOV')) {
      for (const id of USSR_CORE) { const c = S.countries[id]; if (c && id !== 'RUS') c.ctrl = 'RUS'; }
    }
    for (const tag of tags) this.createPower(tag, names[tag]);
    this.eachCountry(c => { for (const t of tags) c.intel[t] = this.baseIntel(c, t); });

    for (const tag of tags) {
      const d = POWERS[tag];
      this.log('info', 'Новый курс', `${d.title} ${d.leader} принимает руководство. Мир затаил дыхание.`, d.capital, tag);
    }
    this.log('intel', 'Сводка разведки', 'Блоки наблюдают друг за другом. Разведданные по большинству стран неполны.', null, null);
    Bus.emit('newGame');
  },

  makeCountry(f) {
    const p = f.properties, id = p.id;
    const ov = COUNTRY_OVERRIDES[id] || {};
    let faction = 'NEU';
    if (USSR_CORE.includes(id)) faction = 'SOV';
    else {
      for (const [fac, list] of Object.entries(FACTION_MEMBERS)) if (list.includes(id)) faction = fac;
    }
    const gdpB = (p.gdp || 0) / 1000;
    const facGen = U.clamp(Math.round(Math.log10(gdpB + 1) * 1.8 - 0.6), 0, 5);
    const factories = ov.fac != null ? ov.fac : facGen;
    const divsGen = Math.max(1, Math.round(factories * 0.9 + Math.log10((p.pop || 1e6) / 1e6 + 1) * 2.2));
    const divs = faction === 'NONE' ? 0 : (ov.divs != null ? ov.divs : divsGen);
    return {
      id, name: p.name, faction,
      ctrl: id, core: null,
      major: MAJORS.includes(id) || id === 'RUS',
      inert: faction === 'NONE',
      factories, pop: p.pop || 1e6,
      divs, baseDivs: divs, fort: ov.fort || 0,
      intel: {}, noise: U.rand(-1, 1),
      sab: 0, sabDays: 0, control: 100,
      wars: {}, warDays: 0, cb: {}, influence: null, integrate: null,
      radioactive: false, lostFrom: null
    };
  },

  createPower(tag, playerName) {
    const d = POWERS[tag];
    let divs = d.divs;
    for (const id of d.start) {
      const c = this.S.countries[id];
      if (!c) continue;
      if (!d.divs) divs += c.divs;
      c.ctrl = tag; c.core = tag; c.faction = d.faction;
      c.divs = 0; c.baseDivs = 0;
    }
    this.S.powers[tag] = {
      tag, player: playerName || '', out: false,
      pp: CFG.START.pp, mp: d.mp, divs: Math.round(divs), org: CFG.START.org, rp: CFG.START.rp,
      warheads: 0, warheadTimer: 0, factoryTimer: 0,
      training: [], research: [], techs: [], focus: null, focuses: [],
      stats: { won: 0, lost: 0, annexed: 0, nukes: 0, spyOk: 0, spyFail: 0, divLost: 0, enemyKilled: 0 }
    };
    this.S.nextRandomEvent[tag] = 45;
  },

  baseIntel(c, tag = this.cur) {
    if (c.ctrl === tag || this.isAlly(c, tag)) return 100;
    if (this.bordersPower(c.id, tag)) return 35;
    if (c.major || this.isPower(c.ctrl)) return 25;
    return 12;
  },
  intel(c, tag = this.cur) {
    const v = c.intel[tag];
    return v == null ? this.baseIntel(c, tag) : v;
  },

  /* ---------------- МОДИФИКАТОРЫ ОТ ТЕХНОЛОГИЙ И ФОКУСОВ ---------------- */
  modsFor(tag) {
    const P = this.P(tag);
    if (!P) return this.emptyMods();
    const key = P.techs.join(',') + '|' + P.focuses.join(',');
    const hit = this.modsCache[tag];
    if (hit && hit.key === key) return hit.m;
    const m = this.emptyMods();
    const apply = fx => {
      for (const [k, v] of Object.entries(fx)) {
        if (k === 'factories' || k === 'mp') continue;        // разовые эффекты
        if (k === 'attack') m.attack = Math.max(m.attack, v);  // лучший танк заменяет предыдущий
        else if (k === 'factoryEvery') m.factoryEvery = Math.min(m.factoryEvery, v);
        else if (k === 'tensionDecay') m.tensionDecay = Math.max(m.tensionDecay, v);
        else if (typeof v === 'boolean') m[k] = m[k] || v;
        else m[k] = (m[k] || 0) + v;
      }
    };
    P.techs.forEach(id => TECH_BY_ID[id] && apply(TECH_BY_ID[id].fx));
    P.focuses.forEach(id => FOCUS_BY_ID[id] && apply(FOCUS_BY_ID[id].fx));
    m.orgRegen = CFG.ORG_REGEN * (1 + m.org);
    m.warheadDays = m.thermo ? 45 : CFG.WARHEAD_DAYS;
    this.modsCache[tag] = { key, m };
    return m;
  },
  emptyMods() {
    return {
      attack: 1, attackBonus: 0, loss: 0, org: 0, factoryEvery: Infinity, rp: 0, pp: 0, train: 0,
      spyCost: 0, spyChance: 0, spyTension: 0, intelKeep: false, justify: 0, influence: 0,
      tensionDecay: 1, mpMult: 0, nucCost: 0, nucDays: 0, nukes: false, thermo: false,
      orgRegen: CFG.ORG_REGEN, warheadDays: CFG.WARHEAD_DAYS
    };
  },
  recalcMods() { this.modsCache = {}; },

  /* ---------------- НАЗВАНИЯ ДЛЯ РАЗНЫХ ДЕРЖАВ ---------------- */
  techName(t, tag = this.cur) { return (TECH_NAMES[tag] && TECH_NAMES[tag][t.id]) || t.name; },
  focusName(f, tag = this.cur) { return (FOCUS_NAMES[tag] && FOCUS_NAMES[tag][f.id]) || f.name; },
  branchName(b, tag = this.cur) { return (BRANCH_NAMES[tag] && BRANCH_NAMES[tag][b.id]) || b.name; },

  /* ---------------- ВЫБОРКИ ---------------- */
  c(id) { return this.S && this.S.countries[id]; },
  eachCountry(fn) { for (const id in this.S.countries) fn(this.S.countries[id]); },
  list(pred) { return Object.values(this.S.countries).filter(pred); },
  lands(tag = this.cur) { return this.list(c => c.ctrl === tag); },
  playerLands() { return this.lands(); },
  annexedLands(tag = this.cur) { return this.list(c => c.ctrl === tag && c.core !== tag && !c.radioactive); },
  allies(tag = this.cur) { return this.list(c => this.isAlly(c, tag) && c.faction === POWERS[tag].allyFaction); },
  comAllies() { return this.allies(); },
  isIndependent(id) { const c = this.c(id); return !!c && c.ctrl === c.id; },

  pairKey(a, b) { return [a, b].sort().join('|'); },
  powersAtWar(a, b) { return a !== b && !!this.S.pwars[this.pairKey(a, b)]; },
  // Воюет ли территория c с державой tag (с учётом оккупации и войн между державами)
  atWar(c, tag = this.cur) {
    if (!c || c.inert || c.ctrl === tag) return false;
    if (this.isPower(c.ctrl)) return this.powersAtWar(c.ctrl, tag);
    const k = c.ctrl === c.id ? c : this.c(c.ctrl);
    return !!(k && k.wars[tag]);
  },
  fronts(tag = this.cur) { return this.list(c => this.atWar(c, tag)); },
  bordersPower(id, tag = this.cur) {
    const meta = Geo.meta[id];
    return !!meta && meta.neighbors.some(n => { const c = this.c(n); return c && c.ctrl === tag; });
  },
  bordersPlayer(id) { return this.bordersPower(id, this.cur); },
  hostileBorderCount(tag = this.cur) { return this.fronts(tag).filter(c => this.bordersPower(c.id, tag)).length; },
  wastelands() { return this.list(c => c.radioactive).length; },
  justified(c, tag = this.cur) { return c.cb[tag] === true; },
  justifying(c, tag = this.cur) { const v = c.cb[tag]; return v && v !== true ? v : null; },

  // Снабжение наступления: сухопутная граница — 100%, только через пролив — 80%, десант — 55%
  supplyFactor(id, tag = this.cur) {
    const nb = (Geo.meta[id] || { neighbors: [] }).neighbors.filter(n => { const c = this.c(n); return c && c.ctrl === tag; });
    if (!nb.length) return 0.55;
    return nb.some(n => !Geo.isSea(id, n)) ? 1 : 0.8;
  },
  supplyLabel(id) {
    const s = this.supplyFactor(id);
    return s === 1 ? 'Сухопутная граница' : s === 0.8 ? 'Форсирование пролива −20%' : 'Десант без общей границы −45%';
  },

  // Стойкость государства: крупная промышленность — фронт рушится медленнее. Пустошь стойкость теряет.
  resilience(c) { return c.ctrl === c.id ? 1 + c.factories / 15 : 1.2; },
  // Военно-технический прогресс ИИ: оборона мира растёт с каждым годом
  aiTech(c) {
    const years = this.S.day / 365;
    return 1 + years * (['WEST', 'AXIS', 'SOV'].includes(c.faction) ? 0.06 : 0.03);
  },

  playerFactories(tag = this.cur) { let s = 0; this.eachCountry(c => { if (c.ctrl === tag) s += c.factories; }); return s; },
  worldFactories() { let s = 0; this.eachCountry(c => { if (!c.inert) s += c.factories; }); return s; },
  industryShare(tag = this.cur) { const w = this.worldFactories(); return w ? this.playerFactories(tag) / w : 0; },

  // Оценка численности войск с учётом разведданных (для другой державы — её армия на этом участке)
  estDivs(c, tag = this.cur) {
    const Y = this.powerOf(c);
    const real = Y && Y !== tag ? this.powerDefenders(Y) : c.divs;
    const intel = this.intel(c, tag);
    if (intel >= 80 || c.ctrl === tag || this.isAlly(c, tag)) return { mid: real, lo: Math.round(real), hi: Math.round(real), exact: true };
    const err = (1 - intel / 100) * 0.5;
    const mid = Math.max(0, real * (1 + c.noise * err * 0.6));
    return { mid, lo: Math.max(0, Math.floor(mid * (1 - err))), hi: Math.max(1, Math.ceil(mid * (1 + err))), exact: false };
  },
  // Армия державы делится между всеми её враждебными границами
  powerDefenders(Y) { return this.P(Y).divs / Math.max(1, this.hostileBorderCount(Y)); },

  /* ---------------- ЕЖЕДНЕВНЫЕ ПРИРОСТЫ (для текущей державы) ---------------- */
  dailyPP() { return (CFG.PP_BASE + this.mods.pp + this.allies().length * 0.1) * this.diff.pp; },
  dailyRP() { return (CFG.RP_BASE + this.playerFactories() * CFG.RP_PER_FACTORY) * (1 + this.mods.rp) * 1.1; },
  dailyMP() {
    let s = 0;
    const tag = this.cur;
    this.eachCountry(c => {
      if (c.ctrl === tag && !c.radioactive) s += c.pop * CFG.MP_PER_POP * (c.core === tag ? 1 : CFG.ANNEXED_MP);
    });
    return s * (1 + this.mods.mpMult);
  },

  /* ---------------- ИЗМЕНЕНИЕ РЕСУРСОВ (события, ИИ) ---------------- */
  addPP(n) { const P = this.P(); P.pp = Math.max(0, P.pp + n); },
  addRP(n) { const P = this.P(); P.rp = Math.max(0, P.rp + n); },
  addMP(n) { const P = this.P(); P.mp = Math.max(0, P.mp + n); },
  addDivs(n) { const P = this.P(); P.divs = Math.max(0, P.divs + n); },
  addTension(n) { this.S.tension = U.clamp(this.S.tension + n, 0, 100); },
  addFactories(n, announce) {
    let target = this.c(this.def().capital);
    if (!target || target.ctrl !== this.cur || target.radioactive) {
      const lands = this.lands().filter(c => !c.radioactive);
      if (!lands.length) return;
      target = U.pick(lands);
    }
    target.factories += n;
    if (announce) this.log('success', 'Новый завод', `Введено в строй предприятий: ${n}. Регион: ${target.name}.`, target.id);
  },
  setFaction(id, fac) {
    const c = this.c(id);
    if (!c || c.ctrl !== c.id) return;
    c.faction = fac;
    c.cb = {}; c.influence = null;
    for (const t of this.tags()) if (POWERS[t].family.includes(fac)) c.intel[t] = 100;
    this.log('dip', 'Новый союзник', `${c.name} вступает в блок «${FACTIONS[fac].name}».`, id, null);
    Bus.emit('mapDirty');
  },
  applySabotage(c, v, days) {
    c.sab = Math.min(0.6, c.sab + v);
    c.sabDays = Math.max(c.sabDays, days);
  },
  boostResearch(branch, days) {
    const r = this.P().research.find(x => TECH_BY_ID[x.id].branch === branch);
    if (!r) return false;
    r.daysLeft = Math.max(1, r.daysLeft - days);
    return true;
  },

  /* ---------------- ЖУРНАЛ И СОБЫТИЯ С ВЫБОРОМ ----------------
     to — тег державы, которой адресована запись (null — всем). */
  log(cat, title, text, cid, to) {
    const S = this.S;
    if (to === undefined) to = this.cur;
    const e = { id: ++S.logSeq, date: S.date, cat, title, text, cid: cid || null, to: to || null };
    S.log.unshift(e);
    if (S.log.length > 200) S.log.length = 200;
    Bus.emit('log', e);
  },

  // Событие с вариантами ответа. tag = null — каждой живой державе своё.
  popup(def, ctx = {}, tag) {
    if (tag === undefined) tag = this.cur;
    if (tag === null) { for (const t of this.alive()) this.popup(def, ctx, t); return; }
    if (!this.isPower(tag)) return;
    const iid = 'e' + (++this.eventSeq);
    const text = typeof def.text === 'function' ? this.as(tag, () => def.text(ctx)) : def.text;
    const view = { id: def.id, title: def.title, text, art: def.art, cat: def.cat, options: def.options.map(o => ({ label: o.label, tip: o.tip || '' })) };
    this.pending[iid] = { def, ctx, power: tag, day: this.S.day, t: Date.now(), view };
    Bus.emit('event', { iid, power: tag, view });
  },
  // Неотвеченные события державы (для повторной отправки после переподключения)
  pendingFor(tag) {
    return Object.entries(this.pending).filter(([, p]) => p.power === tag).map(([iid, p]) => ({ iid, power: tag, view: p.view }));
  },

  chooseEvent(iid, idx) {
    const p = this.pending[iid];
    if (!p || p.power !== this.cur) return this.fail('Событие уже неактуально');
    delete this.pending[iid];
    const opt = p.def.options[idx] || p.def.options[0];
    try { opt.fx && opt.fx(p.ctx); } catch (err) { console.error('[event]', p.def.id, err); }
    if (p.def.options.length > 1) this.log('info', p.def.title, `Решение: «${opt.label}».${opt.tip ? ' ' + opt.tip + '.' : ''}`);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* ---------------- ЕЖЕДНЕВНЫЙ ТАКТ ---------------- */
  tick() {
    const S = this.S;
    if (S.over) return;
    S.day++;
    S.date += DAY_MS;

    for (const tag of this.alive()) this.as(tag, () => this.tickPower());

    this.tickProjects();
    let anyWar = false;
    for (const tag of this.alive()) if (this.fronts(tag).length) anyWar = true;
    const decay = Math.max(...this.tags().map(t => this.modsFor(t).tensionDecay), 1);
    S.tension = U.clamp(S.tension - CFG.TENSION_DECAY * decay * (anyWar ? 0.5 : 1), 0, 100);

    this.as(null, () => AI.daily());
    this.tickScheduled();
    for (const tag of this.alive()) this.as(tag, () => this.tickEvents());
    if (this.server) this.autoResolveEvents();
    this.checkEnd();

    if (!this.server && S.day % CFG.AUTOSAVE_DAYS === 0) this.save(true);
    Bus.emit('tick');
  },

  tickPower() {
    const P = this.P(), m = this.mods;
    P.pp += this.dailyPP();
    P.rp += this.dailyRP();
    P.mp += this.dailyMP();
    P.org = Math.min(100, P.org + m.orgRegen);
    if (isFinite(m.factoryEvery) && ++P.factoryTimer >= m.factoryEvery) {
      P.factoryTimer = 0;
      this.addFactories(1, true);
    }
    if (m.nukes && ++P.warheadTimer >= m.warheadDays) {
      P.warheadTimer = 0;
      P.warheads++;
      this.log('nuke', 'Новая боеголовка', `Ядерный арсенал пополнен. Боеголовок в наличии: ${P.warheads}.`);
    }
    // Свои земли постепенно восстанавливают контроль
    this.eachCountry(c => { if (c.ctrl === this.cur && c.control < 100) c.control = Math.min(100, c.control + 0.6); });
    this.tickTraining();
    this.tickResearch();
    this.tickFocus();
  },

  tickTraining() {
    const P = this.P();
    for (const t of P.training) t.daysLeft--;
    const done = P.training.filter(t => t.daysLeft <= 0);
    if (!done.length) return;
    P.training = P.training.filter(t => t.daysLeft > 0);
    const n = done.reduce((s, t) => s + t.count, 0);
    P.divs += n;
    this.log('mil', 'Дивизии сформированы', `В строй вступает: ${U.divs(n)}. Всего в армии: ${P.divs}.`, this.def().capital);
    Bus.emit('stateChanged');
  },

  tickResearch() {
    const P = this.P();
    for (const r of P.research) r.daysLeft--;
    const done = P.research.filter(r => r.daysLeft <= 0);
    if (!done.length) return;
    P.research = P.research.filter(r => r.daysLeft > 0);
    for (const r of done) {
      const t = TECH_BY_ID[r.id];
      P.techs.push(r.id);
      this.log('sci', 'Исследование завершено', `«${this.techName(t)}». ${t.desc}`);
      Bus.emit('techDone', { power: this.cur, name: this.techName(t) });
      if (r.id === 'nuc3') {
        this.popup({
          id: 'sys_nuketest', art: 'i-nuke', cat: 'nuke',
          title: `Испытание: ${this.techName(t)}`,
          text: 'Ядерный заряд готов к подрыву на полигоне. Объявить о нём на весь мир или провести испытание втайне?',
          options: [
            { label: 'Провести открыто', tip: '+40 ПВ · напряжённость +8', fx: () => { this.addPP(40); this.addTension(8); } },
            { label: 'Провести тайно', tip: 'Напряжённость +2', fx: () => this.addTension(2) }
          ]
        });
      }
      if (r.id === 'nuc4') {
        P.warheads += 1;
        P.warheadTimer = 0;
        this.log('nuke', 'Ракетно-ядерный щит', 'Межконтинентальная ракета принята на вооружение. Ядерный удар доступен в панели любой вражеской страны.');
        this.popup({
          id: 'sys_r7', art: 'i-nuke', cat: 'nuke',
          title: 'Ракетно-ядерный щит',
          text: 'С полигона стартовала межконтинентальная ракета. Теперь любая точка планеты в 30 минутах от возмездия. Первая боеголовка передана в распоряжение верховного командования.',
          options: [{ label: 'Да поможет нам разум', tip: '+1 боеголовка · ядерный удар разблокирован', fx: () => {} }]
        });
      }
    }
    Bus.emit('stateChanged');
  },

  tickFocus() {
    const P = this.P();
    if (!P.focus) return;
    if (--P.focus.daysLeft > 0) return;
    const f = FOCUS_BY_ID[P.focus.id];
    P.focuses.push(f.id);
    P.focus = null;
    if (f.fx.factories) this.addFactories(f.fx.factories);
    if (f.fx.mp) this.addMP(f.fx.mp);
    this.log('success', 'Национальный фокус выполнен', `«${this.focusName(f)}». ${f.desc}`);
    Bus.emit('focusDone', { power: this.cur, name: this.focusName(f) });
    Bus.emit('stateChanged');
  },

  tickProjects() {
    const S = this.S;
    this.eachCountry(c => {
      for (const [tag, v] of Object.entries(c.cb)) {
        if (v === true || !this.isPower(tag)) continue;
        if (--v.daysLeft <= 0) {
          c.cb[tag] = true;
          this.log('dip', 'Повод для войны получен', `Цель: ${c.name}. Можно объявлять войну.`, c.id, tag);
          Bus.emit('mapDirty');
          Bus.emit('stateChanged');
        }
      }
      if (c.influence && --c.influence.daysLeft <= 0) {
        const { by, pp } = c.influence;
        c.influence = null;
        const p = U.clamp(0.75 - S.tension / 250, 0.25, 0.9);
        if (this.isPower(by) && c.ctrl === c.id && !this.tags().some(t => c.wars[t]) && U.chance(p)) {
          this.setFaction(c.id, POWERS[by].allyFaction);
        } else if (this.isPower(by)) {
          this.P(by).pp += Math.round(pp / 2);
          this.log('dip', 'Влияние отвергнуто', `Правительство не пошло на сближение. Половина затрат возвращена. Страна: ${c.name}.`, c.id, by);
        }
        Bus.emit('stateChanged');
      }
      if (c.integrate && --c.integrate.daysLeft <= 0) {
        const by = c.integrate.by;
        c.integrate = null;
        if (this.isPower(by) && this.isAlly(c, by)) {
          this.transferLand(c, by, { peaceful: true });
          this.log('success', 'Мирное объединение', `${c.name} входит в состав державы.`, c.id, by);
        }
        Bus.emit('stateChanged');
      }
    });
  },

  tickScheduled() {
    const S = this.S;
    const due = S.scheduled.filter(s => S.day >= s.day);
    if (!due.length) return;
    S.scheduled = S.scheduled.filter(s => S.day < s.day);
    for (const s of due) {
      if (s.type === 'retaliation') AI.enemyNuke(this.c(s.by), s.victim);
    }
  },

  // События для текущей державы: исторические по датам и случайные
  tickEvents() {
    const S = this.S, tag = this.cur;
    const mine = e => (e.powers || ['SOV']).includes(tag);
    const key = id => tag + ':' + id;
    for (const e of EVENTS) {
      if (!e.date || !mine(e) || S.firedEvents[key(e.id)]) continue;
      const at = Date.parse(e.date + 'T00:00:00Z');
      if (S.date < at) continue;
      if (!e.cond || e.cond()) { this.fireEvent(e); return; }
      if (S.date > at + 120 * DAY_MS) S.firedEvents[key(e.id)] = 'skipped';
    }
    if (S.day >= (S.nextRandomEvent[tag] || 45)) {
      S.nextRandomEvent[tag] = S.day + U.randi(35, 70);
      const pool = EVENTS.filter(e => e.weight && mine(e) && (S.firedEvents[key(e.id)] || 0) < 3 && S.lastEvent[tag] !== e.id && (!e.cond || e.cond()));
      const e = U.weightedPick(pool, e => e.weight);
      if (e) this.fireEvent(e);
    }
  },

  fireEvent(e) {
    const S = this.S, k = this.cur + ':' + e.id;
    S.firedEvents[k] = (typeof S.firedEvents[k] === 'number' ? S.firedEvents[k] : 0) + 1;
    S.lastEvent[this.cur] = e.id;
    const ctx = e.setup ? e.setup() : {};
    this.popup(e, ctx);
  },

  // В сетевой игре время не ждёт: событие без ответа 60 игровых дней (и не меньше минуты) решается первым вариантом
  autoResolveEvents() {
    const now = Date.now();
    for (const [iid, p] of Object.entries(this.pending)) {
      if (this.S.day - p.day >= 60 && now - p.t >= 60000) {
        this.as(p.power, () => this.chooseEvent(iid, 0));
        Bus.emit('eventClosed', { iid, power: p.power });
      }
    }
  },

  /* ---------------- ПОБЕДА И ПОРАЖЕНИЕ ---------------- */
  checkEnd() {
    const S = this.S;
    if (S.over) return;
    if (this.wastelands() >= CFG.NUCLEAR_WINTER) return this.end('defeat', 'winter', null);
    for (const tag of this.alive()) {
      const d = POWERS[tag], cap = this.c(d.capital);
      if (!cap || cap.ctrl !== tag) {
        this.P(tag).out = true;
        this.log('alert', 'Капитуляция державы', `${d.name}: столица (${d.capitalName}) пала. Держава выбывает из борьбы.`, d.capital, null);
        Bus.emit('powerOut', { power: tag });
      }
    }
    const alive = this.alive(), all = this.tags();
    if (!alive.length) return this.end('defeat', 'capital', null);
    if (all.length > 1 && alive.length === 1) return this.end('victory', 'lastStanding', alive[0]);
    if (S.victoryShown) return;
    for (const tag of alive) {
      if (this.industryShare(tag) >= CFG.VICTORY_SHARE) return this.end('victory', 'industry', tag);
      const rivals = POWERS[tag].rivals.map(id => this.c(id)).filter(Boolean);
      if (rivals.length && rivals.every(c => c.ctrl === tag)) return this.end('victory', 'rivals', tag);
    }
  },

  end(type, reason, winner) {
    const S = this.S;
    S.over = { type, reason, winner, day: S.day };
    if (type === 'victory') S.victoryShown = true;
    S.paused = true;
    Bus.emit('gameover', S.over);
  },

  continueAfterVictory() {
    if (this.S.over && this.S.over.type === 'victory') this.S.over = null;
    return { ok: true };
  },

  /* ---------------- ВРЕМЯ (кнопки паузы и скорости) ---------------- */
  setPaused(v) { if (!this.S.over) this.S.paused = !!v; return { ok: true }; },
  setSpeed(v) { this.S.speed = U.clamp(Math.round(v), 1, 4); return { ok: true }; },

  /* ============================================================
     ДЕЙСТВИЯ ИГРОКА (от лица Game.cur). Каждое возвращает { ok, msg }.
     Функции can*() возвращают причину, почему действие недоступно (или null).
     ============================================================ */
  fail(msg) { return { ok: false, msg }; },
  outReason() { return this.P() && this.P().out ? 'Ваша держава капитулировала' : null; },

  /* --- Армия --- */
  deployCost(n) { return { pp: CFG.DIV.pp * n, mp: CFG.DIV.mp * n }; },
  trainDays() { return Math.max(3, Math.round(CFG.DIV.days * (1 - this.mods.train))); },
  canDeploy(n) {
    const P = this.P(), c = this.deployCost(n);
    if (this.outReason()) return this.outReason();
    if (P.pp < c.pp) return `Нужно ${c.pp} ПВ`;
    if (P.mp < c.mp) return `Нужно ${U.fmtMP(c.mp)} призывников`;
    return null;
  },
  deploy(n) {
    n = Math.max(1, Math.min(5, Math.round(n)));
    const why = this.canDeploy(n);
    if (why) return this.fail(why);
    const P = this.P(), cost = this.deployCost(n), days = this.trainDays();
    P.pp -= cost.pp;
    P.mp -= cost.mp;
    P.training.push({ count: n, daysLeft: days, total: days });
    this.addTension(0.05 * n);
    this.log('mil', 'Мобилизация', `Начато формирование: ${U.divs(n)}. Срок обучения — ${U.days(days)}.`, this.def().capital);
    Bus.emit('stateChanged');
    return { ok: true };
  },

  canFortify(c) {
    if (this.outReason()) return this.outReason();
    if (!c || c.ctrl !== this.cur) return 'Только на своей территории';
    if (c.fort >= 3) return 'Максимальный уровень';
    if (this.P().pp < CFG.FORTIFY_PP) return `Нужно ${CFG.FORTIFY_PP} ПВ`;
    return null;
  },
  fortify(id) {
    const c = this.c(id), why = this.canFortify(c);
    if (why) return this.fail(why);
    this.P().pp -= CFG.FORTIFY_PP;
    c.fort++;
    this.log('mil', 'Укрепрайон', `Возведён оборонительный рубеж ${c.fort}-го уровня. Регион: ${c.name}.`, id);
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* --- Обоснование и объявление войны --- */
  justifyCost(c) {
    const k = 1 - this.mods.justify;
    return {
      pp: Math.round(Math.min(CFG.JUSTIFY.ppMax, CFG.JUSTIFY.pp + c.factories * CFG.JUSTIFY.ppPerFactory) * k),
      days: Math.max(5, Math.round((CFG.JUSTIFY.days + c.factories * CFG.JUSTIFY.daysPerFactory) * k))
    };
  },
  canJustify(c) {
    if (this.outReason()) return this.outReason();
    if (!c) return 'Нет цели';
    if (c.ctrl === this.cur) return 'Это наша территория';
    if (c.inert) return 'Здесь нет государства';
    if (this.isAlly(c)) return 'Союзник по блоку';
    if (this.atWar(c)) return 'Война уже идёт';
    if (this.justified(c)) return 'Повод уже получен';
    if (this.justifying(c)) return 'Обоснование уже идёт';
    const Y = this.powerOf(c);
    if (Y && this.P(Y).out) return 'Эта держава уже капитулировала';
    if (!Y && c.ctrl !== c.id) return 'Территория под чужим контролем';
    const cost = this.justifyCost(c);
    if (this.P().pp < cost.pp) return `Нужно ${cost.pp} ПВ`;
    return null;
  },
  justify(id) {
    const c = this.c(id), why = this.canJustify(c);
    if (why) return this.fail(why);
    const cost = this.justifyCost(c);
    this.P().pp -= cost.pp;
    c.cb[this.cur] = { daysLeft: cost.days, total: cost.days };
    this.addTension(CFG.JUSTIFY.tension * (c.major ? 1.5 : 1));
    this.log('dip', 'Обоснование войны', `Пропаганда готовит повод для войны. Цель: ${c.name}. Срок — ${U.days(cost.days)}.`, id);
    const Y = this.powerOf(c);
    if (Y) this.log('alert', 'Угроза войны', `Разведка докладывает: держава «${this.def().name}» готовит повод для войны против нас.`, id, Y);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    return { ok: true };
  },

  declareTension(c) {
    return CFG.DECLARE_TENSION * (c.faction === 'AXIS' && this.cur === 'SOV' ? 0.5 : 1) * (c.major || this.isPower(c.ctrl) ? 1.5 : 1);
  },
  canDeclare(c) {
    if (this.outReason()) return this.outReason();
    if (this.atWar(c)) return 'Война уже идёт';
    if (!this.justified(c)) return 'Сначала обоснуйте войну';
    return null;
  },
  declareWar(id) {
    const c = this.c(id), why = this.canDeclare(c);
    if (why) return this.fail(why);
    const X = this.cur, Y = this.powerOf(c);
    delete c.cb[X];
    this.addTension(this.declareTension(c));
    if (Y) {
      this.S.pwars[this.pairKey(X, Y)] = { since: this.S.day };
      this.log('mil', 'Война объявлена', `Мы начинаем войну. Противник: ${POWERS[Y].name}. Все её приграничные земли — фронт.`, id);
      this.log('alert', 'Нам объявлена война', `${POWERS[X].name} объявляет нам войну!`, id, Y);
      this.popup({
        id: 'sys_pwar', art: 'i-swords', cat: 'alert', title: 'Нам объявлена война',
        text: `${POWERS[X].title} ${POWERS[X].leader} объявил войну. ${POWERS[X].name} — теперь наш противник. Готовьте оборону и контрудар.`,
        options: [{ label: 'К оружию!', tip: 'Земли противника отмечены как фронт', fx: () => {} }]
      }, {}, Y);
    } else {
      c.wars[X] = true;
      c.warDays = 0;
      c.divs = c.divs * 1.15 + 1;
      this.log('mil', 'Война объявлена', `Мы начинаем войну. Противник: ${c.name}. Территория стала активным фронтом.`, id);
      if (c.faction === 'AXIS' && X === 'SOV') this.log('dip', 'Запад молча одобряет', 'Вашингтон не скрывает удовлетворения: Советы воюют с Рейхом. Рост напряжённости вдвое ниже.');
      AI.onPlayerDeclares(c, X);
    }
    Bus.emit('war', { by: X, target: id });
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* --- ИИ объявляет войну державе --- */
  aiDeclareWar(id, X, reason) {
    const c = this.c(id);
    if (!c || !this.isPower(X) || c.wars[X] || c.ctrl !== c.id || c.inert || POWERS[X].family.includes(c.faction)) return;
    c.wars[X] = true;
    c.warDays = 0;
    c.divs *= 1.1;
    this.addTension(3);
    this.log('alert', 'Объявление войны', `${c.name} объявляет нам войну. ${reason}.`, id, X);
    Bus.emit('war', { by: id, target: POWERS[X].capital });
    this.popup({
      id: 'sys_war_' + id, art: 'i-swords', cat: 'alert',
      title: 'Нам объявлена война',
      text: `${reason}. Противник: ${c.name}. Войска противника выдвигаются к нашим границам. Его территория отмечена на карте как активный фронт.`,
      options: [{ label: 'К оружию!', tip: 'Организуйте оборону и контрудар', fx: () => {} }]
    }, {}, X);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },

  /* --- Наступление --- */
  canAttack(c) {
    if (this.outReason()) return this.outReason();
    if (!c || c.ctrl === this.cur) return 'Это наша территория';
    if (!this.atWar(c)) return 'Нет состояния войны';
    if (this.P().divs < 1) return 'Нет свободных дивизий';
    if (this.P().org < 10) return 'Армия дезорганизована (организация < 10%)';
    return null;
  },
  attack(id, commit) {
    const S = this.S, X = this.cur, P = this.P(), c = this.c(id);
    const why = this.canAttack(c);
    if (why) return this.fail(why);
    commit = U.clamp(Math.round(commit), 1, P.divs);
    const Y = this.powerOf(c);

    const r = Combat.resolveAttack(c, commit);
    P.divs -= r.playerLost;
    P.org = Math.max(0, P.org - r.orgCost);
    P.mp = Math.max(0, P.mp - Math.round(commit * 0.5));
    if (Y) {
      const PY = this.P(Y);
      r.enemyLost = Math.min(PY.divs, U.probRound(r.enemyLost));
      PY.divs -= r.enemyLost;
      PY.org = Math.max(0, PY.org - 5);
      PY.stats.divLost += r.enemyLost;
    } else {
      c.divs = Math.max(0, c.divs - r.enemyLost);
    }
    c.control = Math.max(0, c.control - r.controlDrop);
    if (r.loot > 0) {
      c.factories -= r.loot;
      this.addFactories(r.loot);
    }
    P.stats.divLost += r.playerLost;
    P.stats.enemyKilled += r.enemyLost;
    const t0 = S.tension;
    this.addTension(0.5);
    if (r.ratio >= 1) { P.stats.won++; r.ppGain = 2; this.addPP(2); } else { P.stats.lost++; r.ppGain = 0; }

    r.enemyAfter = Y ? this.powerDefenders(Y) : c.divs;
    r.controlAfter = c.control;
    r.capitulated = false;
    if (c.control <= 0 || (!Y && c.divs < 0.5)) {
      r.capitulated = true;
      r.liberation = c.core === X;
      r.captured = !!Y;
      r.annexedFactories = Y ? this.transferLand(c, X) : this.capitulate(c, X);
      r.controlAfter = 0;
      if (Y) this.log('alert', 'Территория потеряна', `Противник (${POWERS[X].name}) захватил: ${c.name}.`, id, Y);
    }
    r.tension = S.tension - t0;
    r.divsLeft = P.divs;
    r.orgLeft = P.org;

    const tone = r.capitulated ? 'success' : 'mil';
    this.log(tone, `${r.op}: ${r.outcome.title.toLowerCase()}`,
      `Фронт: ${c.name}. Потери: наши ${r.playerLost} див., противник ${U.fmt(r.enemyLost, 1)} див. Контроль противника: ${Math.round(r.controlAfter)}%.`, id);
    if (Y && !r.capitulated) {
      this.log('mil', r.ratio >= 1 ? 'Оборона прорвана' : 'Атака отбита',
        `${POWERS[X].name} атакует: ${c.name}. Наши потери: ${U.fmt(r.enemyLost, 0)} див., контроль ${Math.round(c.control)}%.`, id, Y);
    }
    Bus.emit('battle', r);
    if (Y) Bus.emit('enemyAttack', { by: X, srcId: MapView_srcFor(id, X), targetId: id, ratio: r.ratio, power: Y, controlDrop: r.controlDrop, control: c.control });
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    this.checkEnd();
    return { ok: true };
  },

  /* Капитуляция ИИ-страны: она и все подконтрольные ей земли переходят державе X.
     Возвращает число заводов, перешедших к X. */
  capitulate(c, X, opts = {}) {
    const wasIndependent = c.ctrl === c.id;
    if (wasIndependent) {
      this.eachCountry(t => { if (t !== c && t.ctrl === c.id) this.transferLand(t, X); });
    }
    const leaderOf = Object.entries(FACTIONS).find(([, f]) => f.leader === c.id);
    const keep = this.transferLand(c, X, opts);
    if (!opts.peaceful) this.addTension(c.major ? 8 : 3);
    this.P(X).stats.annexed++;
    if (wasIndependent) {
      this.log('success', 'Капитуляция', `${c.name} капитулирует. Территория присоединена, заводов получено: ${keep}.`, c.id, X);
    } else {
      this.log('success', 'Освобождение', `Наши войска заняли территорию: ${c.name}.`, c.id, X);
    }
    if (leaderOf && wasIndependent) {
      const facKey = leaderOf[0];
      this.eachCountry(t => { if (t.faction === facKey && t.ctrl === t.id) t.divs *= 0.8; });
      this.log('alert', 'Блок обезглавлен', `Лидер блока «${FACTIONS[facKey].name}» повержен. Армии его союзников деморализованы: −20% дивизий.`, null, null);
    }
    return keep;
  },

  // Передача земли державе X. Свои исконные земли возвращаются без потерь.
  transferLand(c, X, opts = {}) {
    const liberation = c.core === X;
    const keep = c.radioactive ? 0 : Math.floor(c.factories * (opts.peaceful || liberation ? 1 : 0.6));
    c.factories = keep;
    c.ctrl = X;
    c.faction = POWERS[X].faction;
    c.wars = {}; c.warDays = 0; c.cb = {}; c.influence = null; c.integrate = null;
    c.divs = 0; c.control = 100; c.sab = 0; c.sabDays = 0;
    c.intel[X] = 100;
    c.lostFrom = null;
    Bus.emit('mapDirty');
    return keep;
  },

  /* --- Наступление ИИ на землю державы --- */
  enemyOffensive(src, target) {
    const S = this.S, Y = target.ctrl, P = this.P(Y);
    const r = Combat.resolveEnemyOffensive(src, target);
    P.divs = Math.max(0, P.divs - r.playerLost);
    src.divs = Math.max(0, src.divs - r.enemyLost);
    // Высадкой через пролив можно измотать оборону, но не захватить территорию целиком
    const floor = r.sea ? 25 : 0;
    const before = target.control;
    target.control = Math.max(Math.min(target.control, floor), target.control - r.controlDrop);
    r.controlDrop = Math.round(before - target.control);
    P.stats.divLost += r.playerLost;
    if (r.ratio >= 1) {
      this.log('mil', r.sea ? 'Вражеский десант' : 'Вражеское наступление',
        `${src.name} атакует. Направление: ${target.name}. Контроль −${r.controlDrop}%, наши потери: ${r.playerLost} див.`, target.id, Y);
    } else {
      this.log('mil', 'Атака отбита',
        `Оборона выстояла. Направление: ${target.name}. Противник (${src.name}) потерял ${U.fmt(r.enemyLost, 1)} див.`, target.id, Y);
    }
    Bus.emit('enemyAttack', { by: src.id, srcId: src.id, targetId: target.id, ratio: r.ratio, power: Y, controlDrop: r.controlDrop, control: target.control });
    if (target.control <= 0) this.loseTerritory(target, src);
    Bus.emit('stateChanged');
  },

  loseTerritory(t, src) {
    const Y = t.ctrl;
    const occ = src.ctrl === src.id ? src : (this.c(src.ctrl) || src);
    t.ctrl = occ.id;
    t.faction = occ.faction;
    t.control = 60;
    t.divs = src.divs * 0.3;
    src.divs *= 0.7;
    t.cb = {};
    t.fort = Math.max(0, t.fort - 1);
    t.intel[Y] = 60;
    t.lostFrom = Y;
    this.log('alert', 'Территория потеряна', `Фронт прорван. Под контролем противника (${occ.name}): ${t.name}.`, t.id, Y);
    Bus.emit('mapDirty');
    if (t.id !== POWERS[Y].capital) {
      this.popup({
        id: 'sys_lost_' + t.id, art: 'i-swords', cat: 'alert',
        title: 'Прорыв фронта',
        text: `Танковые колонны противника прорвали оборону. Территория «${t.name}» оккупирована. Заводы региона больше не работают на нас. Освободить землю можно наступлением — она отмечена как фронт.`,
        options: [{ label: 'Ни шагу назад!', tip: 'Организуйте контрнаступление', fx: () => {} }]
      }, {}, Y);
    }
    this.checkEnd();
  },

  /* --- Мир --- */
  peaceTarget(c) {
    if (this.isPower(c.ctrl)) return c;
    return c.ctrl === c.id ? c : this.c(c.ctrl);
  },
  peaceChance(c) {
    const S = this.S, enemy = this.peaceTarget(c);
    if (!enemy || this.isPower(enemy.ctrl)) return 0;
    const occupied = this.list(t => t.ctrl === enemy.id && t !== enemy).length;
    const fatigue = Math.min(0.3, (enemy.warDays || 0) / 365 * 0.15);
    const p = 0.25 + (100 - enemy.control) / 200 + (enemy.divs < this.P().divs * 0.5 ? 0.15 : 0) + fatigue
      - S.tension / 400 - occupied * 0.1;
    return U.clamp(p, 0.05, 0.9);
  },
  canPeace(c) {
    if (this.outReason()) return this.outReason();
    if (!this.atWar(c)) return 'Нет состояния войны';
    if (this.P().pp < CFG.PEACE_PP) return `Нужно ${CFG.PEACE_PP} ПВ`;
    return null;
  },
  peace(id) {
    const c = this.c(id), why = this.canPeace(c);
    if (why) return this.fail(why);
    const X = this.cur;
    this.P().pp -= CFG.PEACE_PP;
    const Y = this.powerOf(c);
    if (Y) {
      // Мир между людьми — только по согласию второй стороны
      this.popup({
        id: 'sys_peace_offer', art: 'i-flag', cat: 'dip', title: 'Предложение о мире',
        text: `${POWERS[X].title} ${POWERS[X].leader} предлагает белый мир: война окончена, границы остаются как есть.`,
        options: [
          { label: 'Принять мир', tip: 'Война окончена · напряжённость −5', fx: () => this.makePowerPeace(X, Y) },
          { label: 'Отвергнуть', tip: 'Война продолжается', fx: () => this.log('dip', 'Мир отвергнут', `Противник (${POWERS[Y].name}) отверг наше предложение.`, null, X) }
        ]
      }, {}, Y);
      this.log('dip', 'Мирное предложение отправлено', `Ждём ответа противника: ${POWERS[Y].name}.`);
      Bus.emit('stateChanged');
      return { ok: true, msg: 'Предложение отправлено противнику' };
    }
    const enemy = this.peaceTarget(c);
    if (U.chance(this.peaceChance(c))) {
      this.makePeace(enemy, X);
      return { ok: true, msg: 'Мир подписан' };
    }
    this.log('dip', 'Мир отвергнут', `Противник отверг мирные предложения. Страна: ${enemy.name}.`, enemy.id);
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Противник отверг мир', warn: true };
  },

  // Мир с ИИ-страной на условиях статус-кво: отнятые у X земли возвращаются
  makePeace(enemy, X = this.cur) {
    if (!enemy || !enemy.wars[X]) return false;
    delete enemy.wars[X];
    enemy.warDays = 0;
    this.eachCountry(t => { if (t !== enemy && t.ctrl === enemy.id && t.lostFrom === X) this.transferLand(t, X); });
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
    this.addTension(-5);
    this.log('dip', 'Белый мир', `Мир между державами подписан: ${POWERS[X].name} и ${POWERS[Y].name}.`, null, null);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },

  /* --- Влияние и интеграция --- */
  influenceCost() { return Math.round(CFG.INFLUENCE.pp * (1 - this.mods.influence)); },
  canInfluence(c) {
    if (this.outReason()) return this.outReason();
    if (c.faction !== 'NEU') return 'Только для неприсоединившихся стран';
    if (c.ctrl !== c.id) return 'Территория под чужим контролем';
    if (this.tags().some(t => c.wars[t])) return 'Идёт война';
    if (c.influence) return 'Влияние уже распространяется';
    if (Object.keys(c.cb).length) return 'Против страны готовится война';
    if (this.P().pp < this.influenceCost()) return `Нужно ${this.influenceCost()} ПВ`;
    return null;
  },
  influence(id) {
    const c = this.c(id), why = this.canInfluence(c);
    if (why) return this.fail(why);
    const pp = this.influenceCost();
    this.P().pp -= pp;
    c.influence = { by: this.cur, daysLeft: CFG.INFLUENCE.days, total: CFG.INFLUENCE.days, pp };
    this.addTension(1.5);
    this.log('dip', 'Распространение влияния', `Советники, кредиты и пропаганда. Страна: ${c.name}. Срок — ${U.days(CFG.INFLUENCE.days)}.`, id);
    Bus.emit('stateChanged');
    return { ok: true };
  },
  integrateDays(c) { return Math.round(CFG.INTEGRATE.days * (c.factories > 8 ? 1.5 : 1)); },
  canIntegrate(c) {
    if (this.outReason()) return this.outReason();
    if (!this.isAlly(c)) return 'Только для союзников по блоку';
    if (c.integrate) return 'Уже выполняется';
    if (this.tags().some(t => c.wars[t])) return 'Страна воюет';
    if (this.P().pp < CFG.INTEGRATE.pp) return `Нужно ${CFG.INTEGRATE.pp} ПВ`;
    return null;
  },
  integrate(id) {
    const c = this.c(id), why = this.canIntegrate(c);
    if (why) return this.fail(why);
    this.P().pp -= CFG.INTEGRATE.pp;
    const days = this.integrateDays(c);
    c.integrate = { by: this.cur, daysLeft: days, total: days };
    this.addTension(3);
    this.log('dip', 'Интеграция союзника', `Готовится вхождение в состав державы. Страна: ${c.name}. Срок — ${U.days(days)}.`, id);
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* --- Разведка и саботаж --- */
  spyCost(op) { return Math.round(op.pp * (1 - this.mods.spyCost)); },
  spyChance(c, op) {
    const pen = ['WEST', 'SOV'].includes(c.faction) ? 0.1 : c.faction === 'AXIS' ? 0.05 : 0;
    return U.clamp(op.base + this.mods.spyChance - pen - this.S.tension / 400, 0.15, 0.95);
  },
  canSpy(c, op) {
    if (this.outReason()) return this.outReason();
    if (c.ctrl === this.cur) return 'Это наша территория';
    if (c.inert) return 'Здесь нет государства';
    if (this.isAlly(c)) return 'Против союзников операции не проводятся';
    if (c.radioactive && op.id !== 'intel') return 'Радиоактивная пустошь';
    if (op.id === 'industry' && c.factories < 1) return 'Нет заводов';
    if (this.P().pp < this.spyCost(op)) return `Нужно ${this.spyCost(op)} ПВ`;
    return null;
  },
  spy(id, opId) {
    const S = this.S, P = this.P(), c = this.c(id), op = SPY_OPS.find(o => o.id === opId);
    if (!c || !op) return this.fail('Неизвестная операция');
    const why = this.canSpy(c, op);
    if (why) return this.fail(why);
    P.pp -= this.spyCost(op);
    const Y = this.powerOf(c);
    if (U.chance(this.spyChance(c, op))) {
      P.stats.spyOk++;
      let txt = '';
      if (op.id === 'intel') {
        c.intel[this.cur] = Math.min(100, this.intel(c) + 45);
        c.noise = U.rand(-1, 1);
        txt = `Получены свежие данные о войсках. Разведданные: ${Math.round(this.intel(c))}%.`;
      } else if (op.id === 'sabotage') {
        this.applySabotage(c, 0.2, 45);
        c.intel[this.cur] = Math.min(100, this.intel(c) + 10);
        txt = `Склады и линии связи выведены из строя. Оборона снижена на ${Math.round(c.sab * 100)}%.`;
      } else {
        const n = Math.min(c.factories, U.randi(1, 3));
        c.factories -= n;
        this.addTension(1.5);
        txt = `Взорвано предприятий: ${n}.`;
        if (Y) this.log('alert', 'Диверсия', `Неизвестные взорвали заводы: ${n}. Регион: ${c.name}.`, id, Y);
      }
      this.log('intel', `Успех: ${op.name.toLowerCase()}`, `${txt} Цель: ${c.name}.`, id);
      Bus.emit('stateChanged');
      return { ok: true, msg: `${op.name}: успех` };
    }
    P.stats.spyFail++;
    const dt = CFG.SPY_BASE_TENSION_FAIL * (1 - this.mods.spyTension);
    this.addTension(dt);
    this.log('alert', 'Агенты раскрыты', `Операция «${op.name}» провалена, агентурная сеть арестована. Цель: ${c.name}. Напряжённость +${U.fmt(dt, 0)}%.`, id);
    if (Y) this.log('intel', 'Шпионы пойманы', `Контрразведка арестовала агентов державы «${this.def().name}». Регион: ${c.name}.`, id, Y);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${op.name}: провал`, warn: true };
  },

  /* --- Стратегическое ядерное оружие --- */
  canNuke(c) {
    if (this.outReason()) return this.outReason();
    if (!this.mods.nukes) return 'Требуется межконтинентальная ракета (4-й уровень ядерной ветки)';
    if (c.ctrl === this.cur) return 'Это наша территория';
    if (c.inert) return 'Здесь нет государства';
    if (this.isAlly(c)) return 'Союзник по блоку';
    if (c.radioactive) return 'Уже радиоактивная пустошь';
    if (this.P().warheads < 1) return 'Нет боеголовок';
    return null;
  },
  nuke(id) {
    const S = this.S, X = this.cur, c = this.c(id);
    const why = this.canNuke(c);
    if (why) return this.fail(why);
    const P = this.P();
    P.warheads--;
    P.stats.nukes++;
    const Y = this.powerOf(c);
    const before = { factories: c.factories, divs: Y ? this.powerDefenders(Y) : c.divs, control: c.control };
    const wasWar = this.atWar(c);
    const faction = c.faction;
    this.applyNuclearDamage(c, true);
    if (Y) {
      const PY = this.P(Y), lost = Math.min(PY.divs, Math.round(this.powerDefenders(Y) * (this.mods.thermo ? 1 : 0.85)));
      PY.divs -= lost;
    }
    const after = { factories: c.factories, divs: Y ? this.powerDefenders(Y) : c.divs, control: c.control };
    const dt = faction === 'NEU' ? 35 : CFG.NUKE_TENSION;
    this.addTension(dt);

    if (this.mods.thermo) {
      Geo.meta[id].neighbors.forEach(n => {
        const t = this.c(n);
        if (t && t.ctrl !== X && !this.isAlly(t) && !this.isPower(t.ctrl)) t.divs *= 0.75;
      });
    }

    // Война уже шла и армия уничтожена — территория занята. Иначе удар начинает войну.
    let capitulated = false, gained = 0;
    if (wasWar && (c.control <= 0 || (!Y && c.divs < 0.5))) {
      capitulated = true;
      gained = Y ? this.transferLand(c, X) : this.capitulate(c, X);
    } else if (!wasWar) {
      if (Y) this.S.pwars[this.pairKey(X, Y)] = { since: S.day };
      else if (c.ctrl === c.id) { c.wars[X] = true; c.warDays = 0; AI.onPlayerDeclares(c, X); }
    }
    const reinforced = capitulated || Y ? 0 : Math.max(0, c.divs - after.divs);

    const usa = this.c('USA');
    const usaAI = usa && usa.ctrl === 'USA' && !usa.radioactive && id !== 'USA';
    let retaliation = false;
    if (usaAI && (faction === 'WEST' || usa.wars[X]) && U.chance(0.6)) {
      retaliation = true;
      S.scheduled.push({ day: S.day + U.randi(3, 6), type: 'retaliation', by: 'USA', victim: X });
      if (!usa.wars[X]) this.aiDeclareWar('USA', X, 'Вашингтон отвечает на ядерный удар');
    }

    this.log('nuke', 'Стратегический удар', `Ракета поразила цель: ${c.name}. Регион превращён в радиоактивную пустошь.`, id, null);
    if (Y) {
      this.popup({
        id: 'sys_nuked', art: 'i-nuke', cat: 'nuke', title: 'Ядерный удар по нашей территории',
        text: `${POWERS[X].name} нанесли ядерный удар. Цель: ${c.name}. Регион превращён в радиоактивную пустошь, войска на этом участке уничтожены.`,
        options: [{ label: 'Мы выстоим', tip: 'Регион потерял все заводы', fx: () => {} }]
      }, {}, Y);
    }
    Bus.emit('nuke', {
      by: X, targetId: id, name: c.name, before, after, reinforced,
      tension: dt, retaliation, capitulated, gained, thermo: this.mods.thermo, wastelands: this.wastelands()
    });
    Bus.emit('stateChanged');
    this.checkEnd();
    return { ok: true };
  },

  applyNuclearDamage(c, byPower) {
    c.radioactive = true;
    c.factories = 0;
    c.pop = Math.round(c.pop * 0.6);
    c.fort = 0;
    if (byPower) {
      if (!this.isPower(c.ctrl)) c.divs = this.mods.thermo ? 0 : c.divs * 0.15;
      if (this.atWar(c)) c.control = Math.max(0, c.control - 70);
    } else {
      c.control = Math.max(0, c.control - 50);
    }
    Bus.emit('mapDirtyDelayed');
  },

  /* --- Исследования --- */
  techCost(t) {
    const nuc = t.branch === 'nuclear';
    return {
      rp: Math.round(t.cost * (nuc ? 1 - this.mods.nucCost : 1)),
      days: Math.max(5, Math.round(t.days * (nuc ? 1 - this.mods.nucDays : 1)))
    };
  },
  techState(t) {
    const P = this.P();
    if (P.techs.includes(t.id)) return 'done';
    if (P.research.some(r => r.id === t.id)) return 'active';
    if (t.req.every(r => P.techs.includes(r))) return 'available';
    return 'locked';
  },
  canResearch(t) {
    if (this.outReason()) return this.outReason();
    const st = this.techState(t);
    if (st === 'done') return 'Уже исследовано';
    if (st === 'active') return 'Исследуется';
    if (st === 'locked') return 'Сначала изучите предыдущий уровень';
    if (this.P().research.length >= 2) return 'Оба научных отдела заняты';
    const cost = this.techCost(t);
    if (this.P().rp < cost.rp) return `Нужно ${cost.rp} ОИ`;
    return null;
  },
  startResearch(id) {
    const t = TECH_BY_ID[id];
    if (!t) return this.fail('Неизвестная технология');
    const why = this.canResearch(t);
    if (why) return this.fail(why);
    const cost = this.techCost(t);
    this.P().rp -= cost.rp;
    this.P().research.push({ id, daysLeft: cost.days, total: cost.days });
    this.log('sci', 'Начато исследование', `«${this.techName(t)}». Срок — ${U.days(cost.days)}.`);
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* --- Национальные фокусы --- */
  focusState(f) {
    const P = this.P();
    if (P.focuses.includes(f.id)) return 'done';
    if (P.focus && P.focus.id === f.id) return 'active';
    if ((f.excl || []).some(x => P.focuses.includes(x) || (P.focus && P.focus.id === x))) return 'excluded';
    const okReq = f.reqAny ? f.reqAny.some(r => P.focuses.includes(r)) : f.req.every(r => P.focuses.includes(r));
    return okReq ? 'available' : 'locked';
  },
  canFocus(f) {
    if (this.outReason()) return this.outReason();
    const st = this.focusState(f);
    if (st === 'done') return 'Уже выполнен';
    if (st === 'active') return 'Выполняется';
    if (st === 'excluded') return 'Исключён выбранным курсом';
    if (st === 'locked') return 'Сначала выполните предыдущие фокусы';
    if (this.P().focus) return 'Уже выполняется другой фокус';
    return null;
  },
  startFocus(id) {
    const f = FOCUS_BY_ID[id];
    if (!f) return this.fail('Неизвестный фокус');
    const why = this.canFocus(f);
    if (why) return this.fail(why);
    this.P().focus = { id, daysLeft: f.days, total: f.days };
    this.log('info', 'Новый национальный фокус', `«${this.focusName(f)}». Срок — ${U.days(f.days)}.`);
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* ---------------- СОХРАНЕНИЕ (одиночная игра) ----------------
     Две ячейки: ручное сохранение и автосохранение (каждые 30 игровых дней). */
  saveKey(auto) { return auto ? CFG.SAVE_KEY + '_auto' : CFG.SAVE_KEY; },
  save(auto) {
    this.S.savedAt = Date.now();
    const ok = U.storage.set(this.saveKey(auto), JSON.stringify(this.S));
    if (!auto) Bus.emit('toast', ok ? 'Игра сохранена' : 'Не удалось сохранить: хранилище браузера недоступно', ok ? 'ok' : 'err');
    return ok;
  },
  hasSave() { return !!(this.saveInfo(false) || this.saveInfo(true)); },
  saveInfo(auto) {
    try {
      const S = JSON.parse(U.storage.get(this.saveKey(auto)));
      return S && S.v === 2 ? { date: S.date, difficulty: S.difficulty, savedAt: S.savedAt || 0, auto: !!auto, me: S.me } : null;
    } catch (e) { return null; }
  },
  latestSave() {
    const a = this.saveInfo(false), b = this.saveInfo(true);
    if (!a) return b;
    if (!b) return a;
    return b.savedAt > a.savedAt ? b : a;
  },
  load(auto) {
    if (auto === undefined) { const l = this.latestSave(); auto = l ? l.auto : false; }
    try {
      const S = JSON.parse(U.storage.get(this.saveKey(auto)));
      if (!S || S.v !== 2 || !S.countries || !S.powers) throw new Error('несовместимое сохранение');
      this.loadState(S);
      return true;
    } catch (e) {
      console.warn('[save] загрузка не удалась:', e);
      return false;
    }
  },
  // Принять готовое состояние (из сохранения или с сервера)
  loadState(S) {
    for (const f of Geo.features) {
      if (!S.countries[f.properties.id]) S.countries[f.properties.id] = this.makeCountry(f);
    }
    for (const id of Object.keys(S.countries)) if (!Geo.meta[id]) delete S.countries[id];
    if (!this.server) S.paused = true;
    this.S = S;
    if (S.me && S.powers[S.me]) { this.me = S.me; this.cur = S.me; }
    this.diff = DIFFICULTY[S.difficulty] || DIFFICULTY.normal;
    this.modsCache = {};
    this.pending = {};
    Bus.emit('loaded');
  }
};

// Откуда враг наносит удар по земле id (для эффекта на карте); работает и без MapView (на сервере)
function MapView_srcFor(id, X) {
  const meta = Geo.meta[id];
  if (!meta) return null;
  const nb = meta.neighbors.find(n => { const c = Game.c(n); return c && c.ctrl === X; });
  return nb || null;
}
