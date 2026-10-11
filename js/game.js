'use strict';
/* ============================================================
   ИГРА: состояние, ежедневный такт, экономика и действия игроков.
   Всё состояние лежит в одном объекте Game.S — сохранение игры
   это просто JSON.stringify(Game.S).

   ДЕРЖАВЫ. Люди играют за «державы»: Россия (SOV), США (WST), Китай (AXS).
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
  // Союзник державы: независимая страна её блока (для России — ОДКБ)
  isAlly(c, tag = this.cur) { return !!c && c.ctrl === c.id && !c.inert && POWERS[tag].family.includes(c.faction); },

  /* ---------------- СОЗДАНИЕ ИГРЫ ---------------- */
  newGame(difficulty = 'normal', tags = ['SOV'], names = {}) {
    const S = {
      v: 3, day: 0, date: CFG.START_DATE, difficulty, nextNewsDay: 3,
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
    for (const tag of tags) this.createPower(tag, names[tag]);
    this.eachCountry(c => { for (const t of tags) c.intel[t] = this.baseIntel(c, t); });

    for (const tag of tags) {
      const d = POWERS[tag];
      this.log('info', 'Новый курс', `${d.title} ${d.leader} определяет курс державы на годы вперёд.`, d.capital, tag);
    }
    this.log('intel', 'Сводка разведки', 'Блоки наблюдают друг за другом. Разведданные по большинству стран неполны.', null, null);
    this.news('Мир в 2018 году', 'Россия, США и Китай соперничают за влияние. В Сирии идёт война, Европа спорит о брексите, а Вашингтон готовит торговую войну с Пекином.', null);
    Bus.emit('newGame');
  },

  makeCountry(f) {
    const p = f.properties, id = p.id;
    const ov = COUNTRY_OVERRIDES[id] || {};
    let faction = 'NEU';
    for (const [fac, list] of Object.entries(FACTION_MEMBERS)) if (list.includes(id)) faction = fac;
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
      radioactive: false, lostFrom: null,
      pol: faction === 'NONE' ? null : Politics.make(id, p.sub)
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
    const P = this.S.powers[tag] = {
      tag, player: playerName || '', out: false,
      pp: CFG.START.pp, mp: d.mp, divs: Math.round(divs), rp: CFG.START.rp,
      armies: [], armySeq: 0,
      templates: START_TEMPLATES.map((t, i) => ({ id: 'T' + (i + 1), name: t.names[tag], bats: Object.assign({}, t.bats) })),
      tplSeq: START_TEMPLATES.length, rmix: {},
      warheads: 0, warheadTimer: 0, factoryTimer: 0,
      training: [], research: [], techs: (d.techs || []).slice(), focus: null, focuses: [],
      spirits: (d.spirits || []).map(x => Object.assign({}, x, { fx: Object.assign({}, x.fx) })),
      stats: { won: 0, lost: 0, annexed: 0, nukes: 0, spyOk: 0, spyFail: 0, divLost: 0, enemyKilled: 0 }
    };
    // Резерв — стрелковые дивизии; стартовые армии стоят на границах (часть дивизий — танковые)
    P.rmix = { T1: P.divs };
    for (const a of d.armies || []) {
      const n = Math.min(a.divs, P.divs);
      if (n < 1) break;
      this.takeReserve(n, tag);
      const tanks = Math.min(a.tanks || 0, n);
      const mix = tanks ? { T1: n - tanks, T2: tanks } : { T1: n };
      this.newArmy(tag, a.name, n, this.S.countries[a.loc] && this.S.countries[a.loc].ctrl === tag ? a.loc : d.capital, mix);
    }
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
    const ide = this.powerIde(tag);
    const key = P.techs.join(',') + '|' + P.focuses.join(',') + '|' + ide + '|' + (P.spirits || []).map(x => x.id).join(',');
    const hit = this.modsCache[tag];
    if (hit && hit.key === key) return hit.m;
    const m = this.emptyMods();
    const apply = fx => {
      for (const [k, v] of Object.entries(fx)) {
        if (FOCUS_ONCE.includes(k)) continue;                 // разовые эффекты
        if (k === 'attack') m.attack = Math.max(m.attack, v);  // лучший танк заменяет предыдущий
        else if (k === 'factoryEvery') m.factoryEvery = Math.min(m.factoryEvery, v);
        else if (k === 'tensionDecay') m.tensionDecay = Math.max(m.tensionDecay, v);
        else if (typeof v === 'boolean') m[k] = m[k] || v;
        else m[k] = (m[k] || 0) + v;
      }
    };
    P.techs.forEach(id => TECH_BY_ID[id] && apply(TECH_BY_ID[id].fx));
    P.focuses.forEach(id => FOCUS_BY_ID[id] && apply(FOCUS_BY_ID[id].fx));
    if (ide && IDEOLOGIES[ide]) apply(IDEOLOGIES[ide].fx);
    (P.spirits || []).forEach(x => apply(x.fx));
    m.orgRegen = CFG.ORG_REGEN * (1 + m.org);
    m.warheadDays = m.thermo ? 45 : CFG.WARHEAD_DAYS;
    this.modsCache[tag] = { key, m };
    return m;
  },
  emptyMods() {
    return {
      attack: 1, attackBonus: 0, loss: 0, org: 0, factoryEvery: Infinity, rp: 0, pp: 0, train: 0,
      spyCost: 0, spyChance: 0, spyTension: 0, intelKeep: false, justify: 0, influence: 0,
      tensionDecay: 1, mpMult: 0, nucCost: 0, nucDays: 0, nukes: false, thermo: false, defense: 0, amph: 0,
      orgRegen: CFG.ORG_REGEN, warheadDays: CFG.WARHEAD_DAYS
    };
  },
  recalcMods() { this.modsCache = {}; },

  /* ---------------- НАЗВАНИЯ ДЛЯ РАЗНЫХ ДЕРЖАВ ---------------- */
  techName(t, tag = this.cur) { return (TECH_NAMES[tag] && TECH_NAMES[tag][t.id]) || t.name; },
  focusName(f) { return f.name; },
  focusTree(tag = this.cur) { return FOCUS_TREES[tag] || []; },
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
    const real = Y && Y !== tag ? this.landDefenders(c, Y) : c.divs;
    const intel = this.intel(c, tag);
    if (intel >= 80 || c.ctrl === tag || this.isAlly(c, tag)) return { mid: real, lo: Math.round(real), hi: Math.round(real), exact: true };
    const err = (1 - intel / 100) * 0.5;
    const mid = Math.max(0, real * (1 + c.noise * err * 0.6));
    return { mid, lo: Math.max(0, Math.floor(mid * (1 - err))), hi: Math.max(1, Math.ceil(mid * (1 + err))), exact: false };
  },

  /* ---------------- ЕЖЕДНЕВНЫЕ ПРИРОСТЫ (для текущей державы) ---------------- */
  dailyPP() { return Math.max(0.3, (CFG.PP_BASE + this.mods.pp + this.allies().length * 0.1) * this.diff.pp); },
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
  addDivs(n) { if (n >= 0) this.addReserve(this.defaultTpl(), Math.round(n)); else this.loseReserve(-n); },
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
  log(cat, title, text, cid, to, extra) {
    const S = this.S;
    if (to === undefined) to = this.cur;
    const e = { id: ++S.logSeq, date: S.date, cat, title, text, cid: cid || null, to: to || null };
    if (extra) Object.assign(e, extra);
    S.log.unshift(e);
    if (S.log.length > 300) S.log.length = 300;
    Bus.emit('log', e);
    return e;
  },

  // Событие с вариантами ответа. tag = null — каждой живой державе своё.
  popup(def, ctx = {}, tag) {
    if (tag === undefined) tag = this.cur;
    if (tag === null) { for (const t of this.alive()) this.popup(def, ctx, t); return; }
    if (!this.isPower(tag)) return;
    const iid = 'e' + (++this.eventSeq);
    const text = typeof def.text === 'function' ? this.as(tag, () => def.text(ctx)) : def.text;
    const options = (def.opts && def.opts[tag]) || def.options;
    if (!options || !options.length) return;
    const view = { id: def.id, title: def.title, text, art: def.art, cat: def.cat, options: options.map(o => ({ label: o.label, tip: o.tip || '' })) };
    this.pending[iid] = { def, options, ctx, power: tag, day: this.S.day, t: Date.now(), view };
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
    const opts = p.options || p.def.options;
    const opt = opts[idx] || opts[0];
    try { opt.fx && opt.fx(p.ctx); } catch (err) { console.error('[event]', p.def.id, err); }
    if (opts.length > 1) this.log('info', p.def.title, `Решение: «${opt.label}».${opt.tip ? ' ' + opt.tip + '.' : ''}`);
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
    this.tickBattles();

    this.tickProjects();
    let anyWar = false;
    for (const tag of this.alive()) if (this.fronts(tag).length) anyWar = true;
    const decay = Math.max(...this.tags().map(t => this.modsFor(t).tensionDecay), 1);
    S.tension = U.clamp(S.tension - CFG.TENSION_DECAY * decay * (anyWar ? 0.5 : 1), 0, 100);

    this.as(null, () => AI.daily());
    this.as(null, () => this.tickPolitics());
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
    this.tickArmies();
    this.tickSpirits();
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
    for (const t of done) this.addReserve(t.tpl, t.count);
    this.log('mil', 'Дивизии сформированы', `В резерв вступает: ${U.divs(n)}. В резерве: ${P.divs}.`, this.def().capital);
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
          text: 'Новый комплекс готов к испытательному пуску. Объявить о нём на весь мир или провести испытание без огласки?',
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
          text: 'Межконтинентальный комплекс заступил на боевое дежурство. Любая точка планеты — в 30 минутах от возмездия. Решение о пуске теперь в руках верховного главнокомандующего.',
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
    this.applyFocusOnce(f);
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
        const p = this.isPower(by) ? this.influenceChance(c, by) : 0;
        if (c.pol) c.pol.helped[by] = S.day;
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
    const mine = e => (!e.powers || e.powers.includes(tag)) && !!((e.opts && e.opts[tag]) || e.options);
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
  // Цена и время обучения зависят от шаблона дивизии
  deployCost(n, tplId) {
    const t = this.tpl(tplId) || this.tpl(this.defaultTpl());
    const st = t ? this.tplStats(t) : { pp: CFG.DIV.pp, mp: CFG.DIV.mp };
    return { pp: Math.round(st.pp * n), mp: Math.round(st.mp * n) };
  },
  trainDays(tplId) {
    const t = this.tpl(tplId) || this.tpl(this.defaultTpl());
    const days = t ? this.tplStats(t).days : CFG.DIV.days;
    return Math.max(3, Math.round(days * (1 - this.mods.train)));
  },
  canDeploy(n, tplId) {
    const P = this.P(), c = this.deployCost(n, tplId);
    if (this.outReason()) return this.outReason();
    if (P.pp < c.pp) return `Нужно ${c.pp} ПВ`;
    if (P.mp < c.mp) return `Нужно ${U.fmtMP(c.mp)} призывников`;
    return null;
  },
  deploy(n, tplId) {
    n = Math.max(1, Math.min(5, Math.round(n)));
    if (!this.tpl(tplId)) tplId = this.defaultTpl();
    const why = this.canDeploy(n, tplId);
    if (why) return this.fail(why);
    const P = this.P(), cost = this.deployCost(n, tplId), days = this.trainDays(tplId);
    P.pp -= cost.pp;
    P.mp -= cost.mp;
    P.training.push({ count: n, tpl: tplId, daysLeft: days, total: days });
    this.addTension(0.05 * n);
    this.log('mil', 'Мобилизация', `Начато формирование: ${U.divs(n)} («${this.tpl(tplId).name}»). Срок обучения — ${U.days(days)}.`, this.def().capital);
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
    return CFG.DECLARE_TENSION * (c.major || this.isPower(c.ctrl) ? 1.5 : 1);
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
        text: `${this.leaderTitle(X)} ${this.leaderOf(X)} объявляет нам войну. ${POWERS[X].name} — теперь наш противник. Готовьте оборону и контрудар.`,
        options: [{ label: 'К оружию!', tip: 'Земли противника отмечены как фронт', fx: () => {} }]
      }, {}, Y);
    } else {
      c.wars[X] = true;
      c.warDays = 0;
      c.divs = c.divs * 1.15 + 1;
      this.log('mil', 'Война объявлена', `Мы начинаем войну. Противник: ${c.name}. Территория стала активным фронтом.`, id);
      AI.onPlayerDeclares(c, X);
    }
    this.news(`Война: ${POWERS[X].name} — ${Y ? POWERS[Y].name : c.name}`, `${this.leaderTitle(X)} ${this.leaderOf(X)} объявляет войну. Мировые рынки падают.`, id, 'war');
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

  /* ============================================================
     ШАБЛОНЫ ДИВИЗИЙ (как в HOI4)
     У державы есть шаблоны: { id, name, bats: { inf: 7, art: 2 } }.
     Состав армии и резерва — «смесь» шаблонов: { T1: 6, T2: 4 } (сколько дивизий какого шаблона).
     a.divs и P.divs — просто общее число дивизий, всегда равное сумме смеси.
     ============================================================ */
  templates(tag = this.cur) { const P = this.P(tag); return P ? P.templates : []; },
  tpl(id, tag = this.cur) { return this.templates(tag).find(t => t.id === id) || null; },
  defaultTpl(tag = this.cur) { const T = this.templates(tag); return T.length ? T[0].id : null; },

  // Характеристики одной дивизии по шаблону (с учётом танковых технологий державы)
  tplStats(t, tag = this.cur) {
    const m = this.modsFor(tag);
    const s = { att: 0, def: 0, org: 0, speed: 9, pp: 1, mp: 0, days: 6, bats: 0, armor: 0, at: 0 };
    for (const [type, n] of Object.entries(t.bats || {})) {
      const b = BATTALIONS[type];
      if (!b || !n) continue;
      // Танковые технологии в полную силу усиливают танки и на треть — остальных
      const techK = b.armor ? m.attack : 1 + (m.attack - 1) * 0.3;
      s.att += b.att * n * techK;
      s.def += b.def * n;
      s.org += b.org * n;
      s.speed = Math.min(s.speed, b.speed);
      s.pp += b.pp * n;
      s.mp += b.mp * n;
      s.days += b.days * n;
      s.bats += n;
      if (b.armor) s.armor += n;
      if (b.antiArmor) s.at += n;
    }
    if (!s.bats) s.speed = 1;
    s.org = s.bats ? s.org / s.bats : 50;
    s.armor = s.bats ? s.armor / s.bats : 0;
    s.at = s.bats ? s.at / s.bats : 0;
    s.pp = Math.round(s.pp * 10) / 10;
    s.mp = Math.round(s.mp * 10) / 10;
    return s;
  },

  // Суммарные характеристики смеси дивизий
  mixStats(mix, tag = this.cur) {
    const r = { divs: 0, att: 0, def: 0, org: 0, speed: 9, armor: 0, at: 0 };
    for (const [id, n] of Object.entries(mix || {})) {
      if (n <= 0) continue;
      const t = this.tpl(id, tag);
      const s = t ? this.tplStats(t, tag) : { att: 10, def: 10, org: 50, speed: 1, armor: 0, at: 0 };
      r.divs += n;
      r.att += s.att * n;
      r.def += s.def * n;
      r.org += s.org * n;
      r.armor += s.armor * n;
      r.at += s.at * n;
      r.speed = Math.min(r.speed, s.speed);
    }
    if (r.divs > 0) { r.org /= r.divs; r.armor /= r.divs; r.at /= r.divs; } else { r.org = 50; r.speed = 1; }
    return r;
  },

  // Привести смесь к новому общему числу дивизий (потери делятся пропорционально)
  scaleMix(holder, total) {
    const cur = Object.values(holder.mix).reduce((s, n) => s + n, 0);
    if (cur <= 0) { holder.mix = {}; holder.divs = 0; return; }
    const k = Math.max(0, total) / cur;
    for (const id of Object.keys(holder.mix)) {
      holder.mix[id] *= k;
      if (holder.mix[id] < 0.01) delete holder.mix[id];
    }
    holder.divs = Math.max(0, total);
  },
  addMix(mix, add) { for (const [id, n] of Object.entries(add)) mix[id] = (mix[id] || 0) + n; },

  // Резерв: целые дивизии по шаблонам (P.rmix), P.divs — их сумма
  addReserve(tplId, n, tag = this.cur) {
    const P = this.P(tag);
    if (!tplId || !this.tpl(tplId, tag)) tplId = this.defaultTpl(tag);
    P.rmix[tplId] = (P.rmix[tplId] || 0) + n;
    P.divs = Object.values(P.rmix).reduce((s, x) => s + x, 0);
  },
  // Взять n дивизий из резерва (сначала тех шаблонов, которых больше). Возвращает смесь.
  takeReserve(n, tag = this.cur) {
    const P = this.P(tag), out = {};
    n = Math.min(Math.round(n), P.divs);
    while (n > 0) {
      const id = Object.keys(P.rmix).filter(k => P.rmix[k] > 0).sort((a, b) => P.rmix[b] - P.rmix[a])[0];
      if (!id) break;
      const take = Math.max(1, Math.min(P.rmix[id], Math.ceil(n * P.rmix[id] / P.divs)));
      P.rmix[id] -= take;
      if (P.rmix[id] <= 0) delete P.rmix[id];
      out[id] = (out[id] || 0) + take;
      n -= take;
      P.divs = Object.values(P.rmix).reduce((s, x) => s + x, 0);
    }
    return out;
  },
  // Потери в резерве (только в столице при обороне)
  loseReserve(n, tag = this.cur) {
    const P = this.P(tag);
    const holder = { mix: Object.assign({}, P.rmix), divs: P.divs };
    this.scaleMix(holder, P.divs - n);
    P.rmix = {};
    for (const [id, x] of Object.entries(holder.mix)) { const r = Math.round(x); if (r > 0) P.rmix[id] = r; }
    P.divs = Object.values(P.rmix).reduce((s, x) => s + x, 0);
  },
  mixText(mix, tag = this.cur) {
    return Object.entries(mix || {}).filter(([, n]) => n >= 0.5)
      .map(([id, n]) => { const t = this.tpl(id, tag); return (t ? t.name : '?') + ' ×' + Math.round(n); }).join(', ');
  },

  parseBats(str) {
    const bats = {};
    for (const part of String(str || '').split(',')) {
      const [type, n] = part.split(':');
      const k = Math.round(+n);
      if (BATTALIONS[type] && k > 0) bats[type] = Math.min(k, TEMPLATE_MAX_BATS);
    }
    return bats;
  },
  tplUsed(id, tag = this.cur) {
    const P = this.P(tag);
    return (P.rmix[id] || 0) > 0 || P.armies.some(a => (a.mix[id] || 0) > 0.01) || P.training.some(t => t.tpl === id);
  },

  /* --- Действия с шаблонами --- */
  // batsStr — строка «inf:7,art:2» (так её проще передать по сети)
  saveTemplate(id, name, batsStr) {
    const P = this.P();
    if (this.outReason()) return this.fail(this.outReason());
    const bats = this.parseBats(batsStr);
    const total = Object.values(bats).reduce((s, n) => s + n, 0);
    if (!total) return this.fail('Добавьте хотя бы один батальон');
    if (total > TEMPLATE_MAX_BATS) return this.fail(`Не больше ${TEMPLATE_MAX_BATS} батальонов в дивизии`);
    name = String(name || '').trim().slice(0, 32) || 'Новая дивизия';
    const t = id && this.tpl(id);
    if (t) {
      // Переоснащение уже существующих дивизий стоит политвласти и сбивает организацию
      const used = this.tplUsed(t.id);
      if (used && P.pp < 10) return this.fail('Переоснащение стоит 10 ПВ');
      if (used) {
        P.pp -= 10;
        P.armies.forEach(a => { if ((a.mix[t.id] || 0) > 0.01) a.org = Math.min(a.org, 50); });
      }
      t.name = name;
      t.bats = bats;
      this.log('mil', 'Шаблон изменён', `«${name}»${used ? ': дивизии переоснащаются, организация армий снижена' : ''}.`);
      Bus.emit('stateChanged');
      return { ok: true, msg: `Шаблон «${name}» сохранён`, tpl: t.id };
    }
    if (P.templates.length >= TEMPLATE_MAX) return this.fail(`Не больше ${TEMPLATE_MAX} шаблонов`);
    P.tplSeq = (P.tplSeq || P.templates.length) + 1;
    const nt = { id: 'T' + P.tplSeq, name, bats };
    P.templates.push(nt);
    this.log('mil', 'Новый шаблон дивизии', `«${name}».`);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Шаблон «${name}» создан`, tpl: nt.id };
  },
  deleteTemplate(id) {
    const P = this.P(), t = this.tpl(id);
    if (!t) return this.fail('Шаблон не найден');
    if (P.templates.length <= 1) return this.fail('Нужен хотя бы один шаблон');
    if (this.tplUsed(id)) return this.fail('Шаблон используется: есть дивизии этого типа');
    P.templates = P.templates.filter(x => x !== t);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Шаблон «${t.name}» удалён` };
  },

  /* ============================================================
     АРМИИ И ФРОНТ (как в HOI4)
     Дивизии державы живут в армиях. У армии есть место (территория) и приказ:
       hold   — оборонять своё место (организация восстанавливается);
       move   — идти по своим землям к цели (переход занимает дни);
       attack — наступать на соседнюю вражескую землю: бой идёт каждый день,
                контроль врага падает, пока не кончится организация.
     Земли без армии прикрывает только ополчение. Резерв стоит в столице.
     ============================================================ */
  armies(tag = this.cur) { const P = this.P(tag); return P ? P.armies : []; },
  army(id, tag = this.cur) { return this.armies(tag).find(a => a.id === id) || null; },
  armiesAt(locId, tag = this.cur) { return this.armies(tag).filter(a => a.loc === locId); },
  totalDivs(tag = this.cur) { const P = this.P(tag); return P ? P.divs + P.armies.reduce((s, a) => s + a.divs, 0) : 0; },
  avgOrg(tag = this.cur) {
    const A = this.armies(tag), d = A.reduce((s, a) => s + a.divs, 0);
    return d ? A.reduce((s, a) => s + a.org * a.divs, 0) / d : 100;
  },
  setArmyOrg(v) { this.armies().forEach(a => { a.org = v; }); },
  // Сколько дивизий державы Y защищает землю c: армии на ней (+ резерв, если это столица)
  landDefenders(c, Y = c.ctrl) {
    if (!this.isPower(Y)) return c.divs;
    let s = this.armiesAt(c.id, Y).reduce((t, a) => t + a.divs, 0);
    if (c.id === POWERS[Y].capital) s += this.P(Y).divs;
    return s;
  },
  // Оборона земли державы Y в «очках»: сумма обороны дивизий (по шаблонам) и доля ПТ-батальонов
  landDefense(c, Y = c.ctrl) {
    const mix = {};
    for (const a of this.armiesAt(c.id, Y)) this.addMix(mix, a.mix);
    if (c.id === POWERS[Y].capital) this.addMix(mix, this.P(Y).rmix);
    const st = this.mixStats(mix, Y);
    return { divs: st.divs, def: st.def, at: st.at };
  },
  landOrg(c, Y = c.ctrl) {
    const A = this.armiesAt(c.id, Y), d = A.reduce((s, a) => s + a.divs, 0);
    return d ? A.reduce((s, a) => s + a.org * a.divs, 0) / d : 100;
  },
  // Потери обороняющихся: делим между армиями на земле и резервом (если столица)
  takeLosses(c, Y, n) {
    if (n <= 0) return 0;
    const A = this.armiesAt(c.id, Y);
    const cap = c.id === POWERS[Y].capital ? this.P(Y).divs : 0;
    const total = A.reduce((s, a) => s + a.divs, 0) + cap;
    if (total <= 0) return 0;
    n = Math.min(n, total);
    for (const a of A) this.scaleMix(a, a.divs - n * a.divs / total);
    if (cap) this.loseReserve(n * cap / total, Y);
    this.P(Y).stats.divLost += n;
    this.cleanArmies(Y);
    return n;
  },
  cleanArmies(tag) {
    const P = this.P(tag);
    const dead = P.armies.filter(a => a.divs < 0.5);
    if (!dead.length) return;
    P.armies = P.armies.filter(a => a.divs >= 0.5);
    dead.forEach(a => this.log('alert', 'Армия уничтожена', `${a.name} (командующий ${a.general}) перестала существовать.`, a.loc, tag));
  },
  armyName(tag, n) { return { SOV: `${n}-я армия`, WST: `${n}-я армия США`, AXS: `${n}-я группа армий НОАК` }[tag] || `${n}-я армия`; },
  newArmy(tag, name, divs, loc, mix) {
    const P = this.P(tag), d = POWERS[tag];
    P.armySeq++;
    const a = {
      id: tag + P.armySeq, name: name || this.armyName(tag, P.armySeq),
      general: d.generals[(P.armySeq - 1) % d.generals.length],
      divs, mix: mix || { [this.defaultTpl(tag)]: divs }, loc: loc || d.capital, org: 100, order: { type: 'hold' }, battle: null
    };
    P.armies.push(a);
    return a;
  },
  // Сколько дней идти между соседними землями (через пролив — дольше)
  stepDays(a, b, army) {
    const base = Geo.isSea(a, b) ? CFG.ARMY.seaStepDays : CFG.ARMY.stepDays;
    const speed = army ? this.mixStats(army.mix).speed : 1;
    return Math.max(1, Math.round(base / speed));
  },
  // Путь по своим землям (поиск в ширину по соседству)
  armyPath(from, to, tag = this.cur) {
    if (from === to) return [];
    const prev = { [from]: null }, queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of (Geo.meta[cur] || { neighbors: [] }).neighbors) {
        if (n in prev) continue;
        const c = this.c(n);
        if (!c || c.ctrl !== tag) continue;
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
  // Снабжение армии при наступлении: сухопутная граница 100%, через пролив 80% (морская пехота помогает)
  armySupply(fromId, toId) {
    return Geo.isSea(fromId, toId) ? Math.min(1, 0.8 + this.mods.amph) : 1;
  },

  /* --- Действия с армиями --- */
  canCreateArmy(n) {
    if (this.outReason()) return this.outReason();
    if (this.P().divs < 1) return 'Резерв пуст — сформируйте дивизии';
    if (n > this.P().divs) return `В резерве только ${this.P().divs} див.`;
    return null;
  },
  createArmy(n) {
    n = U.clamp(Math.round(n), 1, CFG.ARMY.max);
    const why = this.canCreateArmy(n);
    if (why) return this.fail(why);
    const mix = this.takeReserve(n);
    const a = this.newArmy(this.cur, null, n, null, mix);
    this.log('mil', 'Новая армия', `${a.name} (${U.divs(n)}, командующий ${a.general}) развёрнута в столице.`, a.loc);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Сформирована ${a.name}`, army: a.id };
  },
  reinforceArmy(id, n) {
    const a = this.army(id), P = this.P();
    if (!a) return this.fail('Армия не найдена');
    if (this.outReason()) return this.fail(this.outReason());
    const take = Math.min(Math.round(n), P.divs, Math.floor(CFG.ARMY.max - a.divs));
    if (take < 1) return this.fail(P.divs < 1 ? 'Резерв пуст' : `В армии не больше ${CFG.ARMY.max} дивизий`);
    this.addMix(a.mix, this.takeReserve(take));
    a.divs += take;
    a.org = Math.min(a.org, 70);   // пополнение нужно влить в части
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name}: +${take} див.` };
  },
  disbandArmy(id) {
    const a = this.army(id), P = this.P();
    if (!a) return this.fail('Армия не найдена');
    if (a.order.type === 'attack') return this.fail('Сначала остановите наступление');
    for (const [id, n] of Object.entries(a.mix)) { const r = Math.round(n); if (r > 0) this.addReserve(id, r); }
    P.armies = P.armies.filter(x => x !== a);
    this.log('mil', 'Армия расформирована', `${a.name}: дивизии возвращены в резерв.`, a.loc);
    Bus.emit('stateChanged');
    return { ok: true };
  },
  orderHold(id) {
    const a = this.army(id);
    if (!a) return this.fail('Армия не найдена');
    if (a.battle) this.finishBattle(a, 'stopped');
    a.order = { type: 'hold' };
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name}: оборона` };
  },
  canMove(a, c) {
    if (!a) return 'Армия не найдена';
    if (this.outReason()) return this.outReason();
    if (!c || c.ctrl !== this.cur) return 'Двигаться можно только по своей территории';
    if (c.id === a.loc) return 'Армия уже здесь';
    if (!this.armyPath(a.loc, c.id)) return 'Нет пути по нашей территории';
    return null;
  },
  orderMove(id, targetId) {
    const a = this.army(id), c = this.c(targetId), why = this.canMove(a, c);
    if (why) return this.fail(why);
    if (a.battle) this.finishBattle(a, 'stopped');
    const path = this.armyPath(a.loc, c.id);
    a.order = { type: 'move', path, left: this.stepDays(a.loc, path[0], a), to: c.id };
    const days = path.reduce((s, p, i) => s + this.stepDays(i ? path[i - 1] : a.loc, p, a), 0);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name} выступает: ${c.name}, ~${U.days(days)}` };
  },
  canOrderAttack(a, c) {
    if (!a) return 'Армия не найдена';
    if (this.outReason()) return this.outReason();
    if (!c || c.ctrl === this.cur) return 'Это наша территория';
    if (!this.atWar(c)) return 'Нет состояния войны';
    if (a.order.type === 'move') return 'Армия на марше';
    if (!(Geo.meta[a.loc] || { neighbors: [] }).neighbors.includes(c.id)) return 'Армия должна стоять на соседней территории';
    if (a.org < CFG.ARMY.haltOrg + 10) return `Армия измотана (организация ${Math.round(a.org)}%) — дайте ей отдохнуть`;
    return null;
  },
  orderAttack(id, targetId) {
    const a = this.army(id), c = this.c(targetId), why = this.canOrderAttack(a, c);
    if (why) return this.fail(why);
    if (a.battle && a.battle.target !== c.id) this.finishBattle(a, 'stopped');
    a.order = { type: 'attack', target: c.id };
    if (!a.battle) a.battle = { target: c.id, start: this.S.day, days: 0, attLost: 0, defLost: 0, ctrlStart: c.control, ratioSum: 0, last: null, orgStart: a.org };
    const Y = this.powerOf(c);
    if (Y) this.log('alert', 'Вражеское наступление', `${POWERS[this.cur].name}: ${a.name} переходит в наступление. Направление: ${c.name}.`, c.id, Y);
    this.log('mil', 'Наступление начато', `${a.name} атакует. Направление: ${c.name}.`, c.id);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name}: наступление — ${c.name}` };
  },

  /* --- Ежедневная жизнь армий державы (марш, отдых) --- */
  tickArmies() {
    const P = this.P(), m = this.mods;
    for (const a of P.armies) {
      const o = a.order;
      if (o.type === 'move') {
        a.org = Math.min(100, a.org + m.orgRegen * 0.5);
        if (--o.left > 0) continue;
        const next = o.path.shift();
        const c = this.c(next);
        if (!c || c.ctrl !== this.cur) {
          a.order = { type: 'hold' };
          this.log('mil', 'Марш прерван', `${a.name} остановилась: путь отрезан.`, a.loc);
          continue;
        }
        a.loc = next;
        if (o.path.length) o.left = this.stepDays(a.loc, o.path[0], a);
        else {
          a.order = { type: 'hold' };
          this.log('mil', 'Армия на позициях', `${a.name} заняла оборону: ${c.name}.`, c.id);
        }
      } else if (o.type === 'hold') {
        a.org = Math.min(100, a.org + m.orgRegen);
      }
    }
  },

  /* --- Ежедневные сражения: все армии одной державы, атакующие одну цель, бьются вместе --- */
  tickBattles() {
    for (const X of this.alive()) {
      this.as(X, () => {
        const groups = {};
        for (const a of this.armies()) {
          if (a.order.type !== 'attack') continue;
          const c = this.c(a.order.target);
          const adj = (Geo.meta[a.loc] || { neighbors: [] }).neighbors.includes(a.order.target);
          if (!c || c.ctrl === X || !this.atWar(c) || !adj) { this.finishBattle(a, 'invalid'); continue; }
          (groups[c.id] = groups[c.id] || []).push(a);
        }
        for (const [id, list] of Object.entries(groups)) this.battleDay(this.c(id), list);
      });
    }
  },

  battleDay(c, list) {
    const X = this.cur, P = this.P(), Y = this.powerOf(c);
    const r = Combat.battleDay(c, list);
    const total = list.reduce((s, a) => s + a.divs, 0);
    for (const a of list) {
      const share = a.divs / total;
      const lost = r.attLoss * share;
      this.scaleMix(a, a.divs - lost);
      a.org = Math.max(0, a.org - r.orgLoss);
      const b = a.battle;
      b.days++; b.attLost += lost; b.defLost += r.defLoss * share; b.ratioSum += r.ratio; b.last = r;
    }
    P.stats.divLost += r.attLoss;
    P.stats.enemyKilled += r.defLoss;
    if (Y) this.takeLosses(c, Y, r.defLoss);
    else c.divs = Math.max(0, c.divs - r.defLoss);
    c.control = Math.max(0, c.control - r.ctrlDrop);
    if (Y && r.ratio >= 1 && c.control < 50 && !c.alerted) {
      c.alerted = true;
      this.log('alert', 'Фронт трещит', `Противник (${POWERS[X].name}) прорывает оборону: ${c.name}, контроль ${Math.round(c.control)}%.`, c.id, Y);
    }

    // Захват территории: армии входят в неё, фронт сдвигается
    if (c.control <= 0 || (!Y && c.divs < 0.5)) {
      const gained = Y ? this.transferLand(c, X) : this.capitulate(c, X);
      if (Y) this.log('alert', 'Территория потеряна', `Противник (${POWERS[X].name}) захватил: ${c.name}.`, c.id, Y);
      list.forEach((a, i) => { a.loc = c.id; this.finishBattle(a, 'captured', gained, i > 0); });
      this.addTension(c.major ? 2 : 1);
      Bus.emit('mapDirty');
    } else {
      list.forEach(a => { if (a.org < CFG.ARMY.haltOrg || a.divs < 0.5) this.finishBattle(a, 'halted'); });
    }
    this.cleanArmies(X);
  },

  // Итог наступления: сводка (как раньше после боя) и запись в журнал
  finishBattle(a, result, gained = 0, quiet = false) {
    const b = a.battle;
    a.battle = null;
    a.order = { type: 'hold' };
    if (!b || !b.days) return;
    const c = this.c(b.target);
    const P = this.P(), X = this.cur;
    const avg = b.ratioSum / b.days;
    const last = b.last;
    if (result === 'captured') P.stats.won++; else if (result === 'halted') P.stats.lost++;
    const title = { captured: 'Территория взята', halted: 'Наступление выдохлось', stopped: 'Наступление остановлено', invalid: 'Наступление прекращено' }[result];
    this.log(result === 'captured' ? 'success' : 'mil', `${a.name}: ${title.toLowerCase()}`,
      `Направление: ${c.name}. ${U.days(b.days)} боёв, наши потери ${U.fmt(b.attLost, 1)} див., противник ${U.fmt(b.defLost, 1)} див.`, c.id);
    if (quiet || (result !== 'captured' && result !== 'halted')) return;
    const Y = last.defender;
    Bus.emit('battle', {
      kind: 'offensive', by: X, defender: Y, result,
      op: a.name, general: a.general, days: b.days,
      date: this.S.date, targetId: c.id, targetName: c.name, targetFaction: c.faction,
      targetColor: Y ? POWERS[Y].color : null,
      att: Object.assign({}, last.att, { divs: Math.round(a.divs + b.attLost) }),
      def: last.def,
      ratio: avg, outcome: Combat.outcomeFor(result === 'captured' ? Math.max(avg, 1) : Math.min(avg, 0.99)),
      playerLost: Math.round(b.attLost * 10) / 10, playerMPLost: Math.round(b.attLost * CFG.DIV.mp),
      enemyLost: Math.round(b.defLost * 10) / 10, enemyAfter: Y ? this.landDefenders(c, Y) : c.divs,
      controlBefore: b.ctrlStart, controlAfter: result === 'captured' ? 0 : c.control,
      capitulated: result === 'captured', captured: result === 'captured' && !!Y, liberation: c.core === X,
      annexedFactories: gained, loot: 0, resilience: last.resilience,
      orgCost: Math.round(b.orgStart - a.org), orgLeft: a.org, tension: 0, ppGain: 0
    });
  },

  // Армии державы Y на потерянной земле отступают на соседнюю свою землю (или гибнут в окружении)
  retreatArmies(c, Y) {
    const A = this.armiesAt(c.id, Y);
    if (!A.length) return;
    const back = (Geo.meta[c.id] || { neighbors: [] }).neighbors.map(n => this.c(n)).find(t => t && t.ctrl === Y);
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
        this.log('alert', 'Котёл', `${a.name} попала в окружение и уничтожена: ${c.name}.`, c.id, Y);
      }
    }
    this.cleanArmies(Y);
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
      this.news(`${c.name} капитулирует`, `Страна переходит под контроль державы «${POWERS[X].name}».`, c.id, 'war');
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
    const prev = c.ctrl;
    const liberation = c.core === X;
    const keep = c.radioactive ? 0 : Math.floor(c.factories * (opts.peaceful || liberation ? 1 : 0.6));
    c.factories = keep;
    c.ctrl = X;
    c.faction = POWERS[X].faction;
    c.wars = {}; c.warDays = 0; c.cb = {}; c.influence = null; c.integrate = null;
    c.divs = 0; c.control = 100; c.sab = 0; c.sabDays = 0;
    c.intel[X] = 100;
    c.lostFrom = null;
    c.alerted = false;
    if (this.isPower(prev) && prev !== X) this.retreatArmies(c, prev);
    Bus.emit('mapDirty');
    return keep;
  },

  /* --- Наступление ИИ на землю державы --- */
  enemyOffensive(src, target) {
    const S = this.S, Y = target.ctrl, P = this.P(Y);
    const r = Combat.resolveEnemyOffensive(src, target);
    r.playerLost = Math.round(this.takeLosses(target, Y, r.playerLost) * 10) / 10;
    src.divs = Math.max(0, src.divs - r.enemyLost);
    // Высадкой через пролив можно измотать оборону, но не захватить территорию целиком
    const floor = r.sea ? 25 : 0;
    const before = target.control;
    target.control = Math.max(Math.min(target.control, floor), target.control - r.controlDrop);
    r.controlDrop = Math.round(before - target.control);
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
    this.retreatArmies(t, Y);
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
        text: `${this.leaderTitle(X)} ${this.leaderOf(X)} предлагает белый мир: война окончена, границы остаются как есть.`,
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
    this.news('Мир между державами', `${POWERS[X].name} и ${POWERS[Y].name} подписывают мир на условиях статус-кво.`, null, 'war');
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
    const before = { factories: c.factories, divs: Y ? this.landDefenders(c, Y) : c.divs, control: c.control };
    const wasWar = this.atWar(c);
    const faction = c.faction;
    this.applyNuclearDamage(c, true);
    if (Y) this.takeLosses(c, Y, this.landDefenders(c, Y) * (this.mods.thermo ? 1 : 0.85));
    const after = { factories: c.factories, divs: Y ? this.landDefenders(c, Y) : c.divs, control: c.control };
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
    this.news(`Ядерный удар: ${c.name}`, `Держава «${POWERS[X].name}» применила ядерное оружие. Мир на грани.`, id, 'war');
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
  // Разовые эффекты фокуса: заводы, призывники, поводы для войны, союзники, присоединение, новые армии
  applyFocusOnce(f) {
    const fx = f.fx, X = this.cur;
    if (fx.addFactories) this.addFactories(fx.addFactories);
    if (fx.addMP) this.addMP(fx.addMP);
    if (fx.addDivs) this.addDivs(fx.addDivs);
    if (fx.addPP) this.addPP(fx.addPP);
    if (fx.tension) this.addTension(fx.tension);
    if (fx.gov) {
      const home = this.c(this.def().capital);
      if (home && home.pol) {
        if (fx.gov.leader === home.pol.leader && fx.gov.ide === home.pol.ide) home.pol.title = fx.gov.title || home.pol.title;
        else {
          this.setGov(home, fx.gov.ide, fx.gov.leader, 'focus', fx.gov.title);
          this.news(`${this.def().name}: смена власти`, `К власти приходит ${fx.gov.leader} (${IDEOLOGIES[fx.gov.ide].name.toLowerCase()}).`, home.id, 'elections');
        }
      }
    }
    if (fx.pop) for (const [ide, n] of Object.entries(fx.pop)) this.addPop(ide, n);
    if (fx.claims) {
      const ids = fx.claims === 'neighbors'
        ? [...new Set(this.lands().flatMap(c => Geo.meta[c.id] ? Geo.meta[c.id].neighbors : []))]
        : fx.claims;
      const got = [];
      for (const id of ids) {
        const c = this.c(id);
        if (!c || c.inert || c.ctrl === X || this.isAlly(c) || this.atWar(c) || (c.ctrl !== c.id && !this.isPower(c.ctrl))) continue;
        c.cb[X] = true;
        got.push(c.name);
      }
      if (got.length) this.log('dip', 'Поводы для войны', 'Получены претензии: ' + got.join(', ') + '.');
    }
    if (fx.allies) {
      for (const id of fx.allies) {
        const c = this.c(id);
        if (c && c.ctrl === c.id && c.faction === 'NEU' && !this.tags().some(t => c.wars[t])) this.setFaction(id, POWERS[X].allyFaction);
      }
    }
    if (fx.annex) {
      for (const id of fx.annex) {
        const c = this.c(id);
        if (c && this.isAlly(c)) {
          this.transferLand(c, X, { peaceful: true });
          this.log('success', 'Мирное объединение', c.name + ' входит в состав державы.', id);
        }
      }
    }
    if (fx.army) {
      const tanks = Math.round(fx.army.divs * 0.4);
      const mix = this.tpl('T2') ? { [this.defaultTpl()]: fx.army.divs - tanks, T2: tanks } : null;
      const a = this.newArmy(X, fx.army.name, fx.army.divs, null, mix);
      this.log('mil', 'Новая армия', a.name + ' (' + U.divs(fx.army.divs) + ', командующий ' + a.general + ') развёрнута в столице.', a.loc);
    }
    Bus.emit('mapDirty');
  },
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
    if (!f || !this.focusTree().includes(f)) return this.fail('Этот фокус не из вашего дерева');
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
      return S && S.v === 3 ? { date: S.date, difficulty: S.difficulty, savedAt: S.savedAt || 0, auto: !!auto, me: S.me } : null;
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
      if (!S || S.v !== 3 || !S.countries || !S.powers) throw new Error('несовместимое сохранение');
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
    for (const [tag, P] of Object.entries(S.powers)) {
      if (!P.templates) P.templates = START_TEMPLATES.map((t, i) => ({ id: 'T' + (i + 1), name: t.names[tag], bats: Object.assign({}, t.bats) }));
      if (!P.rmix) P.rmix = { T1: P.divs || 0 };
      if (!P.armies) { P.armies = []; P.armySeq = 0; }
      P.armies.forEach(a => { if (!a.mix) a.mix = { T1: a.divs }; });
      if (!P.spirits) P.spirits = [];
    }
    for (const c of Object.values(S.countries)) {
      if (c.pol === undefined && c.faction !== 'NONE') c.pol = Politics.make(c.id, (Geo.meta[c.id] || {}).sub);
    }
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
