'use strict';
/* ============================================================
   ИНТЕРФЕЙС: верхняя панель, панель страны, журнал, нижний док,
   модальные окна, лобби сетевой игры, подсказки, уведомления.
   UI только показывает состояние Game.S глазами своей державы (Game.me)
   и вызывает действия через Act (локально или через сервер).
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const LOG_BADGES = { info: 'Сводка', mil: 'Фронт', intel: 'Разведка', dip: 'Дипломатия', sci: 'Наука', alert: 'Тревога', success: 'Успех', nuke: 'Ядерное', news: 'Новости' };
const LOG_GROUPS = { mil: ['mil', 'success'], intel: ['intel'], dip: ['dip'], sci: ['sci'], alert: ['alert', 'nuke'], news: ['news'] };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

const UI = {
  selected: null,
  selectedArmy: null,
  deployTpl: null,          // шаблон, по которому набираются новые дивизии
  logFilter: 'all',
  logCollapsed: false,
  unread: 0,
  modals: [],
  eventQueue: [],
  pauseDepth: 0,
  resumeAfter: false,
  fxBusyUntil: 0,
  sig: {},
  mouse: { x: 0, y: 0 },
  tipTarget: null,
  mapHoverId: null,
  researchTab: 'research',
  started: false,
  polSel: null,             // выбранная партия в панели политики: { cid, ide }
  newsTab: 'all',
  newsSeen: 0,              // id последней прочитанной новости
  newsQueue: [],            // важные новости, ждущие показа на экране
  newsMode: null,           // 'full' — важные окном, остальные строкой; 'ticker' — все строкой; 'off'

  me() { return Game.me; },
  P() { return Game.P(Game.me); },
  D() { return POWERS[Game.me]; },

  /* ---------------- ИНИЦИАЛИЗАЦИЯ ---------------- */
  init() {
    this.el = {
      topbar: $('#topbar'), panel: $('#country-panel'), logList: $('#log-list'), logPanel: $('#log-panel'),
      logReopen: $('#log-reopen'), logUnread: $('#log-unread'), army: $('#army-box'), fronts: $('#fronts-box'),
      tip: $('#tooltip'), toasts: $('#toasts'), modalRoot: $('#modal-root'), flash: $('#flash'),
      date: $('#tb-date'), pause: $('#btn-pause'), pips: $$('#spd-pips i'), dayProg: $('#day-progress'),
      mapMode: $('#btn-map-mode'), net: $('#net-status')
    };

    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('keydown', e => this.onKey(e));
    this.initTooltips();

    $('#log-filters').addEventListener('click', e => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      this.logFilter = b.dataset.filter;
      $$('#log-filters .chip').forEach(x => x.classList.toggle('active', x === b));
      this.applyLogFilter();
    });

    const tipk = (id, key) => { const n = document.getElementById(id); if (n) n.dataset.tipk = key; };
    tipk('res-pp', 'pp'); tipk('res-fac', 'fac'); tipk('res-mp', 'mp'); tipk('res-div', 'div');
    tipk('res-rp', 'rp'); tipk('res-nuke', 'nuke'); tipk('res-tension', 'tension'); tipk('tb-nation', 'leader');
    tipk('net-status', 'net'); tipk('res-ruua', 'ruua'); tipk('res-uaw', 'uaw');

    // Игра шлёт события и посреди хода ИИ (когда активной державы нет) — поэтому
    // каждый обработчик интерфейса выполняется «от лица» своей державы
    const on = (evt, fn) => Bus.on(evt, (...args) => Game.S ? Game.as(Game.me, () => fn(...args)) : fn(...args));
    on('log', e => { if (!e.to || e.to === Game.me) { this.addLogEntry(e, true); if (e.cat === 'news') this.onNews(e); } });
    on('toast', (msg, type) => this.toast(msg, type));
    // Откладываем на следующий такт JS: если одновременно запускается анимация (ядерный удар),
    // она успеет «занять» экран, и событие покажется уже после неё
    on('event', ev => {
      if (ev.power !== Game.me) return;
      // После переподключения сервер присылает неотвеченные события заново — не дублируем
      if (this.eventQueue.some(e => e.iid === ev.iid) || this.modals.some(m => m.iid === ev.iid)) return;
      this.eventQueue.push(ev);
      setTimeout(() => this.nextEvent(), 0);
    });
    on('eventClosed', ev => this.dropEvent(ev.iid));
    on('battle', r => { if (r.by === Game.me) this.onBattle(r); });
    on('nuke', r => this.onNuke(r));
    on('enemyNuke', r => this.onEnemyNuke(r));
    on('enemyAttack', r => this.onEnemyAttack(r));
    on('war', () => Sound.play('alert'));
    on('peaceConf', p => { if (p.power === Game.me) { Sound.play('ok'); setTimeout(() => this.checkPeaceConf(), 400); } });
    on('treaty', t => this.onTreaty(t));
    on('unResult', r => { if (this.isOpen('un')) this.renderUN(true); });
    on('mapDirty', () => MapView.refresh());
    on('mapDirtyDelayed', () => { MapView.hold(1900); MapView.refresh(); });
    on('stateChanged', () => this.renderAll());
    on('tick', () => this.onTick());
    on('techDone', t => { if (t.power === Game.me) { this.toast(`Исследовано: «${t.name}»`, 'ok'); Sound.play('ok'); } });
    on('focusDone', f => { if (f.power === Game.me) { this.toast(`Фокус выполнен: «${f.name}»`, 'ok'); Sound.play('ok'); } });
    on('powerOut', p => { if (p.power !== Game.me) this.toast(`${POWERS[p.power].name} капитулирует!`, 'warn'); });
    on('gameover', o => setTimeout(() => this.showGameOver(o), Math.max(300, this.fxBusyUntil - performance.now())));
    on('newGame', () => this.onGameStart());
    on('loaded', () => this.onGameStart());
    on('lobby', room => this.renderLobby(room));
    on('netStart', () => { this.closeIntro(); this.toast('Сетевая игра началась. Пауза снимается кнопкой ▶ — у всех сразу.', 'info'); });
    on('netStatus', st => this.setNetStatus(st));
    // Запасной вход в консоль — тройной клик по дате
    this.el.date.addEventListener('click', e => { if (e.detail === 3 && this.started) this.openConsole(); });
  },

  onGameStart() {
    this.sig = {};
    this.unread = 0;
    this.newsSeen = 0;
    // Новости новой партии (например, «Мир в 2018 году») оставляем, чужие — выбрасываем
    this.newsQueue = this.newsQueue.filter(e => Game.S.log.includes(e));
    setTimeout(() => this.nextNews(), 900);
    this.polSel = null;
    this.eventQueue = [];
    this.select(null);
    this.applyNation();
    this.rebuildLog();
    $$('.hidden-ui').forEach(el => el.classList.remove('hidden-ui'));
    this.renderAll();
    this.checkPeaceConf();
    this.updateTradeBadge();
    if (this.isOpen('trade')) this.renderTrade();
    this.updateUNBadge();
    if (this.isOpen('un')) this.renderUN();
    if (this.pc && this.isOpen('peace')) this.renderPeace();
    this.updateTopbar();
    this.updateClock();
    this.setNetStatus(Net.mp ? 'ok' : 'off');
    MapView.refresh(true);
    if (this.started) MapView.focus(this.D().capital);
  },

  // Шапка: герб, лидер и название своей державы
  applyNation() {
    const d = this.D();
    $('#tb-nation .emblem use').setAttribute('href', '#' + d.emblem);
    $('#tb-nation .tb-nation-name').textContent = d.name;
    this.updateLeader();
    document.body.dataset.power = Game.me;
  },
  updateLeader() {
    const lead = Game.leaderOf(Game.me), pol = Game.powerGov(Game.me);
    const key = lead + '|' + (pol && pol.ide);
    if (this.sig.leader === key) return;
    this.sig.leader = key;
    $('#tb-nation .leader-portrait').textContent = Politics.initials(lead);
    $('#tb-nation .tb-leader').textContent = Game.leaderTitle(Game.me).split(' ')[0] + ' ' + lead;
    if (pol) $('#tb-nation').style.setProperty('--ic', IDEOLOGIES[pol.ide].color);
  },

  setNetStatus(st) {
    const el = this.el.net;
    if (!el) return;
    el.classList.toggle('hidden', !Net.mp);
    el.classList.toggle('lost', st === 'lost');
    el.querySelector('span').textContent = st === 'lost' ? 'Нет связи…' : (Net.room ? Net.room.code : 'Сеть');
    if (st === 'lost') this.toast('Связь с сервером потеряна. Переподключаемся…', 'warn');
    if (st === 'ok' && Net.mp && this.lostOnce) this.toast('Связь восстановлена', 'ok');
    this.lostOnce = st === 'lost' || this.lostOnce;
  },

  /* ---------------- ОБРАБОТКА КЛИКОВ ---------------- */
  onClick(e) {
    const a = e.target.closest('[data-act],[data-ui]');
    if (!a) return;
    if (a.getAttribute('aria-disabled') === 'true') {
      const why = a.dataset.why;
      if (why) this.toast(why, 'err');
      Sound.play('error');
      return;
    }
    if (a.dataset.ui) return this.doUI(a.dataset.ui, a);
    this.doAct(a);
  },

  doUI(cmd) {
    Sound.play('click');
    switch (cmd) {
      case 'research': return this.openResearch('research');
      case 'focus': return this.openResearch('focus');
      case 'trade': return this.openTrade();
      case 'un': return this.openUN();
      case 'toggle-pause': return this.togglePause();
      case 'speed-up': return this.setSpeed(Game.S.speed + 1);
      case 'speed-down': return this.setSpeed(Game.S.speed - 1);
      case 'menu': return this.openMenu();
      case 'close-panel': return this.selectedArmy ? this.selectArmy(null) : this.select(null);
      case 'log-collapse': return this.toggleLog();
      case 'map-mode': return this.toggleMapMode();
      case 'templates': return this.openTemplates();
      case 'news': return this.openNews();
      case 'map-layer': return this.toggleMapLayer();
      case 'modal-close': return this.closeModal();
    }
  },

  doAct(a) {
    const act = a.dataset.act, id = a.dataset.id;
    const run = (name, ...args) => Act.call(name, ...args).then(res => this.result(res));
    switch (act) {
      case 'select': this.select(id, true); Sound.play('click'); return;
      case 'log-goto': this.select(id, true); return;
      case 'deploy': return run('deploy', +a.dataset.n, this.deployTplId());
      case 'fortify': return run('fortify', id);
      case 'justify': return run('justify', id);
      case 'declare': return this.confirmDeclare(id);
      case 'peace': return run('peace', id);
      case 'treaty': return this.openPeace(a.dataset.conf ? { conf: a.dataset.conf } : { id });
      case 'influence': return run('influence', id);
      case 'integrate': return run('integrate', id);
      case 'spy': return run('spy', id, a.dataset.op);
      case 'attack-plan': {
        // Регион этой страны на нашем фронте (или её столица)
        const fr = Game.frontRegions().find(r => (Game.ownerNation(r) || {}).id === id);
        this.select(fr ? fr.id : id, true);
        return;
      }
      case 'army-select': Sound.play('click'); this.selectArmy(a.dataset.army); return;
      case 'army-attack': return run('orderAttack', a.dataset.army, id);
      case 'army-air': return run('orderAirborne', a.dataset.army, id);
      case 'army-hold': return run('orderHold', a.dataset.army);
      case 'army-reinforce': return run('reinforceArmy', a.dataset.army, +a.dataset.n);
      case 'army-disband': return run('disbandArmy', a.dataset.army).then(() => this.selectArmy(null));
      case 'army-create': return Act.call('createArmy', +a.dataset.n).then(res => { this.result(res); if (res && res.army) this.selectArmy(res.army); });
      case 'nuke-plan': return this.openNukePlanner(id);
      case 'research': return run('startResearch', id);
      case 'focus-start': return run('startFocus', id);
      case 'pol-ide': this.polSel = { cid: id, ide: a.dataset.ide }; this.sig.country = null; this.renderCountry(); Sound.play('click'); return;
      case 'pol-support': return run('supportParty', id, a.dataset.ide);
      case 'pol-meddle': return run('meddle', id, a.dataset.ide);
      case 'pol-coup': return this.confirmCoup(id, a.dataset.ide);
      case 'news-goto': this.closeModal(); this.select(id, true); return;
    }
  },

  result(res) {
    if (!res) return;
    if (!res.ok) {
      this.toast(res.msg || 'Действие недоступно', 'err');
      Sound.play('error');
    } else {
      if (res.msg) this.toast(res.msg, res.warn ? 'warn' : 'ok');
      Sound.play(res.warn ? 'error' : 'ok');
    }
    this.renderAll();
  },

  onKey(e) {
    if (!Game.S || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.modals.length) { const top = this.modals[this.modals.length - 1]; if (top.dismissible) this.closeModal(top); }
      else if (this.selectedArmy) this.selectArmy(null);
      else if (this.selected) this.select(null);
      else if (this.started) this.openMenu();
      return;
    }
    if (this.started && (e.code === 'Backquote' || ['`', '~', 'ё', 'Ё'].includes(e.key))) { e.preventDefault(); this.openConsole(); return; }
    if (this.modals.length || !this.started) return;
    if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
    else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') this.setSpeed(Game.S.speed + 1);
    else if (e.key === '-' || e.code === 'NumpadSubtract') this.setSpeed(Game.S.speed - 1);
    else if (/^[1-4]$/.test(e.key)) this.setSpeed(+e.key);
    else if (e.code === 'KeyR') this.openResearch('research');
    else if (e.code === 'KeyF') this.openResearch('focus');
    else if (e.code === 'KeyM') this.toggleMapMode();
    else if (e.code === 'KeyD') this.openTemplates();
    else if (e.code === 'KeyN') this.openNews();
    else if (e.code === 'KeyT') this.openTrade();
    else if (e.code === 'KeyU') this.openUN();
    else if (e.code === 'KeyI') this.toggleMapLayer();
  },

  /* ---------------- ВРЕМЯ ---------------- */
  togglePause() {
    const S = Game.S;
    if (!S || S.over) return;
    if (Net.mp) { Act.call('setPaused', !S.paused); return; }
    S.paused = !S.paused;
    this.updateClock();
  },
  setSpeed(v) {
    const S = Game.S;
    if (!S) return;
    v = U.clamp(v, 1, 4);
    if (Net.mp) { Act.call('setSpeed', v); return; }
    S.speed = v;
    this.updateClock();
  },
  updateClock() {
    const S = Game.S;
    if (!S) return;
    this.el.date.textContent = U.fmtDate(S.date);
    this.el.pause.innerHTML = `<svg><use href="#${S.paused ? 'i-play' : 'i-pause'}"/></svg>`;
    this.el.pause.classList.toggle('paused', S.paused);
    this.el.topbar.classList.toggle('is-paused', S.paused);
    this.el.pips.forEach((p, i) => p.classList.toggle('on', i < S.speed));
  },
  setDayProgress(f) { this.el.dayProg.style.width = (f * 100).toFixed(1) + '%'; },

  /* ---------------- ВЫБОР СТРАНЫ ---------------- */
  // id страны → её столичный регион (для ссылок из журнала, новостей, списков)
  regionFor(id) {
    if (!id) return null;
    if (Game.r(id)) return id;
    const rid = Regions.capitalOf[id];
    return rid && Game.r(rid) ? rid : null;
  },
  select(id, focusMap) {
    if (id && this.selectedArmy) this.selectArmy(null);
    this.selected = this.regionFor(id);
    MapView.setSelected(this.selected);
    if (this.selected && focusMap) MapView.focus(this.selected);
    this.sig.country = null;
    this.renderCountry();
  },

  /* ---------------- АРМИИ: выбор и приказы ----------------
     Клик по фишке — выбрать армию. Затем клик (или правый клик) по своей земле — марш,
     по соседней вражеской — наступление. Esc или повторный клик по фишке — отменить выбор. */
  armyClick(id, tag) {
    if (this.modals.length || !this.started) return;
    if (tag !== Game.me) {
      const a = Game.army(id, tag);
      if (a) this.toast(`${a.name} (${POWERS[tag].name}) — армия другой державы`, 'info');
      return;
    }
    Sound.play('click');
    this.selectArmy(this.selectedArmy === id ? null : id);
  },

  selectArmy(id) {
    this.selectedArmy = id && Game.army(id) ? id : null;
    MapView.setSelectedArmy(this.selectedArmy);
    document.body.classList.toggle('army-mode', !!this.selectedArmy);
    if (this.selectedArmy) { this.selected = null; MapView.setSelected(null); }
    this.sig.country = null;
    this.sig.dock = null;
    this.renderCountry();
    this.renderDock();
  },

  // Приказ выбранной армии: своя земля — марш, соседняя вражеская — наступление
  issueOrder(targetId) {
    const a = Game.army(this.selectedArmy);
    const c = Game.r(targetId);
    if (!a || !c) return;
    if (c.ctrl === Game.me) {
      Act.call('orderMove', a.id, c.id).then(res => this.result(res));
    } else {
      const adj = Regions.adjacent(a.loc, c.id);
      if (!adj && Game.isAirborne(a) && Game.atWar(c)) {
        const whyAir = Game.canAirdrop(a, c);
        if (whyAir) { this.toast(whyAir, 'err'); Sound.play('error'); return; }
        Act.call('orderAirborne', a.id, c.id).then(res => this.result(res));
        return;
      }
      const why = Game.canOrderAttack(a, c);
      if (why) { this.toast(why === 'Нет состояния войны' ? 'С этой страной нет войны — сначала обоснуйте и объявите её' : why, 'err'); Sound.play('error'); return; }
      Act.call('orderAttack', a.id, c.id).then(res => this.result(res));
    }
  },

  mapRight(id) {
    if (this.modals.length || !this.started || !id) return;
    if (this.selectedArmy) this.issueOrder(id);
  },

  mapClick(id) {
    if (this.selectedArmy && id && !this.modals.length) { this.issueOrder(id); return; }
    if (this.selectedArmy && !id) { this.selectArmy(null); return; }
    if (this.modals.length || !this.started) return;
    if (id) Sound.play('click');
    this.select(id === this.selected ? null : id);
  },

  mapHover(id) {
    this.mapHoverId = id;
    MapView.setHovered(id);
    if (id) this.showTip(this.countryTip(id));
    else if (!this.tipTarget) this.hideTip();
  },

  /* ---------------- ОБНОВЛЕНИЕ КАЖДЫЙ ДЕНЬ ---------------- */
  onTick() {
    if (!this.P()) return;
    if (this.selectedArmy && !Game.army(this.selectedArmy)) this.selectArmy(null);
    MapView.refreshArmies();
    this.updateTopbar();
    this.updateClock();
    this.renderAll();
    this.updateLive();
    if (this.tipTarget && this.tipTarget.dataset.tipk && document.body.contains(this.tipTarget)) {
      this.showTip(this.tipFns[this.tipTarget.dataset.tipk].call(this));
    } else if (this.mapHoverId && !this.tipTarget) {
      this.showTip(this.countryTip(this.mapHoverId));
    }
  },

  renderAll() {
    if (!Game.S || !this.P()) return;
    this.renderCountry();
    this.renderDock();
    if (this.isOpen('research')) this.renderResearch();
    this.updateTopbar();
  },

  updateTopbar() {
    const S = Game.S, P = this.P();
    if (!S || !P) return;
    const m = Game.mods;
    const set = (id, val, delta) => {
      const r = document.getElementById(id);
      r.querySelector('.res-val').textContent = val;
      const d = r.querySelector('.res-delta');
      if (d && delta != null) d.textContent = delta;
    };
    set('res-pp', U.fmt(Math.floor(P.pp)), U.signed(Game.dailyPP(), 1));
    set('res-fac', U.fmt(Game.playerFactories()), U.pct(Game.industryShare()));
    set('res-mp', U.fmtMP(P.mp), U.signed(Game.dailyMP(), 1));
    set('res-rp', U.fmt(Math.floor(P.rp)), U.signed(Game.dailyRP(), 1));
    const training = P.training.reduce((s, t) => s + t.count, 0);
    const org = Game.avgOrg();
    $('#res-div .res-val').textContent = U.fmt(Math.round(Game.totalDivs())) + (training ? ` +${training}` : '');
    $('#res-div .res-org i').style.width = org + '%';
    $('#res-div .res-org').classList.toggle('low', org < 35);

    const nk = $('#res-nuke');
    nk.classList.toggle('hidden', !m.nukes);
    if (m.nukes) set('res-nuke', P.warheads, `${m.warheadDays - P.warheadTimer} дн.`);

    const rr = $('#res-ruua'), sides = Game.ruuaSides && Game.ruuaSides();
    const showRR = !!sides && (Game.me === 'SOV' || Game.me === 'UA');
    rr.classList.toggle('hidden', !showRR);
    if (showRR) {
      rr.querySelector('.res-val').textContent = Math.round(S.ruua || 0) + '%';
      rr.querySelector('.res-delta').textContent = Game.ruuaWar() ? 'война' : (S.ruua >= 90 ? 'на грани' : S.ruua >= 75 ? 'опасно' : 'напряжённость');
      rr.classList.toggle('hot', S.ruua >= 75 && S.ruua < 90);
      rr.classList.toggle('crit', S.ruua >= 90);
    }
    const uw = $('#res-uaw'), showUW = !!sides && Game.me === 'UA';
    uw.classList.toggle('hidden', !showUW);
    if (showUW) {
      uw.querySelector('.res-val').textContent = Math.round(S.uaw || 0) + '%';
      uw.querySelector('.res-delta').textContent = S.uaw >= 70 ? 'союзник' : S.uaw >= 45 ? 'партнёр' : S.uaw >= 25 ? 'сомневается' : 'не доверяет';
    }
    const t = S.tension;
    const tEl = $('#res-tension');
    tEl.querySelector('.res-val').textContent = U.fmt(t, 0) + '%';
    tEl.querySelector('.tension-bar i').style.width = t + '%';
    tEl.classList.toggle('t-mid', t >= 35 && t < 50);
    tEl.classList.toggle('t-high', t >= 50 && t < 75);
    tEl.classList.toggle('t-crit', t >= 75);

    const freeSlot = P.research.length < 2 && TECHS.some(x => Game.techState(x) === 'available' && P.rp >= Game.techCost(x).rp);
    $('#badge-research').classList.toggle('hidden', !freeSlot);
    $('#badge-research').textContent = '!';
    this.updateLeader();
    this.updateNewsBadge();
    const freeFocus = !P.focus && Game.focusTree().some(f => Game.focusState(f) === 'available');
    $('#badge-focus').classList.toggle('hidden', !freeFocus);
    $('#badge-focus').textContent = '!';
  },

  // Полосы прогресса и счётчики дней обновляем «на месте», без перерисовки HTML
  updateLive() {
    const P = this.P(), me = Game.me;
    if (!P) return;
    $$('[data-live]').forEach(el => {
      const kind = el.dataset.live;
      if (kind === 'aorg' || kind === 'aorgtxt' || kind === 'adivs') {
        const a = Game.army(el.dataset.id);
        if (!a) return;
        if (kind === 'aorg') el.style.width = a.org + '%';
        else if (kind === 'aorgtxt') el.textContent = Math.round(a.org) + '%';
        else el.textContent = U.fmt(a.divs, 1);
        return;
      }
      const k = el.dataset.k, id = el.dataset.id;
      let cur = null;
      const c = Game.c(id);
      if (k === 'justify') cur = c && Game.justifying(c, me);
      else if (k === 'influence' || k === 'integrate') cur = c && c[k] && c[k].by === me ? c[k] : null;
      else if (k === 'train') cur = P.training[+id];
      else if (k === 'research') cur = P.research.find(r => r.id === id);
      else if (k === 'focus') cur = P.focus && P.focus.id === id ? P.focus : null;
      if (!cur) return;
      if (kind === 'prog') el.style.width = ((1 - cur.daysLeft / cur.total) * 100).toFixed(1) + '%';
      else el.textContent = U.days(cur.daysLeft);
    });
  },

  /* ---------------- ПАНЕЛЬ СТРАНЫ ---------------- */
  renderCountry() {
    const panel = this.el.panel;
    const army = this.selectedArmy && Game.army(this.selectedArmy);
    if (army) {
      const sig = 'army' + JSON.stringify([army, Game.P().divs, this.armyTargetsSig(army)]);
      if (sig === this.sig.country) return;
      this.sig.country = sig;
      panel.innerHTML = this.armyHTML(army);
      panel.classList.add('open');
      return;
    }
    const c = this.selected && Game.r(this.selected);
    if (!c) {
      panel.classList.remove('open');
      this.sig.country = null;
      return;
    }
    const sig = this.countrySig(c);
    if (sig === this.sig.country) return;
    this.sig.country = sig;
    const scroll = panel.querySelector('.cp-body') ? panel.querySelector('.cp-body').scrollTop : 0;
    panel.innerHTML = this.countryHTML(c);
    const body = panel.querySelector('.cp-body');
    if (body) body.scrollTop = scroll;
    panel.classList.add('open');
    this.updateLive();
  },

  countrySig(r) {
    const P = this.P(), me = Game.me, est = Game.estDivs(r);
    const N = Game.ownerNation(r) || {};
    const reasons = N.id ? [Game.canJustify(N), Game.canDeclare(N), Game.canPeace(N), Game.canInfluence(N), Game.canIntegrate(N),
      ...SPY_OPS.map(op => Game.canSpy(N, op))] : [];
    reasons.push(Game.canNuke(r), Game.canFortify(r), Game.canDeploy(1, this.deployTplId()), Game.canDeploy(5, this.deployTplId()), this.deployTplId(),
      Game.armies().filter(a => Regions.adjacent(a.loc, r.id) || Game.isAirborne(a)).map(a => [a.id, Math.round(a.divs), Math.round(a.org / 5), a.order.type]));
    return JSON.stringify([r.id, r.ctrl, N.faction, Game.atWar(r), N.cb && N.cb[me] === true, N.id && !!Game.justifying(N), !!N.influence, !!N.integrate, r.radioactive,
      r.factories, r.fort, Math.round(r.control), N.id ? Math.round(Game.intel(N) / 5) : 0, N.sab, est.lo, est.hi, Math.round(r.pop / 1e5), N.id ? N.factories : 0,
      reasons, P.divs, P.warheads, Game.S.tension >= 50, Math.round(Game.S.ruua || 0), Math.round(Game.S.uaw || 0), Math.round(Game.S.tension / 4), Game.mods.nukes, P.techs.length,
      N.capitulated, (Game.myConf(me) || {}).id, N.id && !Game.isPower(r.ctrl) ? Game.warScore(me, N) : 0,
      N.id ? this.polSig(r.ctrl === me ? Game.c(POWERS[me].capital) : N) : 0]);
  },

  badge(text, cls) { return `<span class="bdg bdg-${cls}">${U.esc(text)}</span>`; },

  costTag(pp, extra = '') {
    return `<span class="act-cost">${pp != null ? `<svg><use href="#i-pp"/></svg>${pp}` : ''}${extra}</span>`;
  },

  actBtn({ act, id = '', label, icon, why = null, sub = '', cost = '', cls = '', data = '', tip = '' }) {
    const dis = !!why;
    const tipText = dis ? why : tip;
    return `<button class="act ${cls}${dis ? ' is-disabled' : ''}" data-act="${act}" data-id="${id}" ${data}
      aria-disabled="${dis}" ${dis ? `data-why="${U.esc(why)}"` : ''} ${tipText ? `data-tip="${U.esc(tipText)}"` : ''}>
      <svg class="act-ico"><use href="#${icon}"/></svg>
      <span class="act-text"><span class="act-label">${label}</span>${dis ? `<span class="act-why">${U.esc(why)}</span>` : (sub ? `<span class="act-sub">${sub}</span>` : '')}</span>
      ${cost}
    </button>`;
  },

  stat(label, value, extra = '', tip = '') {
    return `<div class="st"${tip ? ` data-tip="${U.esc(tip)}"` : ''}><span class="st-l">${label}</span><b class="st-v">${value}</b>${extra}</div>`;
  },

  pipBar(n, max = 3) {
    let s = '<span class="pips">';
    for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
    return s + '</span>';
  },

  meter(pct, cls = '') { return `<div class="meter ${cls}"><i style="width:${U.clamp(pct, 0, 100)}%"></i></div>`; },

  projectBlock(c, k, title) {
    const me = Game.me;
    const v = k === 'justify' ? Game.justifying(c, me) : (c[k] && c[k].by === me ? c[k] : null);
    if (!v) return '';
    return `<div class="prj"><div class="prj-top"><span>${title}</span><em data-live="days" data-k="${k}" data-id="${c.id}">${U.days(v.daysLeft)}</em></div>
      <div class="meter meter-gold"><i data-live="prog" data-k="${k}" data-id="${c.id}" style="width:${(1 - v.daysLeft / v.total) * 100}%"></i></div></div>`;
  },

  countryColor(r) {
    if (r.radioactive) return COLORS.waste;
    if (Game.atWar(r, Game.me)) return COLORS.front;
    if (Game.isPower(r.ctrl)) return POWERS[r.ctrl].color;
    const N = Game.ownerNation(r) || r;
    return (FACTIONS[N.faction] || FACTIONS.NEU).color;
  },

  // Подпись владельца: держава игрока или ИИ-государство (с блоком)
  ownerLabel(r) {
    if (Game.isPower(r.ctrl)) {
      const P = Game.P(r.ctrl);
      return POWERS[r.ctrl].name + (P.player && r.ctrl !== Game.me ? ` (${P.player})` : '');
    }
    const N = Game.ownerNation(r) || r;
    return N.id === (Game.c(r.cid) || {}).id ? (FACTIONS[N.faction] || FACTIONS.NEU).name : N.name;
  },

  /* Панель региона: сам регион + государство, которое им владеет */
  countryHTML(r) {
    const S = Game.S, m = Game.mods, me = Game.me, d = this.D(), P = this.P();
    const N = Game.ownerNation(r);              // государство-владелец (для державы — её страна)
    const H = Game.c(r.cid);                    // страна, которой регион принадлежит исторически
    const color = this.countryColor(r);
    const own = r.ctrl === me;
    const Y = Game.powerOf(r);
    const rival = Y && Y !== me;
    const occupied = H && r.ctrl !== H.ctrl;
    const est = Game.estDivs(r);
    const war = Game.atWar(r);

    const badges = [];
    if (own && r.id === Game.capitalRegion(me)) badges.push(this.badge('Столица', 'sov'));
    if (own) badges.push(this.badge(r.core === me ? 'Исконная земля' : 'Присоединённая земля', 'sov'));
    if (!own) badges.push(this.badge(this.ownerLabel(r), rival ? 'major' : 'fac'));
    if (rival) badges.push(this.badge('Держава игрока', 'war'));
    if (N && Game.isAlly(N)) badges.push(this.badge('Союзник', 'sov'));
    if (N && N.major && !own && !rival) badges.push(this.badge('Великая держава', 'major'));
    if (war) badges.push(this.badge('Война', 'war'));
    if (occupied && !own) badges.push(this.badge('Оккупирован: ' + Regions.ownerName(r.ctrl), 'war'));
    if (N && N.cb[me] === true) badges.push(this.badge('Повод для войны', 'cb'));
    if (r.radioactive) badges.push(this.badge('Радиация', 'rad'));

    const sub = H && H.name !== r.name ? `<div class="cp-sub">${U.esc(H.name)}${Game.isCapitalRegion(r) ? ' · столичный регион' : ''}</div>` : '';
    let html = `<div class="cp-head" style="--fc:${color}">
      <div class="cp-flag"><span>${U.esc(r.cid)}</span></div>
      <div class="cp-title"><div class="cp-name">${U.esc(r.name)}</div>${sub}<div class="cp-badges">${badges.join('')}</div></div>
      <button class="icon-btn" data-ui="close-panel" data-tip="Закрыть (Esc)"><svg><use href="#i-close"/></svg></button>
    </div><div class="cp-body">`;

    if (H && H.inert) {
      html += `<div class="cp-note">Антарктический договор: на континенте нет государств, армий и заводов. Здесь нечего завоёвывать — только лёд.</div></div>`;
      return html;
    }

    /* --- Показатели региона --- */
    html += '<div class="cp-stats">';
    html += this.stat('Заводы региона', U.fmt(r.factories));
    html += this.stat('Население', U.fmtPop(r.pop));
    const rres = Game.regionRes(r);
    if (rres) html += `<div class="st st-wide"><span class="st-l">Месторождения</span><div class="cp-res">${RES_KEYS.filter(k => rres[k]).map(k =>
      `<span style="--rc:${RES[k].color}" data-tip="${RES[k].name}: ${rres[k]} ед. добычи"><svg><use href="#${RES[k].icon}"/></svg>${rres[k]}</span>`).join('')}</div></div>`;
    if (own) {
      const mp = r.radioactive ? 0 : r.pop * CFG.MP_PER_POP * (r.core === me ? 1 : CFG.ANNEXED_MP) * (1 + m.mpMult);
      html += this.stat('Призыв в день', U.fmt(mp, 2) + ' тыс.');
      html += this.stat('Укрепления', this.pipBar(r.fort));
      html += this.stat('Контроль', Math.round(r.control) + '%', this.meter(r.control, r.control < 60 ? 'meter-red' : 'meter-green'));
      html += this.stat('Наши войска здесь', U.fmt(Game.landDefenders(r, me), 1));
    } else {
      const divTxt = est.exact ? U.fmt(est.mid, 1) : `~${est.lo}–${est.hi}`;
      html += this.stat('Войска в регионе', divTxt, '', rival ? 'Армии державы, стоящие в этом регионе.' : 'Армия ИИ-государства общая: у фронта она стоит гуще, в тылу — реже.');
      const def = Combat.defenseBreakdown(r, est.mid).total;
      html += this.stat('Оборона', (est.exact ? '' : '~') + U.fmt(def, 0));
      html += this.stat('Укрепления', this.pipBar(r.fort));
      html += this.stat('Стойкость', '×' + U.fmt(Combat.resilienceOf(r), 1), '',
        'Во сколько раз медленнее падает контроль при наших победах. Растёт с заводами региона; у столичного региона выше.');
      if (N) html += this.stat('Разведданные', Math.round(Game.intel(N)) + '%', this.meter(Game.intel(N), 'meter-violet'));
      if (war || r.control < 100) html += this.stat('Контроль противника', Math.round(r.control) + '%', this.meter(r.control, 'meter-orange'));
      if (N && N.sab > 0) html += this.stat('Саботаж', `−${Math.round(N.sab * 100)}%`, `<span class="st-note">${U.days(N.sabDays)}</span>`);
    }
    html += '</div>';

    /* --- Государство-владелец --- */
    if (N && !own) {
      const total = Game.estDivs(N);
      const held = Game.lands(Game.isPower(r.ctrl) ? r.ctrl : N.id).length;
      html += `<div class="cp-nation"><b>${U.esc(Y ? POWERS[Y].name : N.name)}</b><span>регионов: ${held} · заводов: ${Game.playerFactories(Y || N.id)} · армия: ${total.exact ? U.fmt(total.mid, 0) : '~' + total.lo + '–' + total.hi} див.</span></div>`;
    }

    /* --- Пояснение --- */
    if (own) {
      if (r.radioactive) html += `<div class="cp-note warn">Радиоактивная пустошь. Заводы и призыв здесь невозможны навсегда.</div>`;
      else if (Regions.nb(r.id).some(n => Game.atWar(Game.r(n))))
        html += `<div class="cp-note warn">Прифронтовой регион: враг может перейти в наступление. Укрепления повышают оборону на 15% за уровень.</div>`;
    } else if (N && Game.isAlly(N)) {
      html += `<div class="cp-note">Союзник по блоку «${U.esc(d.allyName)}»: +0,1 ПВ в день. Можно мирно интегрировать в состав державы.</div>`;
    } else {
      const sup = Game.supplyFactor(r.id);
      html += `<div class="cp-note ${sup < 1 ? 'warn' : ''}">${sup === 1
        ? 'Граничит с нашими регионами — полное снабжение наступающих войск.'
        : sup === 0.8
          ? 'Граница только через пролив: форсирование водной преграды, −20% к атаке.'
          : 'Не граничит с нашими регионами: наступать можно только воздушным десантом.'}</div>`;
      if (rival) html += `<div class="cp-note">За эту державу играет человек. Регион защищают только армии, стоящие в нём (и резерв, если это столица).</div>`;
    }

    if (Game.ruuaSides && Game.ruuaSides() && ['RUS', 'UKR'].includes(r.cid)) {
      const v = Math.round(S.ruua || 0);
      const w = Math.round(S.uaw || 0);
      html += `<div class="cp-stats">${this.stat('Россия — Украина', Game.ruuaWar() ? 'война' : v + '%', this.meter(v, v >= 75 ? 'meter-red' : 'meter-orange'), 'Напряжённость между Россией и Украиной. На 100% начинается война.')}
        ${r.cid === 'UKR' ? this.stat('Украина — Запад', w + '%', this.meter(w, 'meter-violet'), 'Доверие Запада к Киеву. От него зависят санкции против России и поставки оружия, если начнётся война.') : ''}</div>`;
    }
    const polN = own ? Game.c(POWERS[me].capital) : N;
    if (polN) html += this.politicsHTML(polN);
    if (N) {
      html += this.projectBlock(N, 'justify', 'Обоснование войны');
      html += this.projectBlock(N, 'influence', 'Распространение влияния');
      html += this.projectBlock(N, 'integrate', 'Интеграция в состав державы');
    }

    /* --- Действия --- */
    if (own) {
      const tplId = this.deployTplId(), tpl = Game.tpl(tplId);
      const dc = Game.deployCost(1, tplId), dc5 = Game.deployCost(5, tplId);
      html += `<div class="cp-sec"><div class="cp-sec-title">Мобилизация и оборона</div>`;
      html += this.actBtn({ act: 'deploy', label: 'Сформировать: ' + (tpl ? tpl.name : 'дивизия'), icon: 'i-div', data: 'data-n="1"', why: Game.canDeploy(1, tplId),
        sub: `${U.fmtMP(dc.mp)} призывников · ${U.days(Game.trainDays(tplId))} · шаблон меняется внизу`, cost: this.costTag(dc.pp) });
      html += this.actBtn({ act: 'deploy', label: 'Сформировать 5 дивизий', icon: 'i-div', data: 'data-n="5"', why: Game.canDeploy(5, tplId),
        sub: `${U.fmtMP(dc5.mp)} призывников`, cost: this.costTag(dc5.pp) });
      html += this.actBtn({ act: 'fortify', id: r.id, label: 'Возвести укрепрайон в регионе', icon: 'i-shield', why: Game.canFortify(r),
        sub: '+15% к обороне региона', cost: this.costTag(CFG.FORTIFY_PP) });
      html += '</div>';
    } else if (N && Game.isAlly(N)) {
      html += `<div class="cp-sec"><div class="cp-sec-title">Дипломатия</div>`;
      html += this.actBtn({ act: 'integrate', id: N.id, label: 'Интегрировать в состав державы', icon: 'i-flag', why: Game.canIntegrate(N),
        sub: `${U.days(Game.integrateDays(N))} · напряжённость +3%`, cost: this.costTag(CFG.INTEGRATE.pp) });
      html += '</div>';
    } else if (N) {
      const c = N;
      html += `<div class="cp-sec"><div class="cp-sec-title">Дипломатия: ${U.esc(Y ? POWERS[Y].name : c.name)}</div>`;
      const conf = c.capitulated === me && Game.myConf(me);
      if (conf) {
        html += this.actBtn({ act: 'treaty', id: r.id, data: `data-conf="${conf.id}"`, label: 'Мирная конференция', icon: 'i-flag', cls: 'act-gold',
          sub: 'Противник капитулировал: 100 очков на требования', tip: 'Заберите регионы, сделайте страну марионеткой, смените режим или потребуйте репарации.' });
      } else if (war) {
        const score = rival ? Game.powerWarScore(me, Y) : Game.warScore(me, c);
        html += this.actBtn({ act: 'treaty', id: rival ? r.id : c.id, label: 'Мирные переговоры', icon: 'i-flag', why: Game.canPeace(c),
          sub: `Очки войны: ${score} · ${rival ? 'решение примет второй игрок' : 'белый мир: шанс ' + U.pct(Game.peaceChance(c))}`, cost: this.costTag(CFG.PEACE_PP),
          tip: 'Потребуйте регионы и другие условия на очки войны — или предложите белый мир.' });
      } else if (c.cb[me] === true) {
        html += this.actBtn({ act: 'declare', id: c.id, label: 'Объявить войну', icon: 'i-swords', cls: 'act-danger',
          sub: `Напряжённость +${U.fmt(Game.declareTension(c), 0)}%`, cost: '' });
      } else {
        const jc = Game.justifyCost(c);
        html += this.actBtn({ act: 'justify', id: c.id, label: 'Обосновать войну', icon: 'i-swords', why: Game.canJustify(c),
          sub: `${U.days(jc.days)} · напряжённость +${U.fmt(CFG.JUSTIFY.tension * (c.major ? 1.5 : 1), 0)}%`, cost: this.costTag(jc.pp),
          tip: 'Пропаганда готовит casus belli. После обоснования можно объявить войну.' });
      }
      if (c.faction === 'NEU' && !war && c.ctrl === c.id) {
        html += this.actBtn({ act: 'influence', id: c.id, label: 'Распространить влияние', icon: 'i-pp', why: Game.canInfluence(c),
          sub: `${U.days(CFG.INFLUENCE.days)} · шанс ${U.pct(Game.influenceChance(c))} вступления в блок`,
          tip: 'Шанс выше, если правящая идеология страны совпадает с нашей.',
          cost: this.costTag(Game.influenceCost()) });
      }
      html += '</div>';

      html += `<div class="cp-sec"><div class="cp-sec-title">Разведка и тайные операции</div>`;
      for (const op of SPY_OPS) {
        html += this.actBtn({ act: 'spy', id: c.id, data: `data-op="${op.id}"`, label: op.name, icon: op.icon, why: Game.canSpy(c, op),
          sub: `Шанс успеха ${U.pct(Game.spyChance(c, op))}`, cost: this.costTag(Game.spyCost(op)), tip: op.desc });
      }
      html += '</div>';

      html += `<div class="cp-sec"><div class="cp-sec-title">Наступление на регион</div>`;
      html += this.attackOptionsHTML(r);
      html += '</div>';

      html += `<div class="cp-sec cp-sec-nuke"><div class="cp-sec-title">Стратегическое оружие</div>`;
      if (m.nukes) {
        html += this.actBtn({ act: 'nuke-plan', id: r.id, label: 'Ядерный удар по региону', icon: 'i-nuke', cls: 'act-nuke', why: Game.canNuke(r),
          sub: `Боеголовок: ${P.warheads}` });
      } else {
        const done = TECHS.filter(t => t.branch === 'nuclear' && P.techs.includes(t.id) && t.tier <= 4).length;
        const br = TECH_BRANCHES.find(b => b.id === 'nuclear');
        html += `<div class="nuke-locked"><svg><use href="#i-nuke"/></svg><div><b>${U.esc(Game.branchName(br))}: ${done} из 4 этапов</b>
          <span>Изучите ядерную ветку до межконтинентальной ракеты, чтобы открыть ядерный удар.</span></div></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  },

  /* ---------------- НИЖНИЙ ДОК: АРМИЯ И ФРОНТЫ ---------------- */
  renderDock() {
    const P = this.P(), me = Game.me;
    // Сначала фронты, граничащие с нами, затем остальные
    const fronts = Game.fronts().sort((a, b) => Game.bordersPower(b.id) - Game.bordersPower(a.id));
    const projects = Game.list(c => c.cb[me] || (c.influence && c.influence.by === me) || (c.integrate && c.integrate.by === me));
    const threatened = Game.lands().filter(c => c.control < 99.5);
    const sig = JSON.stringify([me, P.divs, this.selectedArmy, P.armies.map(a => [a.id, Math.round(a.divs), Math.round(a.org / 4), a.order.type, a.loc, a.order.target]),
      P.training.map(t => t.count + ':' + t.total + ':' + t.daysLeft), this.deployTplId(), JSON.stringify(P.templates), JSON.stringify(P.rmix),
      Game.canDeploy(1, this.deployTplId()), Game.canDeploy(5, this.deployTplId()),
      fronts.map(c => { const e = Game.estDivs(c); return [c.id, e.lo, e.hi, Math.round(c.control), c.ctrl, Game.regionsOf(c.id).filter(r => r.ctrl === me).length]; }),
      projects.map(c => [c.id, c.cb[me] === true, !!c.influence, !!c.integrate]),
      threatened.map(c => [c.id, Math.round(c.control / 5)])]);
    if (sig === this.sig.dock) return;
    this.sig.dock = sig;

    const tplId = this.deployTplId();
    const dc = Game.deployCost(1, tplId), dc5 = Game.deployCost(5, tplId);
    const newArmy = Math.min(P.divs, 10);
    const training = P.training.reduce((s, t) => s + t.count, 0);
    const soonest = P.training.length ? Math.min(...P.training.map(t => t.daysLeft)) : 0;
    let a = `<div class="box-title"><svg><use href="#i-div"/></svg>Резерв и мобилизация
        <button class="btn btn-xs ab-tpl-btn" data-ui="templates" data-tip="Конструктор шаблонов дивизий (D)">Шаблоны</button></div>
      <div class="ab-main">
        <div class="ab-divs" data-tip="${U.esc(Game.mixText(P.rmix) || 'Резерв пуст')}"><b>${P.divs}</b><span>${U.plural(P.divs, 'дивизия', 'дивизии', 'дивизий')} в резерве</span></div>
        ${this.actBtn({ act: 'army-create', label: newArmy ? `Новая армия (${newArmy})` : 'Новая армия', icon: 'i-flag', data: `data-n="${newArmy || 1}"`, why: Game.canCreateArmy(newArmy || 1), cls: 'act-sm act-army',
          tip: 'Свести дивизии резерва в армию. Армия появится в столице — затем выберите её и кликните по своей земле, чтобы отправить на фронт.' })}
      </div>
      <div class="ab-train">${training ? `В обучении: ${U.divs(training)}, ближайшие через ${U.days(soonest)}` : 'Обучение не ведётся'}</div>
      <div class="ab-btns">
        <select class="tpl-select" id="tpl-select" data-tip="Шаблон для новых дивизий">${Game.templates().map(t => `<option value="${t.id}" ${t.id === tplId ? 'selected' : ''}>${U.esc(t.name)}</option>`).join('')}</select>
        ${this.actBtn({ act: 'deploy', label: '+1', icon: 'i-plus', data: 'data-n="1"', why: Game.canDeploy(1, tplId), cls: 'act-sm act-deploy', cost: this.costTag(dc.pp),
          tip: `${dc.pp} ПВ и ${U.fmtMP(dc.mp)} призывников. Обучение: ${U.days(Game.trainDays(tplId))}.` })}
        ${this.actBtn({ act: 'deploy', label: '+5', icon: 'i-plus', data: 'data-n="5"', why: Game.canDeploy(5, tplId), cls: 'act-sm act-deploy', cost: this.costTag(dc5.pp),
          tip: `${dc5.pp} ПВ и ${U.fmtMP(dc5.mp)} призывников.` })}
      </div>`;
    this.el.army.innerHTML = a;
    this.el.army.querySelector('#tpl-select').onchange = e => { this.deployTpl = e.target.value; this.sig.dock = null; this.renderDock(); };

    let f = `<div class="box-title"><svg><use href="#i-swords"/></svg>Армии и фронты<span class="box-count">${fronts.length ? fronts.length + ' ' + U.plural(fronts.length, 'фронт', 'фронта', 'фронтов') : ''}</span></div><div class="fc-list">`;
    const cards = [];
    for (const ar of P.armies) {
      const loc = Game.r(ar.loc) || { name: '?' };
      const nm = id => (Game.r(id) || { name: '?' }).name;
      const st = ar.order.type === 'attack' ? (ar.order.air ? 'Десант: ' : 'Наступает: ') + nm(ar.order.target)
        : ar.order.type === 'move' ? 'На марше: ' + nm(ar.order.to || ar.order.path[ar.order.path.length - 1])
        : 'Оборона: ' + loc.name;
      cards.push(`<div class="fc fc-army ${ar.id === this.selectedArmy ? 'sel' : ''} st-${ar.order.type}" data-act="army-select" data-army="${ar.id}">
        <div class="fc-top"><svg class="fc-nato" viewBox="0 0 16 11"><rect x=".5" y=".5" width="15" height="10"/><path d="M.5 .5l15 10M15.5 .5l-15 10"/></svg><span class="fc-name">${U.esc(ar.name)}</span></div>
        <div class="fc-row"><span>${U.esc(st)}</span></div>
        <div class="fc-row"><span>Дивизии</span><b data-live="adivs" data-id="${ar.id}">${U.fmt(ar.divs, 1)}</b></div>
        <div class="meter ${ar.org < 35 ? 'meter-orange' : 'meter-green'}"><i data-live="aorg" data-id="${ar.id}" style="width:${ar.org}%"></i></div>
        <div class="fc-row fc-small"><span>Организация</span><b data-live="aorgtxt" data-id="${ar.id}">${Math.round(ar.org)}%</b></div>
      </div>`);
    }
    for (const c of fronts) {
      const e = Game.estDivs(c);
      const Y = Game.powerOf(c);
      const tag = Y ? POWERS[Y].name : '';
      const all = Game.regionsOf(c.id).length, taken = Game.regionsOf(c.id).filter(r => r.ctrl === me).length;
      cards.push(`<div class="fc fc-war" data-act="attack-plan" data-id="${c.id}">
        <div class="fc-top"><span class="fc-name">${U.esc(Y ? POWERS[Y].name : c.name)}</span>${tag ? `<span class="fc-tag">держава</span>` : ''}</div>
        <div class="fc-row"><span>Армия противника</span><b>${e.exact ? U.fmt(e.mid, 1) : '~' + e.lo + '–' + e.hi} див.</b></div>
        <div class="meter meter-orange"><i style="width:${all ? 100 * taken / all : 0}%"></i></div>
        <div class="fc-row fc-small"><span>Занято регионов</span><b>${taken} из ${all}</b></div>
        <button class="btn btn-xs btn-red" data-act="attack-plan" data-id="${c.id}"><svg><use href="#i-swords"/></svg>Наступать</button>
      </div>`);
    }
    for (const c of threatened) {
      cards.push(`<div class="fc fc-threat" data-act="select" data-id="${c.id}">
        <div class="fc-top"><span class="fc-name">${U.esc(c.name)}</span><span class="fc-tag">под ударом</span></div>
        <div class="meter meter-red"><i style="width:${c.control}%"></i></div>
        <div class="fc-row fc-small"><span>Наш контроль</span><b>${Math.round(c.control)}%</b></div>
      </div>`);
    }
    for (const c of projects) {
      let body = '';
      if (c.cb[me] === true) {
        body = `<div class="fc-row"><span>Повод для войны получен</span></div>
          <button class="btn btn-xs btn-red" data-act="declare" data-id="${c.id}">Объявить войну</button>`;
      } else {
        const k = Game.justifying(c, me) ? 'justify' : (c.influence && c.influence.by === me) ? 'influence' : 'integrate';
        const v = k === 'justify' ? Game.justifying(c, me) : c[k];
        const name = { justify: 'Обоснование войны', influence: 'Влияние', integrate: 'Интеграция' }[k];
        body = `<div class="fc-row"><span>${name}</span><b data-live="days" data-k="${k}" data-id="${c.id}">${U.days(v.daysLeft)}</b></div>
          <div class="meter meter-gold"><i data-live="prog" data-k="${k}" data-id="${c.id}" style="width:${(1 - v.daysLeft / v.total) * 100}%"></i></div>`;
      }
      cards.push(`<div class="fc fc-prj" data-act="select" data-id="${c.id}"><div class="fc-top"><span class="fc-name">${U.esc(c.name)}</span></div>${body}</div>`);
    }
    if (!cards.length) {
      f += `<div class="fc-empty"><b>Активных фронтов нет.</b> Кликните по стране на карте, обоснуйте войну и объявите её — территория станет фронтом.</div>`;
    } else f += cards.join('');
    f += '</div>';
    this.el.fronts.innerHTML = f;
  },

  /* ---------------- ЖУРНАЛ ---------------- */
  logHTML(e) {
    return `<div class="log-entry cat-${e.cat}${e.cid ? ' has-link' : ''}" data-cat="${e.cat}" ${e.cid ? `data-act="log-goto" data-id="${e.cid}"` : ''}>
      <div class="log-meta"><span class="log-badge">${LOG_BADGES[e.cat] || 'Сводка'}</span><span class="log-date">${U.fmtDateShort(e.date)}</span></div>
      <div class="log-title">${U.esc(e.title)}</div>
      <div class="log-text">${U.esc(e.text)}</div>
    </div>`;
  },

  addLogEntry(e, animate) {
    const list = this.el.logList;
    list.insertAdjacentHTML('afterbegin', this.logHTML(e));
    const node = list.firstElementChild;
    if (!this.matchesFilter(e.cat)) node.classList.add('filtered');
    if (animate) node.classList.add('fresh');
    while (list.children.length > 150) list.lastElementChild.remove();
    if (this.logCollapsed && e.cat !== 'news') {
      this.unread++;
      this.el.logUnread.textContent = this.unread;
      this.el.logUnread.classList.remove('hidden');
    }
  },

  rebuildLog() {
    this.el.logList.innerHTML = Game.S.log.filter(e => !e.to || e.to === Game.me).slice(0, 150).map(e => this.logHTML(e)).join('');
    this.applyLogFilter();
  },

  // Новости живут в своей вкладке и в окне «Мировые новости» — общий журнал ими не засоряем
  matchesFilter(cat) { return this.logFilter === 'all' ? cat !== 'news' : (LOG_GROUPS[this.logFilter] || []).includes(cat); },

  applyLogFilter() {
    $$('.log-entry', this.el.logList).forEach(n => n.classList.toggle('filtered', !this.matchesFilter(n.dataset.cat)));
  },

  toggleLog() {
    this.logCollapsed = !this.logCollapsed;
    document.body.classList.toggle('log-collapsed', this.logCollapsed);
    this.el.logReopen.classList.toggle('hidden', !this.logCollapsed);
    if (!this.logCollapsed) { this.unread = 0; this.el.logUnread.classList.add('hidden'); }
    setTimeout(() => MapView.resize(), 260);
  },

  /* ---------------- ПОДСКАЗКИ ---------------- */
  initTooltips() {
    document.addEventListener('mouseover', e => {
      const t = e.target.closest('[data-tip],[data-tipk]');
      if (t === this.tipTarget) return;
      this.tipTarget = t;
      if (!t) {
        if (this.mapHoverId && e.target.closest('#map-root')) this.showTip(this.countryTip(this.mapHoverId));
        else this.hideTip();
        return;
      }
      if (t.dataset.tipk && !Game.S) return;
      this.showTip(t.dataset.tipk ? this.tipFns[t.dataset.tipk].call(this) : `<div class="tt-plain">${U.esc(t.dataset.tip)}</div>`);
    });
    document.addEventListener('mousemove', e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      // Мышь ушла с карты на панель — сбрасываем подсветку страны
      if (this.mapHoverId && !e.target.closest('#map-root')) {
        this.mapHoverId = null;
        MapView.setHovered(null);
        if (!this.tipTarget) this.hideTip();
      }
      if (this.el.tip.classList.contains('show')) this.positionTip();
    });
  },

  showTip(html) {
    const t = this.el.tip;
    t.innerHTML = html;
    t.classList.add('show');
    this.positionTip();
  },

  hideTip() { this.el.tip.classList.remove('show'); },

  positionTip() {
    const t = this.el.tip, pad = 14;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = this.mouse.x + 16, y = this.mouse.y + 18;
    if (x + w > window.innerWidth - pad) x = this.mouse.x - w - 12;
    if (y + h > window.innerHeight - pad) y = this.mouse.y - h - 12;
    t.style.transform = `translate(${Math.max(pad, x)}px, ${Math.max(pad, y)}px)`;
  },

  countryTip(id) {
    const r = Game.r(id);
    if (!r || !Game.S) return '';
    const H = Game.c(r.cid), N = Game.ownerNation(r);
    const own = r.ctrl === Game.me;
    const est = Game.estDivs(r);
    const war = Game.atWar(r);
    const status = r.radioactive ? 'радиоактивная пустошь' : war ? 'активный фронт' : N && N.cb[Game.me] === true ? 'повод для войны получен' : N && Game.justifying(N) ? 'идёт обоснование войны' : '';
    let rows = `<span>Страна</span><b>${U.esc(H ? H.name : r.cid)}</b>`;
    rows += `<span>Владелец</span><b>${U.esc(own ? 'мы' : Regions.ownerName(r.ctrl))}</b>`;
    rows += `<span>Заводы</span><b>${U.fmt(r.factories)}</b>`;
    if (!own && !(H && H.inert)) rows += `<span>Войска в регионе</span><b>${est.exact ? U.fmt(est.mid, 1) : '~' + est.lo + '–' + est.hi}</b>`;
    if (r.fort) rows += `<span>Укрепления</span><b>${r.fort}</b>`;
    if (war || r.control < 100) rows += `<span>Контроль</span><b>${Math.round(r.control)}%</b>`;
    return `<div class="tt-title"><i style="background:${this.countryColor(r)}"></i>${U.esc(r.name)}</div>
      <div class="tt-sub">${own ? (r.core === Game.me ? 'Наш исконный регион' : 'Наш присоединённый регион') : U.esc(this.ownerLabel(r))}${status ? ' · ' + status : ''}</div>
      <div class="tt-grid">${rows}</div><div class="tt-hint">ЛКМ — открыть панель региона</div>`;
  },

  tipFns: {
    pp() {
      const m = Game.mods, d = Game.diff, allies = Game.allies().length;
      return `<div class="tt-title">Политическая власть</div>
        <div class="tt-text">Главная валюта решений: обоснование войны, мобилизация, разведка, дипломатия.</div>
        <div class="tt-grid"><span>База</span><b>+${U.fmt(CFG.PP_BASE, 1)}</b><span>Фокусы и наука</span><b>+${U.fmt(m.pp, 1)}</b>
        <span>Союзники по блоку (${allies})</span><b>+${U.fmt(allies * 0.1, 1)}</b><span>Сложность</span><b>×${d.pp}</b>
        <span>Итого в день</span><b class="pos">${U.signed(Game.dailyPP(), 2)}</b></div>`;
    },
    fac() {
      const m = Game.mods;
      return `<div class="tt-title">Заводы</div>
        <div class="tt-text">Каждый завод даёт ${CFG.RP_PER_FACTORY} ОИ в день. Доля мировой промышленности ${U.pct(Game.industryShare(), 1)} — для победы нужно ${U.pct(CFG.VICTORY_SHARE)}.</div>
        <div class="tt-grid"><span>Наши заводы</span><b>${Game.playerFactories()}</b><span>Во всём мире</span><b>${Game.worldFactories()}</b>
        <span>Пассивный рост</span><b>${isFinite(m.factoryEvery) ? '+1 за ' + U.days(m.factoryEvery) : 'нет (нужна наука)'}</b></div>`;
    },
    mp() {
      return `<div class="tt-title">Призывники</div>
        <div class="tt-text">Нужны для формирования дивизий (${CFG.DIV.mp} тыс. на дивизию). Присоединённые земли дают половину призыва.</div>
        <div class="tt-grid"><span>В резерве</span><b>${U.fmtMP(this.P().mp)}</b><span>Прирост в день</span><b class="pos">${U.signed(Game.dailyMP(), 2)} тыс.</b></div>`;
    },
    div() {
      const P = this.P();
      const tr = P.training.reduce((s, t) => s + t.count, 0);
      return `<div class="tt-title">Дивизии</div>
        <div class="tt-text">Дивизии воюют в составе армий. Полоса — средняя организация армий: наступление её расходует, в обороне она восстанавливается (${U.fmt(Game.mods.orgRegen, 1)}% в день).</div>
        <div class="tt-grid"><span>В армиях</span><b>${U.fmt(P.armies.reduce((s, a) => s + a.divs, 0), 1)}</b><span>В резерве (столица)</span><b>${P.divs}</b><span>В обучении</span><b>${tr}</b>
        <span>Армий</span><b>${P.armies.length}</b><span>Атака дивизии</span><b>${U.fmt(CFG.DIV.attack * Game.mods.attack * (1 + Game.mods.attackBonus), 1)}</b></div>`;
    },
    rp() {
      return `<div class="tt-title">Очки исследований</div>
        <div class="tt-text">Тратятся на технологии. Растут от заводов, технологий, фокусов и идеологии власти.</div>
        <div class="tt-grid"><span>Накоплено</span><b>${U.fmt(this.P().rp, 0)}</b><span>Прирост в день</span><b class="pos">${U.signed(Game.dailyRP(), 2)}</b>
        <span>Бонус науки</span><b>+${U.pct(Game.mods.rp)}</b></div>`;
    },
    nuke() {
      const P = this.P(), m = Game.mods;
      return `<div class="tt-title">Ядерные боеголовки</div>
        <div class="tt-text">Стратегический удар превращает регион в радиоактивную пустошь навсегда. ${CFG.NUCLEAR_WINTER} пустошей — ядерная зима и конец игры для всех.</div>
        <div class="tt-grid"><span>В арсенале</span><b>${P.warheads}</b><span>Следующая через</span><b>${U.days(m.warheadDays - P.warheadTimer)}</b>
        <span>Пустошей в мире</span><b>${Game.wastelands()} / ${CFG.NUCLEAR_WINTER}</b></div>`;
    },
    tension() {
      const t = Game.S.tension;
      const row = (th, txt) => `<span class="${t >= th ? 'neg' : ''}">${th}%</span><b class="${t >= th ? 'neg' : ''}">${txt}</b>`;
      return `<div class="tt-title">Мировая напряжённость: ${U.fmt(t, 1)}%</div>
        <div class="tt-text">Растёт от агрессии, шпионских провалов и ядерного оружия. Медленно спадает в мирное время. Общая для всех держав.</div>
        <div class="tt-grid">${row(50, 'Оборонительная мобилизация блоков')}${row(75, 'DEFCON 2, блоки вступают в войны')}${row(80, 'Соседи могут напасть первыми')}${row(95, 'Риск ядерного удара США (если ими правит ИИ)')}</div>`;
    },
    leader() {
      const tag = Game.me, pol = Game.powerGov(tag), P = this.P();
      if (!pol) return '';
      const I = IDEOLOGIES[pol.ide], left = Game.electionIn(pol);
      const spirits = (P.spirits || []).map(x => `<span>${U.esc(x.name)}</span><b>${x.days != null ? U.days(x.days) : 'постоянно'}</b>`).join('');
      return `<div class="tt-title">${U.esc(Game.leaderOf(tag))}</div>
        <div class="tt-sub">${U.esc(Game.leaderTitle(tag))} · ${U.esc(I.gov)}</div>
        <div class="tt-text">Идеология «${I.name}»: ${I.fxText}.</div>
        <div class="tt-grid"><span>Поддержка власти</span><b>${U.fmt(pol.pop[pol.ide] || 0, 1)}%</b>
        <span>Выборы</span><b>${left == null ? 'не проводятся' : 'через ' + U.days(left)}</b>${spirits}</div>
        <div class="tt-hint">Кликните по своей столице, чтобы открыть внутреннюю политику</div>`;
    },
    uaw() {
      const S = Game.S, w = Math.round(S.uaw || 0);
      return `<div class="tt-title">Украина — Запад: ${w}%</div>
        <div class="tt-text">Насколько Запад доверяет Киеву. Шкала тянется к уровню, который задают правительство Украины (либералы и консерваторы ближе к Западу, «Оппозиционная платформа» — дальше), коррупция и членство в НАТО. Фокусы и решения сдвигают её.</div>
        <div class="tt-grid"><span>Если Россия нападёт</span><b>санкции и пакеты помощи раз в 30 дней</b><span>Сила помощи</span><b>${w < 25 ? 'поставок не будет' : U.pct(Game.westAidLevel(true) * (0.5 + w / 100))}</b><span>≥70% в мирное время</span><b>подготовка по стандартам НАТО</b></div>`;
    },
    ruua() {
      const S = Game.S;
      return `<div class="tt-title">Россия — Украина: ${Math.round(S.ruua || 0)}%</div>
        <div class="tt-text">Своя шкала напряжённости между двумя странами. Медленно растёт сама, её двигают события, фокусы и обоснование войны. На 100% наступает развязка: если Россией играет человек — Генштаб предложит начать операцию, если ИИ — он сам объявит войну Украине.</div>
        <div class="tt-grid"><span>75%</span><b>войска у границ</b><span>90%</span><b>на грани войны</b><span>100%</span><b>развязка</b></div>`;
    },
    net() {
      const room = Net.room;
      if (!room) return '<div class="tt-plain">Сетевая игра</div>';
      const rows = room.players.map(p => `<span>${U.esc(p.name)}${p.online ? '' : ' (не в сети)'}</span><b>${p.power ? POWERS[p.power].name : '—'}</b>`).join('');
      return `<div class="tt-title">Комната ${U.esc(room.code)}</div><div class="tt-grid">${rows}</div>`;
    }
  },

  /* ---------------- УВЕДОМЛЕНИЯ ---------------- */
  toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    this.el.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 2600 : 3200);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild.remove();
  },

  flash(strong) {
    const f = this.el.flash;
    f.classList.remove('go', 'go-strong');
    void f.offsetWidth;
    f.classList.add(strong ? 'go-strong' : 'go');
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 900);
  },

  /* ---------------- МОДАЛЬНЫЕ ОКНА ----------------
     В одиночной игре открытое окно ставит время на паузу. В сетевой — нет:
     время общее и не должно останавливаться из-за окна одного игрока. */
  pushPause() {
    if (Net.mp) return;
    if (this.pauseDepth++ === 0 && Game.S) {
      this.resumeAfter = !Game.S.paused;
      Game.S.paused = true;
      this.updateClock();
    }
  },
  popPause() {
    if (Net.mp) return;
    if (this.pauseDepth > 0 && --this.pauseDepth === 0 && Game.S) {
      if (this.resumeAfter && !Game.S.over) Game.S.paused = false;
      this.updateClock();
    }
  },

  openModal({ key, cls = '', html, dismissible = true, pause = true, onOpen, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal glass ${cls}" role="dialog" aria-modal="true">
      ${dismissible ? '<button class="icon-btn modal-x" data-ui="modal-close" data-tip="Закрыть (Esc)"><svg><use href="#i-close"/></svg></button>' : ''}${html}</div>`;
    this.el.modalRoot.appendChild(wrap);
    const m = { key, wrap, dismissible, pause, onClose };
    this.modals.push(m);
    if (pause) this.pushPause();
    wrap.addEventListener('mousedown', e => { if (e.target === wrap && dismissible) this.closeModal(m); });
    requestAnimationFrame(() => wrap.classList.add('show'));
    this.hideTip();
    this.tipTarget = null;
    if (onOpen) onOpen(wrap.firstElementChild, m);
    return m;
  },

  closeModal(m) {
    if (!m) m = this.modals[this.modals.length - 1];
    const i = this.modals.indexOf(m);
    if (i < 0) return;
    this.modals.splice(i, 1);
    m.wrap.classList.remove('show');
    setTimeout(() => m.wrap.remove(), 220);
    if (m.pause) this.popPause();
    if (m.onClose) m.onClose();
    this.hideTip();
    this.tipTarget = null;
    setTimeout(() => { this.nextEvent(); this.nextNews(); }, 150);
  },

  closeAll() {
    this.modals.slice().forEach(m => this.closeModal(m));
    this.pauseDepth = 0;
  },

  isOpen(key) { return this.modals.some(m => m.key === key); },
  modalEl(key) { const m = this.modals.find(x => x.key === key); return m ? m.wrap.firstElementChild : null; },

  /* ---------------- СОБЫТИЯ ---------------- */
  nextEvent() {
    if (this.isOpen('event') || !this.eventQueue.length || !this.started) return;
    const wait = this.fxBusyUntil - performance.now();
    if (wait > 0) { clearTimeout(this.evTimer); this.evTimer = setTimeout(() => this.nextEvent(), wait + 50); return; }
    // Не перекрываем вступление, итоги игры, сводки боя и ядерного удара — событие подождёт их закрытия
    if (this.modals.some(m => ['intro', 'gameover', 'battle', 'nuke', 'nukereport', 'newsflash'].includes(m.key))) return;
    const { iid, view } = this.eventQueue.shift();
    const cat = view.cat || 'info';
    const html = `<div class="ev">
      <div class="ev-art cat-${cat}"><div class="ev-art-grid"></div><svg><use href="#${view.art || 'i-flag'}"/></svg><span class="ev-stamp">${LOG_BADGES[cat] || 'Сводка'}</span></div>
      <div class="ev-body">
        <div class="ev-date">${U.fmtDate(Game.S.date)}</div>
        <h2 class="ev-title">${U.esc(view.title)}</h2>
        <p class="ev-text">${U.esc(view.text)}</p>
        <div class="ev-options">${view.options.map((o, i) => `<button class="ev-opt" data-i="${i}"><span class="ev-opt-label">${U.esc(o.label)}</span>${o.tip ? `<span class="ev-opt-tip">${U.esc(o.tip)}</span>` : ''}</button>`).join('')}</div>
      </div></div>`;
    Sound.play(cat === 'alert' || cat === 'nuke' ? 'alert' : 'event');
    this.openModal({
      key: 'event', cls: 'm-event', html, dismissible: false,
      onOpen: (el, m) => {
        m.iid = iid;
        el.querySelectorAll('.ev-opt').forEach(b => b.addEventListener('click', () => {
          if (m.answered) return;
          m.answered = true;
          Sound.play('click');
          Act.call('chooseEvent', iid, +b.dataset.i).then(res => { if (res && !res.ok) this.toast(res.msg, 'err'); this.renderAll(); });
          this.closeModal(m);
        }));
      }
    });
  },

  // Сервер решил событие сам (например, игрок слишком долго не отвечал)
  dropEvent(iid) {
    this.eventQueue = this.eventQueue.filter(e => e.iid !== iid);
    const m = this.modals.find(x => x.key === 'event' && x.iid === iid);
    if (m) this.closeModal(m);
  },

  /* ---------------- ОБЪЯВЛЕНИЕ ВОЙНЫ ---------------- */
  confirmDeclare(id) {
    const c = Game.c(id);
    const why = Game.canDeclare(c);
    if (why) return this.result(Game.fail(why));
    const Y = Game.powerOf(c);
    const F = FACTIONS[c.faction];
    const leader = !Y && F && F.leader && F.leader !== c.id ? Game.c(F.leader) : null;
    let warn = '';
    if (Y) {
      warn = `<li class="neg">За эту державу играет человек${Game.P(Y).player ? ' (' + U.esc(Game.P(Y).player) + ')' : ''}. Все её земли, граничащие с нами, станут фронтом — и для неё тоже.</li>`;
    } else if (leader && Game.isPower(leader.ctrl)) {
      warn = `<li class="neg">Лидер блока (${U.esc(POWERS[leader.ctrl].name)}) — живой игрок, он узнает о нападении на союзника.</li>`;
    } else if (leader && leader.ctrl === leader.id) {
      warn = `<li class="neg">${U.esc(leader.name)} — лидер блока «${F.name}» — пришлёт подкрепления и может вступить в войну (шанс ${U.pct(Game.S.tension >= 75 ? 1 : Math.min(1, (Game.S.tension + Game.declareTension(c)) / 150))}).</li>`;
    }
    const html = `<div class="mh"><svg><use href="#i-swords"/></svg><div><div class="mh-k">Объявление войны</div><h2>${U.esc(Y ? POWERS[Y].name : c.name)}</h2></div></div>
      <ul class="consequences">
        <li>${Y ? 'Начнётся война между державами.' : 'Территория станет активным фронтом. Противник проведёт мобилизацию (+15% дивизий).'}</li>
        <li class="neg">Мировая напряжённость +${U.fmt(Game.declareTension(c), 0)}%.</li>
        ${warn}
      </ul>
      <div class="m-actions"><button class="btn" data-cancel>Отмена</button><button class="btn btn-red" data-go><svg><use href="#i-swords"/></svg>Объявить войну</button></div>`;
    this.openModal({
      key: 'declare', cls: 'm-small', html,
      onOpen: (el, m) => {
        el.querySelector('[data-cancel]').onclick = () => this.closeModal(m);
        el.querySelector('[data-go]').onclick = () => { this.closeModal(m); Act.call('declareWar', id).then(res => this.result(res)); };
      }
    });
  },

  /* ---------------- ШАБЛОНЫ ДИВИЗИЙ ---------------- */
  deployTplId() {
    if (!this.deployTpl || !Game.tpl(this.deployTpl)) this.deployTpl = Game.defaultTpl();
    return this.deployTpl;
  },

  openTemplates() {
    if (!this.started) return;
    const first = Game.templates()[0];
    this.tplEdit = first ? { id: first.id, name: first.name, bats: Object.assign({}, first.bats) } : { id: null, name: 'Новая дивизия', bats: { inf: 6 } };
    this.openModal({ key: 'templates', cls: 'm-templates', html: '<div class="tpl-root"></div>', onOpen: () => this.renderTemplates() });
  },

  statBar(label, v, max, fmt) {
    return `<div class="tpl-stat"><span>${label}</span><div class="meter"><i style="width:${U.clamp(v / max * 100, 2, 100)}%"></i></div><b>${fmt}</b></div>`;
  },

  renderTemplates() {
    const el = this.modalEl('templates');
    if (!el) return;
    const ed = this.tplEdit;
    const st = Game.tplStats(ed);
    const total = Object.values(ed.bats).reduce((s, n) => s + n, 0);
    const used = ed.id && Game.tplUsed(ed.id);
    const list = Game.templates().map(t => {
      const ts = Game.tplStats(t);
      return `<button class="tpl-item ${t.id === ed.id ? 'active' : ''}" data-tpl="${t.id}">
        <b>${U.esc(t.name)}</b>
        <span class="tpl-bats">${Object.entries(t.bats).map(([k, n]) => `<i class="bat bat-${k}">${BATTALIONS[k].short}</i>×${n}`).join(' ')}</span>
        <em>Атака ${U.fmt(ts.att, 1)} · оборона ${U.fmt(ts.def, 1)} · ${U.fmt(ts.pp, 1)} ПВ</em>
      </button>`;
    }).join('');
    const rows = Object.entries(BATTALIONS).map(([k, b]) => `<div class="bat-row">
        <i class="bat bat-${k}">${b.short}</i>
        <div class="bat-info"><b>${b.name}</b><span>атака ${b.att} · оборона ${b.def} · организация ${b.org}${b.armor ? ' · прорыв, усиливается танковой наукой' : ''}${b.antiArmor ? ' · гасит танки в обороне' : ''}${b.speed > 1 ? ' · быстрый марш' : ''}</span></div>
        <button class="icon-btn bat-btn" data-bat="${k}" data-d="-1">−</button>
        <b class="bat-n">${ed.bats[k] || 0}</b>
        <button class="icon-btn bat-btn" data-bat="${k}" data-d="1">+</button>
      </div>`).join('');
    el.querySelector('.tpl-root').innerHTML = `
      <div class="mh"><svg><use href="#i-div"/></svg><div><div class="mh-k">Генеральный штаб</div><h2>Шаблоны дивизий</h2></div></div>
      <div class="tpl-layout">
        <div class="tpl-list">${list}
          <button class="btn btn-xs tpl-new" data-new ${Game.templates().length >= TEMPLATE_MAX ? 'disabled' : ''}>+ Новый шаблон</button></div>
        <div class="tpl-editor">
          <label class="tpl-name">Название<input id="tpl-name" maxlength="32" value="${U.esc(ed.name)}"></label>
          <div class="tpl-count">Батальонов: <b class="${total > TEMPLATE_MAX_BATS ? 'neg' : ''}">${total} / ${TEMPLATE_MAX_BATS}</b></div>
          <div class="bat-rows">${rows}</div>
          <div class="tpl-stats">
            ${this.statBar('Атака', st.att, 25, U.fmt(st.att, 1))}
            ${this.statBar('Оборона', st.def, 16, U.fmt(st.def, 1))}
            ${this.statBar('Организация', st.org, 60, U.fmt(st.org, 0))}
            ${this.statBar('Скорость марша', st.speed, 1.6, st.speed > 1 ? 'быстрая' : 'обычная')}
            <div class="tpl-cost"><span><svg><use href="#i-pp"/></svg>${U.fmt(st.pp, 1)} ПВ</span><span>${U.fmtMP(st.mp)} призывников</span><span>${U.days(Math.round(st.days * (1 - Game.mods.train)))} обучения</span></div>
          </div>
          ${used ? '<div class="cp-note warn">Дивизии этого шаблона уже служат. Изменение стоит 10 ПВ, их армии потеряют часть организации на переоснащение.</div>' : ''}
          <div class="m-actions">
            ${ed.id ? '<button class="btn" data-del>Удалить</button>' : ''}
            <button class="btn" data-use ${ed.id ? '' : 'disabled'}>Набирать по этому шаблону</button>
            <button class="btn btn-gold" data-save>${ed.id ? 'Сохранить изменения' : 'Создать шаблон'}</button>
          </div>
        </div>
      </div>`;
    const root = el.querySelector('.tpl-root');
    root.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => {
      const t = Game.tpl(b.dataset.tpl);
      this.tplEdit = { id: t.id, name: t.name, bats: Object.assign({}, t.bats) };
      Sound.play('click');
      this.renderTemplates();
    });
    root.querySelector('[data-new]').onclick = () => { this.tplEdit = { id: null, name: 'Новая дивизия', bats: { inf: 6, art: 1 } }; this.renderTemplates(); };
    root.querySelector('#tpl-name').oninput = e => { ed.name = e.target.value; };
    root.querySelectorAll('.bat-btn').forEach(b => b.onclick = () => {
      const k = b.dataset.bat, d = +b.dataset.d;
      const cur = ed.bats[k] || 0, sum = Object.values(ed.bats).reduce((s, n) => s + n, 0);
      if (d > 0 && sum >= TEMPLATE_MAX_BATS) { this.toast(`Не больше ${TEMPLATE_MAX_BATS} батальонов`, 'err'); return; }
      const n = Math.max(0, cur + d);
      if (n) ed.bats[k] = n; else delete ed.bats[k];
      Sound.play('click');
      this.renderTemplates();
    });
    root.querySelector('[data-save]').onclick = () => {
      const str = Object.entries(ed.bats).map(([k, n]) => k + ':' + n).join(',');
      Act.call('saveTemplate', ed.id, ed.name, str).then(res => {
        this.result(res);
        if (res && res.ok && res.tpl) { const t = Game.tpl(res.tpl); if (t) this.tplEdit = { id: t.id, name: t.name, bats: Object.assign({}, t.bats) }; }
        setTimeout(() => this.renderTemplates(), 300);
      });
    };
    const del = root.querySelector('[data-del]');
    if (del) del.onclick = () => Act.call('deleteTemplate', ed.id).then(res => {
      this.result(res);
      if (res && res.ok) { const f = Game.templates()[0]; this.tplEdit = { id: f.id, name: f.name, bats: Object.assign({}, f.bats) }; }
      setTimeout(() => this.renderTemplates(), 300);
    });
    root.querySelector('[data-use]').onclick = () => {
      if (!ed.id) return;
      this.deployTpl = ed.id;
      this.sig.dock = null;
      this.renderDock();
      this.toast(`Новые дивизии: «${Game.tpl(ed.id).name}»`, 'ok');
    };
  },

  /* ---------------- ПАНЕЛЬ АРМИИ ---------------- */
  armyTargetsSig(a) {
    return Regions.nb(a.loc).filter(n => Game.atWar(Game.r(n))).map(n => n + Math.round(Game.r(n).control));
  },

  orderText(a) {
    if (a.order.type === 'attack') return (a.order.air ? 'Десант: ' : 'Наступление: ') + (Game.r(a.order.target) || { name: '?' }).name;
    if (a.order.type === 'move') {
      const to = Game.r(a.order.to || a.order.path[a.order.path.length - 1]) || { name: '?' };
      return `Марш: ${to.name} (${U.days(a.order.left + a.order.path.slice(1).length * CFG.ARMY.stepDays)})`;
    }
    return 'Оборона позиций';
  },

  // Одна строка прогноза: шанс выиграть день, дни до захвата и запас организации
  forecastHTML(e) {
    const ok = e.daysToTake <= e.orgDays;
    const days = isFinite(e.daysToTake) ? '~' + U.days(e.daysToTake) : 'не взять';
    return `<span class="fc-odds ${e.pWin >= 0.6 ? 'good' : e.pWin >= 0.35 ? 'mid' : 'bad'}">${U.pct(e.pWin)} побед в день</span> · ${days} · ${ok ? '<span class="pos">организации хватит</span>' : `<span class="neg">организации на ${U.days(e.orgDays)}</span>`}`;
  },

  armyHTML(a) {
    const d = this.D(), P = this.P(), loc = Game.r(a.loc) || { name: '?' };
    const targets = Regions.nb(a.loc).map(n => Game.r(n)).filter(c => c && Game.atWar(c));
    let html = `<div class="cp-head" style="--fc:${d.color}">
      <div class="cp-flag army-flag"><svg viewBox="0 0 16 11"><rect x=".5" y=".5" width="15" height="10"/><path d="M.5 .5l15 10M15.5 .5l-15 10"/></svg></div>
      <div class="cp-title"><div class="cp-name">${U.esc(a.name)}</div><div class="cp-badges">${this.badge('Командующий: ' + a.general, 'fac')}${this.badge(this.orderText(a), a.order.type === 'attack' ? 'war' : 'sov')}</div></div>
      <button class="icon-btn" data-ui="close-panel" data-tip="Снять выбор (Esc)"><svg><use href="#i-close"/></svg></button>
    </div><div class="cp-body">
      <div class="cp-stats">
        ${this.stat('Дивизии', `${U.fmt(a.divs, 1)} / ${CFG.ARMY.max}`)}
        ${this.stat('Место', U.esc(loc.name))}
        ${this.stat('Организация', Math.round(a.org) + '%', this.meter(a.org, a.org < 35 ? 'meter-orange' : 'meter-green'), 'Наступление расходует организацию; ниже ' + CFG.ARMY.haltOrg + '% армия останавливается. В обороне восстанавливается.')}
        ${this.stat('Сила атаки', U.fmt(Game.mixStats(a.mix).att * (1 + Game.mods.attackBonus), 0), '', 'Сумма атаки батальонов всех дивизий (с учётом техники и доктрины)')}
        ${this.stat('Оборона', U.fmt(Game.mixStats(a.mix).def, 0))}
        ${this.stat('Скорость марша', U.days(Game.stepDays(a.loc, a.loc, a)) + ' на переход', '', 'Скорость задаёт самый медленный батальон: пехота — 3 дня, техника — 2 дня')}
      </div>
      <div class="army-mix">${Object.entries(a.mix).filter(([, n]) => n >= 0.5).map(([id, n]) => { const t = Game.tpl(id); return `<span class="mix-chip">${U.esc(t ? t.name : '?')} <b>×${Math.round(n)}</b></span>`; }).join('')}</div>
      <div class="cp-note army-hint">Кликните по <b>своей</b> земле — армия пойдёт туда. По <b>соседней вражеской</b> — начнёт наступление. Правый клик тоже работает.</div>`;
    if (a.battle && a.order.type === 'attack') {
      const c = Game.r(a.battle.target), last = a.battle.last;
      html += `<div class="cp-sec"><div class="cp-sec-title">Идёт сражение</div>
        <div class="battle-box">
          <div class="fc-row"><span>Направление</span><b>${U.esc(c.name)}</b></div>
          <div class="fc-row"><span>День боёв</span><b>${a.battle.days}</b></div>
          <div class="fc-row"><span>Контроль противника</span><b>${Math.round(c.control)}%</b></div>
          ${this.meter(c.control, 'meter-orange')}
          <div class="fc-row"><span>Потери: наши / врага</span><b>${U.fmt(a.battle.attLost, 1)} / ${U.fmt(a.battle.defLost, 1)} див.</b></div>
          ${last ? `<div class="fc-row"><span>Сегодня: соотношение сил</span><b class="${last.ratio >= 1 ? 'pos' : 'neg'}">${U.fmt(last.ratio, 2)}</b></div>` : ''}
        </div>
        ${this.actBtn({ act: 'army-hold', label: 'Остановить наступление', icon: 'i-shield', data: `data-army="${a.id}"`, sub: 'Армия перейдёт к обороне и восстановит организацию' })}
      </div>`;
    }
    if (targets.length) {
      html += `<div class="cp-sec"><div class="cp-sec-title">Цели для наступления</div>`;
      for (const c of targets) {
        if (a.order.type === 'attack' && a.order.target === c.id) continue;
        const e = Combat.estimateArmies(c, [a]);
        html += this.actBtn({ act: 'army-attack', id: c.id, data: `data-army="${a.id}"`, label: 'Наступать: ' + c.name, icon: 'i-swords', cls: 'act-primary',
          why: Game.canOrderAttack(a, c), sub: this.forecastHTML(e) });
      }
      html += '</div>';
    } else {
      html += `<div class="cp-note">Рядом нет врага. Отведите армию к линии фронта: кликните по своей приграничной земле.</div>`;
    }
    if (Game.isAirborne(a)) {
      const air = Game.regionList().filter(c => c.ctrl !== Game.me && Game.atWar(c) && !Regions.adjacent(a.loc, c.id))
        .map(c => ({ c, d: Game.airDistance(c) })).filter(x => x.d <= CFG.AIRBORNE.range).sort((x, y) => x.d - y.d).slice(0, 8);
      html += `<div class="cp-sec"><div class="cp-sec-title">Воздушный десант</div>
        <div class="cp-note">Высадка на любую вражескую землю в радиусе ${CFG.AIRBORNE.range} км — даже без общей границы. Первые дни удар сильнее (внезапность), но организация тает быстрее, а не взяв цель, десант потеряет ${Math.round(CFG.AIRBORNE.cutOff * 100)}% дивизий.</div>`;
      if (!air.length) html += '<div class="cp-note warn">Нет вражеских земель в радиусе десанта.</div>';
      for (const { c, d } of air) {
        const e = Combat.estimateArmies(c, [a], true);
        html += this.actBtn({ act: 'army-air', id: c.id, data: `data-army="${a.id}"`, label: 'Десант: ' + c.name, icon: 'i-flag', cls: 'act-primary',
          why: Game.canAirdrop(a, c), sub: `${Math.round(d)} км · ${this.forecastHTML(e)}`, cost: this.costTag(CFG.AIRBORNE.pp) });
      }
      html += '</div>';
    }
    const n5 = Math.min(5, P.divs, Math.floor(CFG.ARMY.max - a.divs));
    html += `<div class="cp-sec"><div class="cp-sec-title">Управление</div>
      ${this.actBtn({ act: 'army-reinforce', data: `data-army="${a.id}" data-n="5"`, label: 'Пополнить из резерва', icon: 'i-plus',
        why: n5 < 1 ? (P.divs < 1 ? 'Резерв пуст — сформируйте дивизии' : 'Армия укомплектована') : null, sub: `+${Math.max(n5, 0)} див. · в резерве ${P.divs}` })}
      ${a.order.type !== 'hold' && a.order.type !== 'attack' ? this.actBtn({ act: 'army-hold', data: `data-army="${a.id}"`, label: 'Остановиться', icon: 'i-shield' }) : ''}
      ${this.actBtn({ act: 'army-disband', data: `data-army="${a.id}"`, label: 'Расформировать', icon: 'i-close', why: a.order.type === 'attack' ? 'Сначала остановите наступление' : null, sub: 'Дивизии вернутся в резерв' })}
    </div></div>`;
    return html;
  },

  // В панели вражеской страны: наши армии рядом и прогноз наступления
  attackOptionsHTML(c) {
    if (!Game.atWar(c)) return '<div class="cp-note">Нет состояния войны. Обоснуйте и объявите войну, затем подведите армию к границе.</div>';
    const near = Game.armies().filter(a => Regions.adjacent(a.loc, c.id));
    const paras = Game.armies().filter(a => Game.isAirborne(a) && !near.includes(a) && Game.airDistance(c) <= CFG.AIRBORNE.range);
    let html = '';
    for (const a of paras) {
      const e = Combat.estimateArmies(c, [a], true);
      html += this.actBtn({ act: 'army-air', id: c.id, data: `data-army="${a.id}"`, label: `Десант: ${a.name} (${U.fmt(a.divs, 0)} див.)`, icon: 'i-flag', cls: 'act-primary',
        why: Game.canAirdrop(a, c), sub: this.forecastHTML(e), cost: this.costTag(CFG.AIRBORNE.pp) });
    }
    if (!near.length) return html + '<div class="cp-note warn">Рядом нет наших армий. Выберите армию (внизу или фишкой на карте) и кликните по своей земле у этой границы.</div>';
    for (const a of near) {
      if (a.order.type === 'attack' && a.order.target === c.id) {
        html += this.actBtn({ act: 'army-select', data: `data-army="${a.id}"`, label: a.name + ': уже наступает', icon: 'i-swords', sub: `День ${a.battle ? a.battle.days : 0} · организация ${Math.round(a.org)}%` });
        continue;
      }
      const e = Combat.estimateArmies(c, [a]);
      html += this.actBtn({ act: 'army-attack', id: c.id, data: `data-army="${a.id}"`, label: `${a.name} (${U.fmt(a.divs, 0)} див.)`, icon: 'i-swords', cls: 'act-primary',
        why: Game.canOrderAttack(a, c), sub: this.forecastHTML(e) });
    }
    return html;
  },

  modsList(lines) {
    return lines.map(l => `<li><span>${U.esc(l.label)}</span><b class="${l.mult != null ? (l.mult >= 1 ? 'pos' : 'neg') : ''}">${l.mult != null ? '×' + U.fmt(l.mult, 2) : U.fmt(l.value, 0)}</b></li>`).join('');
  },

  /* ---------------- СВОДКА БОЯ ---------------- */
  die(v) {
    const pos = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[v];
    let s = '<div class="die">';
    for (let i = 1; i <= 9; i++) s += `<i class="${pos.includes(i) ? 'on' : ''}"></i>`;
    return s + '</div>';
  },

  onBattle(r) {
    MapView.fxBattle(r.targetId, r.ratio >= 1, r.by);
    Sound.play('battle');
    setTimeout(() => this.showBattleReport(r), 650);
  },

  showBattleReport(r) {
    const A = r.att, D = r.def;
    const share = A.power / (A.power + D.power) * 100;
    const enemyColor = r.targetColor || (FACTIONS[r.targetFaction] || FACTIONS.NEU).color;
    const tone = r.capitulated ? 'cap' : r.outcome.tone;
    const headline = r.capitulated
      ? (r.liberation ? 'Территория освобождена' : r.captured ? 'Территория захвачена' : 'Капитуляция противника')
      : r.outcome.title;
    let summary = r.outcome.text;
    if (r.capitulated) {
      if (r.liberation) summary += ` Наша земля «${r.targetName}» возвращена под наш контроль.`;
      else if (r.captured) summary += ` Земля «${r.targetName}» отбита у вражеской державы, заводов получено: ${r.annexedFactories}.`;
      else summary += ` ${r.targetName} капитулирует. Территория присоединена вместе с ${r.annexedFactories} ${U.plural(r.annexedFactories, 'заводом', 'заводами', 'заводами')}.`;
    } else if (r.ratio >= 1) {
      summary += ` Контроль противника упал до ${Math.round(r.controlAfter)}%. Ещё несколько ударов — и фронт рухнет.`;
    } else {
      summary += r.result === 'halted' ? ' Армия выдохлась: организация упала до предела. Дайте ей восстановиться в обороне, пополните из резерва или проведите саботаж обороны.' : '';
    }
    const ctrlAfter = Math.round(r.controlAfter);
    const myName = POWERS[r.by].name;
    const html = `<div class="br">
      <div class="br-top"><div><div class="mh-k">Итоги наступления · ${U.days(r.days || 1)} боёв · ${U.fmtDate(r.date)}</div><h2>${U.esc(r.op)}</h2><div class="br-front">Фронт: ${U.esc(r.targetName)}${r.defender ? ' · противник: ' + U.esc(POWERS[r.defender].name) : ''}</div></div>
        <div class="br-outcome tone-${tone}">${U.esc(headline)}</div></div>
      <div class="br-sides">
        <div class="br-side sov"><div class="br-side-head"><i style="background:${POWERS[r.by].color}"></i>${U.esc(myName)} · ${A.divs} див.</div>
          <div class="br-power">${U.fmt(A.power, 0)}</div><div class="br-power-l">сила атаки в последний день</div>
          <div class="br-dice">${this.die(A.dice[0])}${this.die(A.dice[1])}<span>2d6 = ${A.dice[0] + A.dice[1]} → ×${U.fmt(A.roll, 2)}</span></div>
          <ul class="mods">${this.modsList(A.lines)}</ul></div>
        <div class="br-vs"><div class="br-ratio">${U.fmt(r.ratio, 2)}</div><div class="br-ratio-l">среднее соотношение сил</div></div>
        <div class="br-side enemy"><div class="br-side-head"><i style="background:${enemyColor}"></i>${U.esc(r.targetName)} · ${U.fmt(D.divs, 1)} див.</div>
          <div class="br-power">${U.fmt(D.power, 0)}</div><div class="br-power-l">сила обороны в последний день</div>
          <div class="br-dice">${this.die(D.dice[0])}${this.die(D.dice[1])}<span>2d6 = ${D.dice[0] + D.dice[1]} → ×${U.fmt(D.roll, 2)}</span></div>
          <ul class="mods">${this.modsList(D.lines)}</ul></div>
      </div>
      <div class="br-balance"><i style="width:${share}%"></i><span class="br-mid"></span></div>
      <div class="br-tiles">
        <div class="tile neg"><span>Наши потери</span><b>${r.playerLost} див.</b><em>${U.fmt(r.playerMPLost, 0)} тыс. чел.</em></div>
        <div class="tile pos"><span>Потери противника</span><b>${U.fmt(r.enemyLost, 1)} див.</b><em>осталось ${U.fmt(r.enemyAfter, 1)}</em></div>
        <div class="tile gold"><span>Трофеи</span><b>+${r.capitulated ? r.annexedFactories + r.loot : r.loot} ${U.plural(r.capitulated ? r.annexedFactories + r.loot : r.loot, 'завод', 'завода', 'заводов')}</b><em>${r.capitulated ? 'вся промышленность региона' : 'вывезено в тыл'}</em></div>
        <div class="tile"><span>Контроль противника</span><b>${Math.round(r.controlBefore)}% → ${ctrlAfter}%</b><em>стойкость ×${U.fmt(r.resilience, 1)}</em>${this.meter(ctrlAfter, 'meter-orange')}</div>
        <div class="tile"><span>Организация армии</span><b>−${r.orgCost}%</b><em>осталось ${Math.round(r.orgLeft)}%</em></div>
        <div class="tile neg"><span>Напряжённость</span><b>+${U.fmt(r.tension, 1)}%</b><em>${r.ppGain ? '+' + r.ppGain + ' ПВ за победу' : 'без пропагандистского эффекта'}</em></div>
      </div>
      <div class="br-summary">${U.esc(summary)}</div>
      <div class="m-actions">

        <button class="btn btn-gold" data-ok>Продолжить</button>
      </div></div>`;
    if (r.capitulated) Sound.play('victory');
    this.openModal({
      key: 'battle', cls: 'm-battle', html,
      onOpen: (el, m) => {
        el.querySelector('[data-ok]').onclick = () => this.closeModal(m);

      }
    });
  },

  onEnemyAttack(r) {
    if (r.power !== Game.me) return;
    if (r.srcId) MapView.fxEnemyAttack(r.srcId, r.targetId, r.ratio >= 1);
    const c = Game.r(r.targetId);
    if (r.ratio >= 1 && r.controlDrop >= 20 && c) this.toast(`Противник прорывается: ${c.name} (контроль ${Math.round(r.control)}%)`, 'warn');
  },

  /* ---------------- ЯДЕРНЫЙ УДАР ---------------- */
  openNukePlanner(id) {
    const c = Game.r(id);
    const why = Game.canNuke(c);
    if (why) return this.result(Game.fail(why));
    const m = Game.mods, P = this.P();
    const usa = Game.c('USA');
    const Y = Game.powerOf(c);
    const N = Game.ownerNation(c) || {};
    const risk = usa && usa.ctrl === 'USA' && !usa.radioactive && c.cid !== 'USA' && (N.faction === 'WEST' || usa.wars[Game.me]);
    const html = `<div class="nk-head"><svg class="nk-tre"><use href="#i-nuke"/></svg><div><div class="mh-k">Стратегический ядерный удар</div><h2>${U.esc(c.name)}</h2></div></div>
      <ul class="consequences">
        <li class="neg">Все заводы цели уничтожены навсегда: ${c.factories} → 0.</li>
        <li class="neg">${Y ? 'Войска противника в регионе' : 'Гарнизон региона'}: −${m.thermo ? 100 : 85}%${m.thermo ? ', соседи теряют 25%' : ''}.</li>
        <li class="neg">Регион навсегда станет радиоактивной пустошью.</li>
        <li class="neg">Мировая напряжённость +${N.faction === 'NEU' ? 35 : CFG.NUKE_TENSION}%.${!Game.atWar(c) ? ' Удар равносилен объявлению войны.' : ''}</li>
        ${Y ? `<li class="neg">${U.esc(POWERS[Y].name)} — держава живого игрока. Если у неё есть ракеты, она может ответить тем же.</li>` : ''}
        ${risk ? '<li class="neg">Высокий риск (60%) ответного ядерного удара США по нашей территории.</li>' : ''}
        <li class="${Game.wastelands() + 1 >= CFG.NUCLEAR_WINTER ? 'neg' : ''}">Пустошей в мире: ${Game.wastelands()} → ${Game.wastelands() + 1} из ${CFG.NUCLEAR_WINTER}. При ${CFG.NUCLEAR_WINTER} наступит ядерная зима — конец игры для всех.</li>
      </ul>
      <div class="nk-arsenal">Боеголовок в арсенале: <b>${P.warheads}</b></div>
      <div class="m-actions"><button class="btn" data-cancel>Отменить</button>
        <button class="btn btn-nuke" data-hold><span class="hold-fill"></span><span class="hold-label"><svg><use href="#i-nuke"/></svg>Удерживайте для пуска</span></button></div>`;
    this.openModal({
      key: 'nuke', cls: 'm-nuke', html,
      onOpen: (el, mm) => {
        el.querySelector('[data-cancel]').onclick = () => this.closeModal(mm);
        const btn = el.querySelector('[data-hold]');
        let timer = null;
        const start = e => {
          e.preventDefault();
          btn.classList.add('holding');
          Sound.play('click');
          timer = setTimeout(() => {
            this.closeModal(mm);
            Act.call('nuke', id).then(res => { if (!res.ok) this.result(res); });
          }, 1300);
        };
        const stop = () => { btn.classList.remove('holding'); clearTimeout(timer); };
        btn.addEventListener('mousedown', start);
        btn.addEventListener('touchstart', start, { passive: false });
        ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => btn.addEventListener(ev, stop));
        btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') start(e); });
        btn.addEventListener('keyup', stop);
      }
    });
  },

  onNuke(r) {
    const mine = r.by === Game.me;
    this.fxBusyUntil = performance.now() + (mine ? 4600 : 3600);
    MapView.fxNuke(r.targetId, POWERS[r.by].capitalPos);
    Sound.play('launch');
    setTimeout(() => { this.flash(mine || (Game.r(r.targetId) || {}).ctrl === Game.me); Sound.play('nuke'); }, 1700);
    if (mine) setTimeout(() => this.showNukeReport(r), 4200);
    else this.toast(`ЯДЕРНЫЙ УДАР: ${POWERS[r.by].name} → ${r.name}`, 'warn');
  },

  onEnemyNuke(r) {
    this.fxBusyUntil = performance.now() + 3600;
    const from = Regions.center(Regions.capitalOf[r.from] || r.from) || { lat: 40, lng: -100 };
    MapView.fxNuke(r.target, from);
    Sound.play('launch');
    setTimeout(() => { this.flash(r.power === Game.me); Sound.play('nuke'); }, 1700);
  },

  showNukeReport(r) {
    const html = `<div class="nk-head"><svg class="nk-tre"><use href="#i-nuke"/></svg><div><div class="mh-k">Доклад ракетных войск · ${U.fmtDate(Game.S.date)}</div><h2>${U.esc(r.name)}: цель поражена</h2></div></div>
      <div class="br-tiles">
        <div class="tile neg"><span>Заводы</span><b>${r.before.factories} → 0</b><em>уничтожены навсегда</em></div>
        <div class="tile pos"><span>Войска противника</span><b>${U.fmt(r.before.divs, 1)} → ${U.fmt(r.after.divs, 1)}</b><em>${r.thermo ? 'термоядерный удар' : 'атомный удар'}</em></div>
        <div class="tile"><span>Контроль противника</span><b>${Math.round(r.before.control)}% → ${Math.round(r.after.control)}%</b></div>
        <div class="tile neg"><span>Напряжённость</span><b>+${r.tension}%</b><em>сейчас ${U.fmt(Game.S.tension, 0)}%</em></div>
        <div class="tile ${r.wastelands >= CFG.NUCLEAR_WINTER - 2 ? 'neg' : ''}"><span>Пустоши в мире</span><b>${r.wastelands} / ${CFG.NUCLEAR_WINTER}</b><em>порог ядерной зимы</em></div>
        <div class="tile gold"><span>Итог</span><b>${r.capitulated ? 'Территория занята' : 'Фронт держится'}</b><em>${r.capitulated ? 'регион присоединён' : 'требуется наступление'}</em></div>
      </div>
      <div class="br-summary">${r.retaliation ? 'Радары фиксируют подъём стратегической авиации США. Ответный удар ожидается в ближайшие дни.' : 'Мир в ужасе следит за грибом над горизонтом. Новые союзники вряд ли появятся скоро.'}${r.reinforced >= 1 ? ` Союзники цели уже перебрасывают подкрепления: +${U.fmt(r.reinforced, 1)} див.` : ''}</div>
      <div class="m-actions"><button class="btn btn-gold" data-ok>Принять доклад</button></div>`;
    this.openModal({ key: 'nukereport', cls: 'm-nuke', html, onOpen: (el, m) => { el.querySelector('[data-ok]').onclick = () => this.closeModal(m); } });
  },

  /* ---------------- НАУКА И ФОКУСЫ ---------------- */
  openResearch(tab) {
    if (!this.started) return;
    this.researchTab = tab;
    if (this.isOpen('research')) { this.sig.research = null; this.renderResearch(); return; }
    this.openModal({
      key: 'research', cls: 'm-research', html: '<div class="rs"></div>',
      onOpen: () => { this.sig.research = null; this.renderResearch(); }
    });
  },

  renderResearch() {
    const el = this.modalEl('research');
    if (!el) return;
    const P = this.P();
    const sig = JSON.stringify([this.researchTab, P.techs, P.research.map(r => r.id), P.focuses, P.focus && P.focus.id,
      TECHS.map(t => P.rp >= Game.techCost(t).rp), Game.mods.nucCost]);
    if (sig === this.sig.research) return;
    this.sig.research = sig;
    const root = el.querySelector('.rs');
    const tabs = `<div class="rs-tabs">
      <button class="rs-tab ${this.researchTab === 'research' ? 'active' : ''}" data-tab="research"><svg><use href="#i-book"/></svg>Исследования</button>
      <button class="rs-tab ${this.researchTab === 'focus' ? 'active' : ''}" data-tab="focus"><svg><use href="#i-tree"/></svg>Национальные фокусы</button></div>`;
    root.innerHTML = tabs + (this.researchTab === 'research' ? this.techHTML() : this.focusHTML());
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { Sound.play('click'); this.researchTab = b.dataset.tab; this.sig.research = null; this.renderResearch(); });
    if (this.researchTab === 'focus') this.drawFocusLines(root);
    this.updateLive();
  },

  techHTML() {
    const P = this.P();
    const slots = [0, 1].map(i => {
      const r = P.research[i];
      if (!r) return `<div class="slot empty"><span>Отдел ${i + 1}</span><b>Свободен — выберите технологию</b></div>`;
      const t = TECH_BY_ID[r.id];
      return `<div class="slot"><span>Отдел ${i + 1}</span><b>${U.esc(Game.techName(t))}</b>
        <div class="meter meter-cyan"><i data-live="prog" data-k="research" data-id="${r.id}" style="width:${(1 - r.daysLeft / r.total) * 100}%"></i></div>
        <em data-live="days" data-k="research" data-id="${r.id}">${U.days(r.daysLeft)}</em></div>`;
    }).join('');
    let html = `<div class="rs-head"><div class="rs-rp"><svg><use href="#i-rp"/></svg><b>${U.fmt(Math.floor(P.rp))}</b><span>ОИ · ${U.signed(Game.dailyRP(), 1)} в день</span></div><div class="rs-slots">${slots}</div></div>`;
    html += '<div class="rs-branches">';
    for (const br of TECH_BRANCHES) {
      html += `<div class="rs-col br-${br.id}"><div class="rs-col-head"><svg><use href="#${br.icon}"/></svg><div><b>${U.esc(Game.branchName(br))}</b><span>${br.desc}</span></div></div>`;
      for (const t of TECHS.filter(x => x.branch === br.id)) {
        const st = Game.techState(t), cost = Game.techCost(t), why = Game.canResearch(t);
        const r = P.research.find(x => x.id === t.id);
        html += `<div class="tech st-${st}">
          <div class="tech-tier">${ROMAN[t.tier]}</div>
          <div class="tech-main"><div class="tech-name">${U.esc(Game.techName(t))}</div><div class="tech-desc">${U.esc(t.desc)}</div>
          ${st === 'active' ? `<div class="meter meter-cyan"><i data-live="prog" data-k="research" data-id="${t.id}" style="width:${(1 - r.daysLeft / r.total) * 100}%"></i></div>` : ''}
          <div class="tech-foot"><span class="tech-cost"><svg><use href="#i-rp"/></svg>${cost.rp}</span><span class="tech-days">${U.days(cost.days)}</span>
          ${st === 'done' ? '<span class="tech-done">Изучено</span>' : st === 'active' ? '<span class="tech-act">Исследуется</span>' :
            `<button class="btn btn-xs ${why ? 'is-disabled' : 'btn-cyan'}" data-act="research" data-id="${t.id}" aria-disabled="${!!why}" ${why ? `data-why="${U.esc(why)}" data-tip="${U.esc(why)}"` : ''}>Исследовать</button>`}
          </div></div></div>`;
      }
      html += '</div>';
    }
    return html + '</div>';
  },

  focusHTML() {
    const P = this.P();
    const cur = P.focus ? FOCUS_BY_ID[P.focus.id] : null;
    let html = `<div class="rs-head"><div class="rs-rp"><svg><use href="#i-tree"/></svg><span>${cur ? `Выполняется: <b>${U.esc(Game.focusName(cur))}</b>` : 'Фокус не выбран — выберите доступный узел дерева'}</span></div>
      <div class="rs-hint">Фокусы бесплатны, но выполняются по одному. Во втором ряду — выбор политического пути: два из трёх приводят к власти другого лидера и меняют идеологию страны.</div></div>`;
    const tree = Game.focusTree();
    const mx = Math.max(...tree.map(f => f.x)), my = Math.max(...tree.map(f => f.y));
    html += `<div class="ft-wrap"><div class="ft" id="focus-tree" style="width:${mx * 134 + 124}px;height:${my * 124 + 108}px"><svg class="ft-lines"></svg>`;
    for (const f of Game.focusTree()) {
      const st = Game.focusState(f), why = Game.canFocus(f);
      html += `<div class="fnode st-${st}${f.path ? ' fnode-path' : ''}" style="--x:${f.x};--y:${f.y}" data-fid="${f.id}" data-tip="${U.esc(f.desc)}">
        ${f.path ? `<div class="fnode-kind">${U.esc(f.path)}</div>` : ''}
        <div class="fnode-name">${U.esc(Game.focusName(f))}</div>
        ${f.fx.gov ? `<div class="fnode-gov" style="--ic:${IDEOLOGIES[f.fx.gov.ide].color}"><i></i>${U.esc(f.fx.gov.leader)} · ${IDEOLOGIES[f.fx.gov.ide].name.toLowerCase()}</div>` : `<div class="fnode-desc">${U.esc(f.desc)}</div>`}
        ${st === 'active' ? `<div class="meter meter-gold"><i data-live="prog" data-k="focus" data-id="${f.id}" style="width:${(1 - P.focus.daysLeft / P.focus.total) * 100}%"></i></div><em class="fnode-days" data-live="days" data-k="focus" data-id="${f.id}">${U.days(P.focus.daysLeft)}</em>` :
          st === 'done' ? '<em class="fnode-days done">Выполнен</em>' :
          `<button class="btn btn-xs ${why ? 'is-disabled' : 'btn-gold'}" data-act="focus-start" data-id="${f.id}" aria-disabled="${!!why}" ${why ? `data-why="${U.esc(why)}" data-tip="${U.esc(why)}"` : ''}>${U.days(f.days)}</button>`}
      </div>`;
    }
    html += '<div class="ft-excl"><span>⇋</span>Политический путь: можно выбрать только один из трёх</div></div></div>';
    return html;
  },

  drawFocusLines(root) {
    const tree = root.querySelector('#focus-tree');
    const svg = tree.querySelector('.ft-lines');
    const W = 134, H = 124, NW = 124, NH = 108;   // шаг сетки и размер узла — совпадают с CSS
    const pos = f => ({ x: f.x * W + NW / 2, top: f.y * H, bottom: f.y * H + NH });
    const P = this.P();
    let d = '';
    for (const f of Game.focusTree()) {
      const parents = (f.reqAny || f.req || []).map(id => FOCUS_BY_ID[id]);
      const c = pos(f);
      for (const p of parents) {
        const a = pos(p);
        const midY = (a.bottom + c.top) / 2;
        d += `<path class="${P.focuses.includes(p.id) ? 'done' : ''}" d="M${a.x},${a.bottom} V${midY} H${c.x} V${c.top}"/>`;
      }
    }
    svg.innerHTML = d;
  },

  /* ---------------- МЕНЮ, СПРАВКА ---------------- */
  openMenu() {
    if (this.isOpen('menu') || !this.started) return;
    let html = `<div class="mh"><svg><use href="#${this.D().emblem}"/></svg><div><div class="mh-k">Ставка верховного командования</div><h2>Меню</h2></div></div>
      <div class="menu-list"><button class="btn btn-gold" data-m="resume">Вернуться к игре</button>`;
    if (Net.mp) {
      const room = Net.room;
      html += `<div class="menu-room">Комната <b>${U.esc(room ? room.code : '—')}</b>${room ? room.players.map(p => `<span>${U.esc(p.name)} — ${p.power ? POWERS[p.power].name : '—'}${p.online ? '' : ' (не в сети)'}</span>`).join('') : ''}</div>`;
    } else {
      const man = Game.saveInfo(false), auto = Game.saveInfo(true);
      const slot = (key, label, info, why) => `<button class="btn ${info ? '' : 'is-disabled'}" data-m="${key}" ${info ? '' : `aria-disabled="true" data-why="${why}"`}>${label}${info ? ` <small>(${U.fmtDate(info.date)})</small>` : ''}</button>`;
      html += `<button class="btn" data-m="save">Сохранить игру</button>
        ${slot('load', 'Загрузить сохранение', man, 'Ручных сохранений нет')}
        ${slot('loadauto', 'Загрузить автосохранение', auto, 'Автосохранений пока нет — они делаются каждые 30 дней')}`;
    }
    html += `<button class="btn" data-m="help">Как играть</button>
        <button class="btn" data-m="sound">Звук: ${Sound.enabled ? 'включён' : 'выключен'}</button>
        <button class="btn" data-m="news">Новости на экране: ${this.newsModeName()}</button>
        <button class="btn" data-m="map">Карта: ${MapView.mode === 'globe' ? '3D-глобус' : '2D-проекция'}</button>
        <button class="btn btn-red" data-m="new">${Net.mp ? 'Покинуть сетевую игру' : 'Новая игра'}</button>
      </div>`;
    this.openModal({
      key: 'menu', cls: 'm-small', html,
      onOpen: (el, m) => {
        el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
          if (b.getAttribute('aria-disabled') === 'true') return;
          const k = b.dataset.m;
          if (k === 'resume') return this.closeModal(m);
          if (k === 'save') { Game.save(); return this.closeModal(m); }
          if (k === 'load') { this.closeModal(m); return this.loadGame(false); }
          if (k === 'loadauto') { this.closeModal(m); return this.loadGame(true); }
          if (k === 'help') return this.openHelp();
          if (k === 'sound') { Sound.toggle(); b.textContent = 'Звук: ' + (Sound.enabled ? 'включён' : 'выключен'); return; }
          if (k === 'news') {
            const order = ['full', 'ticker', 'off'];
            this.newsMode = order[(order.indexOf(this.getNewsMode()) + 1) % order.length];
            U.storage.set('meridian_news_mode', this.newsMode);
            b.textContent = 'Новости на экране: ' + this.newsModeName();
            return;
          }
          if (k === 'map') { this.toggleMapMode(); b.textContent = 'Карта: ' + (MapView.mode === 'globe' ? '3D-глобус' : '2D-проекция'); return; }
          if (k === 'new') {
            this.closeModal(m);
            if (Net.mp) { Net.send('leave'); Net.disconnect(); this.started = false; }
            return this.showIntro();
          }
        }));
      }
    });
  },

  loadGame(auto) {
    this.closeAll();
    this.eventQueue = [];
    if (Game.load(auto)) { this.started = true; this.toast('Сохранение загружено', 'ok'); MapView.focus(this.D().capital); }
    else this.toast('Не удалось загрузить сохранение', 'err');
  },

  toggleMapMode() {
    const want = MapView.mode === 'globe' ? 'flat' : 'globe';
    if (want === 'globe' && !MapView.canGlobe()) return this.toast('3D-глобус недоступен: браузер не поддерживает WebGL', 'err');
    const mode = MapView.setMode(want);
    MapView.setSelected(this.selected);
    const b = this.el.mapMode;
    b.querySelector('span').textContent = mode === 'globe' ? '2D-карта' : '3D-глобус';
    U.storage.set('meridian_map_mode', mode);
  },

  openHelp() {
    const html = `<div class="mh"><svg><use href="#i-book"/></svg><div><div class="mh-k">Наставление для лидера державы</div><h2>Как играть</h2></div></div>
      <div class="help">
        <section><h3>Цель</h3><p><b>Победа</b>: 55% мировой промышленности или захват столиц обеих соперничающих держав. В сетевой игре — ещё и если все соперники-люди капитулировали. <b>Поражение</b>: потеря своей столицы или ядерная зима — 7 радиоактивных пустошей на планете.</p></section>
        <section><h3>Время</h3><p>1 игровой день = 1 секунда на скорости 1. <kbd>Пробел</kbd> — пауза, <kbd>+</kbd>/<kbd>−</kbd> или <kbd>1</kbd>–<kbd>4</kbd> — скорость. В сетевой игре время общее: пауза и скорость меняются у всех.</p></section>
        <section><h3>Ресурсы</h3><p><b>ПВ</b> — политвласть для любых решений. <b>Заводы</b> дают очки исследований (ОИ). <b>Призывники</b> нужны для новых дивизий. <b>Напряжённость</b> общая для мира: выше 50% блоки мобилизуются, выше 75–80% сами вступают в войну.</p></section>
        <section><h3>Война</h3><p>Кликните по стране → «Обосновать войну» → дождитесь окончания → «Объявить войну». Территория станет оранжевым фронтом. «Спланировать наступление» покажет шанс победы: сила атаки против обороны плюс бросок 2d6 с каждой стороны. Через пролив атака слабее на 20%, десантом — на 45%. Сверхдержавы обладают <b>стойкостью</b>: их фронт рушится медленнее.</p></section>
        <section><h3>Армии и фронт</h3><p>Дивизии воюют в составе армий — фишек на карте. Кликните по фишке, затем по своей земле — армия пойдёт туда; по соседней вражеской — начнёт наступление. Бой идёт каждый день, пока не кончится организация. Земли без армии защищает только ополчение.</p></section>
        <section><h3>Шаблоны дивизий</h3><p>Кнопка «Шаблоны» внизу (или <kbd>D</kbd>) открывает конструктор: соберите дивизию из батальонов — пехоты, мотопехоты, танков, артиллерии и ПТ. Танки сильны в атаке и прорыве, пехота держит оборону и организацию, ПТ гасит танки противника, моторизованные армии маршируют быстрее.</p></section>
        <section><h3>Против человека</h3><p>Армия державы-игрока защищает все её враждебные границы сразу: чем больше у соперника фронтов, тем слабее каждый участок. Мир между людьми заключается только по согласию обоих.</p></section>
        <section><h3>Разведка</h3><p>Без разведданных численность врага видна как диапазон. «Сбор разведданных» уточняет цифры, «Саботаж» снижает оборону до −60%, «Диверсия» уничтожает заводы. Провалы повышают напряжённость.</p></section>
        <section><h3>Политика и выборы</h3><p>У каждой страны есть правящая идеология, лидер и популярность партий. В демократиях проходят выборы по реальному календарю, в режимах — управляемые выборы: власть теряет их, только если её поддержка упала ниже 30%. В панели страны можно <b>поддержать партию</b>, <b>вмешаться в выборы</b> (за 180 дней до них) или устроить <b>переворот</b>. Близкие по идеологии страны охотнее вступают в ваш блок. Идеология вашей державы даёт свои бонусы. <kbd>I</kbd> — карта идеологий.</p></section>
        <section><h3>Новости</h3><p><kbd>N</kbd> — мировые новости: выборы, перевороты, войны, кризисы, а также календарь ближайших выборов. События с выбором приходят по реальным датам 2018–2023 годов и случайно.</p></section>
        <section><h3>Наука и фокусы</h3><p><kbd>R</kbd> — исследования (2 отдела одновременно), <kbd>F</kbd> — национальные фокусы: во втором ряду дерева выбирается политический путь, он может привести к власти другого человека. Ядерная ветка до 4-го уровня открывает ядерный удар: регион навсегда превращается в пустошь без заводов.</p></section>
        <section><h3>Управление</h3><p>Мышь: вращение глобуса, колесо — масштаб. <kbd>M</kbd> — 3D-глобус / 2D-карта. <kbd>Esc</kbd> — закрыть окно / меню. Одиночная игра сохраняется автоматически каждые 30 дней.</p></section>
      </div>
      <div class="m-actions"><button class="btn btn-gold" data-ok>Понятно</button></div>`;
    this.openModal({ key: 'help', cls: 'm-help', html, onOpen: (el, m) => { el.querySelector('[data-ok]').onclick = () => this.closeModal(m); } });
  },

  /* ---------------- ВСТУПЛЕНИЕ И ЛОББИ ---------------- */
  powerCards(selected, taken = {}, attr = 'data-power') {
    return POWER_TAGS.map(tag => {
      const d = POWERS[tag], by = taken[tag];
      return `<button class="pw ${tag === selected ? 'active' : ''} ${by ? 'taken' : ''}" ${attr}="${tag}" style="--pc:${d.color}" ${by ? 'aria-disabled="true"' : ''}>
        <svg class="pw-emb"><use href="#${d.emblem}"/></svg>
        <b>${d.name}</b><span>${d.title} ${d.leader}</span>
        <em>${by ? 'Занято: ' + U.esc(by) : `Стартовые заводы: ${d.start.reduce((s, id) => s + ((COUNTRY_OVERRIDES[id] || {}).fac || 0), 0)}`}</em>
      </button>`;
    }).join('');
  },

  showIntro() {
    this.closeAll();
    this.eventQueue = [];
    this.started = false;
    const info = Game.latestSave();
    let diff = 'normal', power = 'SOV', tab = 'solo';
    const html = `<div class="intro">
      <div class="intro-hero">
        <svg class="intro-emblem"><use href="#i-star-emblem"/></svg>
        <div class="intro-k">Многополярный мир · с 2018 года</div>
        <h1>КРАСНЫЙ МЕРИДИАН</h1>
        <p>1 января 2018 года. <span class="c-west">США</span> защищают привычный мировой порядок, <span class="c-sov">Россия</span> бросает ему вызов, <span class="c-axis">Китай</span> становится второй экономикой планеты, а <span class="c-ua">Украина</span> пятый год живёт с войной на Донбассе. Впереди выборы, революции, пандемия и войны. Лидеры и события — реальные на начало 2018 года, дальше историю пишете вы: фокусы, выборы и перевороты могут привести к власти других людей и сменить идеологию любой страны.</p>
      </div>
      <div class="intro-tabs"><button class="rs-tab active" data-tab="solo">Одиночная игра</button><button class="rs-tab" data-tab="net">Сетевая игра</button></div>
      <div class="intro-pane" data-pane="solo">
        <div class="intro-label">Держава</div>
        <div class="pw-grid" data-group="solo-power">${this.powerCards(power)}</div>
        <div class="intro-label">Сложность</div>
        <div class="intro-diff">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="diff ${k === diff ? 'active' : ''}" data-diff="${k}"><b>${d.name}</b><span>${d.desc}</span></button>`).join('')}</div>
        <div class="m-actions">
          <button class="btn" data-help>Как играть</button>
          ${info ? `<button class="btn" data-continue>Продолжить кампанию <small>(${U.fmtDate(info.date)})</small></button>` : ''}
          <button class="btn btn-red btn-lg" data-start><svg><use href="#i-pp"/></svg>Начать</button>
        </div>
      </div>
      <div class="intro-pane hidden" data-pane="net">
        <div class="net-form">
          <label>Ваше имя<input id="net-name" maxlength="20" value="${U.esc(Net.myName())}"></label>
          <label>Адрес сервера<input id="net-url" placeholder="например, red-meridian.onrender.com" value="${U.esc(Net.defaultUrl())}"></label>
        </div>
        <div class="net-actions">
          <button class="btn btn-red" data-create>Создать комнату</button>
          <span class="net-or">или</span>
          <input id="net-code" class="code-input" maxlength="4" placeholder="КОД">
          <button class="btn btn-gold" data-join>Войти по коду</button>
        </div>
        <div class="net-hint">Создайте комнату и отправьте другу четырёхбуквенный код. Если сервер долго «просыпается» (бесплатный хостинг засыпает без игроков), подождите до минуты.</div>
        <div class="lobby hidden" id="lobby"></div>
      </div>
    </div>`;
    this.openModal({
      key: 'intro', cls: 'm-intro', html, dismissible: false, pause: false,
      onOpen: (el) => {
        el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
          tab = b.dataset.tab;
          el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
          el.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab));
          Sound.play('click');
        });
        el.querySelector('[data-group="solo-power"]').addEventListener('click', e => {
          const b = e.target.closest('[data-power]');
          if (!b) return;
          power = b.dataset.power;
          el.querySelectorAll('[data-group="solo-power"] [data-power]').forEach(x => x.classList.toggle('active', x === b));
          Sound.play('click');
        });
        el.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => {
          diff = b.dataset.diff;
          el.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('active', x === b));
          Sound.play('click');
        });
        el.querySelector('[data-help]').onclick = () => { Sound.play('click'); this.openHelp(); };
        const cont = el.querySelector('[data-continue]');
        if (cont) cont.onclick = () => { Sound.play('ok'); this.loadGame(); };
        el.querySelector('[data-start]').onclick = () => {
          Sound.play('ok');
          this.closeAll();
          Net.mp = false;
          Game.me = power;
          Game.cur = power;
          this.started = true;
          Game.newGame(diff, [power]);
          MapView.focus(POWERS[power].capital);
          setTimeout(() => this.toast('Время на паузе. Нажмите ▶ или Пробел, чтобы начать. Кликните по стране, чтобы открыть её панель.', 'info'), 400);
        };
        // Сетевая игра
        const conn = async () => {
          const name = el.querySelector('#net-name').value.trim() || 'Игрок';
          U.storage.set('meridian_name', name);
          const url = el.querySelector('#net-url').value.trim();
          if (!url) { this.toast('Укажите адрес сервера', 'err'); return null; }
          if (Net.ws) return name;
          this.toast('Подключаемся к серверу…', 'info');
          try { await Net.connect(url); } catch (e) { this.toast(e.message, 'err'); return null; }
          return name;
        };
        el.querySelector('[data-create]').onclick = async () => {
          const name = await conn();
          if (!name) return;
          const res = await Net.request('create', { name, difficulty: 'normal' });
          if (!res.ok) this.toast(res.msg, 'err');
        };
        const codeInput = el.querySelector('#net-code');
        codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-ZА-Я]/g, ''); });
        el.querySelector('[data-join]').onclick = async () => {
          const code = codeInput.value.trim();
          if (code.length !== 4) { this.toast('Код комнаты — 4 буквы', 'err'); return; }
          const name = await conn();
          if (!name) return;
          const res = await Net.request('join', { code, name });
          if (!res.ok) this.toast(res.msg, 'err');
        };
      }
    });
  },

  closeIntro() {
    this.closeAll();
    this.started = true;
    MapView.focus(this.D().capital);
  },

  renderLobby(room) {
    const el = this.modalEl('intro');
    if (!el || !room) return;
    const box = el.querySelector('#lobby');
    box.classList.remove('hidden');
    el.querySelector('.net-actions').classList.add('hidden');
    el.querySelector('.net-form').classList.add('hidden');
    el.querySelector('.net-hint').classList.add('hidden');
    const me = room.players.find(p => p.clientId === Net.clientId);
    const host = room.host === Net.clientId;
    const taken = {};
    room.players.forEach(p => { if (p.power && p.clientId !== Net.clientId) taken[p.power] = p.name; });
    const ready = room.players.every(p => p.power) && room.players.length >= 1;
    box.innerHTML = `
      <div class="lobby-code">Код комнаты <b>${U.esc(room.code)}</b><button class="btn btn-xs" data-copy>Скопировать</button></div>
      <div class="lobby-players">${room.players.map(p => `<div class="lp ${p.online ? '' : 'off'}"><i style="background:${p.power ? POWERS[p.power].color : '#555'}"></i>
        <b>${U.esc(p.name)}</b>${p.clientId === room.host ? '<em>хост</em>' : ''}<span>${p.power ? POWERS[p.power].name : 'выбирает державу…'}</span></div>`).join('')}</div>
      <div class="intro-label">Ваша держава</div>
      <div class="pw-grid" data-group="net-power">${this.powerCards(me && me.power, taken)}</div>
      <div class="intro-label">Сложность (ИИ-стран)</div>
      <div class="intro-diff">${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="diff ${k === room.difficulty ? 'active' : ''} ${host ? '' : 'is-locked'}" data-ndiff="${k}"><b>${d.name}</b><span>${d.desc}</span></button>`).join('')}</div>
      <div class="m-actions">
        <button class="btn" data-leave>Выйти из комнаты</button>
        ${host ? `<button class="btn btn-red btn-lg ${ready ? '' : 'is-disabled'}" data-go ${ready ? '' : 'aria-disabled="true" data-why="Все игроки должны выбрать державу"'}><svg><use href="#i-pp"/></svg>Начать игру</button>`
          : '<span class="net-wait">Ждём, когда хост начнёт игру…</span>'}
      </div>`;
    box.querySelector('[data-copy]').onclick = () => {
      try { navigator.clipboard.writeText(room.code); this.toast('Код скопирован', 'ok'); } catch (e) { this.toast('Код: ' + room.code, 'info'); }
    };
    box.querySelector('[data-group="net-power"]').addEventListener('click', async e => {
      const b = e.target.closest('[data-power]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      Sound.play('click');
      const res = await Net.request('pick', { power: b.dataset.power });
      if (!res.ok) this.toast(res.msg, 'err');
    });
    box.querySelectorAll('[data-ndiff]').forEach(b => b.onclick = async () => {
      if (!host) return this.toast('Сложность выбирает хост', 'info');
      const res = await Net.request('difficulty', { difficulty: b.dataset.ndiff });
      if (!res.ok) this.toast(res.msg, 'err');
    });
    box.querySelector('[data-leave]').onclick = () => { Net.send('leave'); Net.disconnect(); this.showIntro(); };
    const go = box.querySelector('[data-go]');
    if (go) go.onclick = async () => {
      if (go.getAttribute('aria-disabled') === 'true') return;
      const res = await Net.request('start', {});
      if (!res.ok) this.toast(res.msg, 'err');
    };
  },

  /* ---------------- ПОЛИТИКА В ПАНЕЛИ СТРАНЫ ---------------- */
  // Партия, выбранная для действий: по умолчанию — наша идеология (в своей стране — правящая)
  polIdeFor(c, pol) {
    if (this.polSel && this.polSel.cid === c.id && IDEOLOGIES[this.polSel.ide]) return this.polSel.ide;
    return c.ctrl === Game.me ? pol.ide : (Game.powerIde(Game.me) || pol.ide);
  },

  polSig(c) {
    const h = Game.govHolder(c), pol = h && h.pol;
    if (!pol) return null;
    const ide = this.polIdeFor(c, pol);
    return [h.id, pol.ide, pol.leader, Object.entries(pol.pop).map(([k, v]) => k + Math.round(v)).join(','), Game.electionIn(pol) != null ? Math.ceil(Game.electionIn(pol) / 5) : -1,
      pol.sup.filter(x => x.by === Game.me).map(x => x.ide + Math.ceil(x.days / 7)).join(','), ide,
      Game.canSupport(c, ide), Game.canMeddle(c, ide), Game.canCoup(c, ide), Game.P(Game.me).pp >= CFG.POL.coup];
  },

  politicsHTML(c) {
    const me = Game.me, own = c.ctrl === me;
    const holder = Game.govHolder(c), pol = holder && holder.pol;
    if (!pol || c.inert) return '';
    if (own && !Game.isPowerHome(c)) return '';
    const I = IDEOLOGIES[pol.ide];
    let h = `<div class="cp-sec cp-pol"><div class="cp-sec-title">Политика</div>`;
    if (holder !== c) {
      return h + `<div class="cp-note">Территорией управляет ${U.esc(holder.name)}: ${U.esc(I.gov.toLowerCase())}.</div></div>`;
    }
    const title = pol.title || (Game.isPowerHome(c) ? Game.leaderTitle(c.ctrl) : 'Глава власти');
    h += `<div class="pol-head" style="--ic:${I.color}">
      <div class="pol-portrait">${U.esc(Politics.initials(pol.leader))}</div>
      <div class="pol-who"><b>${U.esc(U.cap(Game.leaderLabel(pol)))}</b><span>${U.esc(title)}</span></div>
      <div class="pol-gov">${U.esc(Game.partyName(c, pol.ide))} · ${U.esc(I.gov)}</div></div>`;
    const keys = IDE_KEYS.filter(k => (pol.pop[k] || 0) >= 0.5).sort((a, b) => pol.pop[b] - pol.pop[a]);
    h += `<div class="pol-bar">${keys.map(k => `<i style="width:${pol.pop[k]}%;background:${IDEOLOGIES[k].color}"></i>`).join('')}</div>`;
    const sel = this.polIdeFor(c, pol);
    h += `<div class="pol-list">${keys.map(k => {
      const cand = pol.cands[k] && !(k === pol.ide && pol.cands[k] === pol.leader) ? pol.cands[k] : '';
      return `<button class="pol-row${k === pol.ide ? ' ruling' : ''}${k === sel ? ' sel' : ''}" data-act="pol-ide" data-id="${c.id}" data-ide="${k}"
        data-tip="${U.esc('Идеология: ' + IDEOLOGIES[k].name.toLowerCase() + (cand ? '. Кандидат: ' + cand : '') + '. Кликните, чтобы выбрать партию для действий.')}">
        <i style="background:${IDEOLOGIES[k].color}"></i><span>${U.esc(Game.partyName(c, k))}${k === pol.ide ? ' <small>у власти</small>' : ''}${cand ? ` <em>${U.esc(cand)}</em>` : ''}</span>
        <b>${U.fmt(pol.pop[k], 1)}%</b></button>`;
    }).join('')}</div>`;
    const left = Game.electionIn(pol);
    h += `<div class="pol-elect"><svg><use href="#i-vote"/></svg><span>${left == null ? 'Выборы не проводятся'
      : `Выборы: <b>${U.fmtDate(Game.S.date + left * DAY_MS)}</b> · через ${U.days(left)}${pol.managed ? ' · <em>управляемые</em>' : ''}`}</span></div>`;
    const mine = pol.sup.find(x => x.by === me);
    if (mine) h += `<div class="pol-note">Наша поддержка партии «${U.esc(Game.partyName(c, mine.ide))}» — ещё ${U.days(mine.days)}.</div>`;
    const foreign = pol.sup.filter(x => x.by !== me && Game.isPower(x.by));
    if (foreign.length && (own || Game.intel(c) >= 60)) h += `<div class="pol-note warn">Иностранное вмешательство: ${foreign.map(x => `${POWERS[x.by].name} → «${U.esc(Game.partyName(c, x.ide))}»`).join(', ')}.</div>`;

    // Действия с выбранной партией
    const S2 = IDEOLOGIES[sel];
    const label = `<span class="pol-pick" style="--ic:${S2.color}">«${U.esc(Game.partyName(c, sel))}»</span>`;
    h += this.actBtn({ act: 'pol-support', id: c.id, data: `data-ide="${sel}"`, icon: 'i-flag',
      label: (own ? 'Агитация за ' : 'Поддержать ') + label, why: Game.canSupport(c, sel),
      sub: `≈+${Math.round(CFG.POL.supportDays / 7 * 1.1 * (own ? 1.4 : 1))}% за ${U.days(CFG.POL.supportDays)}${own ? '' : ' · напряжённость +0,5%'}`, cost: this.costTag(Game.supportCost()),
      tip: own ? 'Государственные СМИ и активисты работают на выбранную партию.' : 'Деньги, СМИ и консультанты для выбранной партии. Страны, которым мы помогали, охотнее вступают в наш блок.' });
    if (left != null) {
      h += this.actBtn({ act: 'pol-meddle', id: c.id, data: `data-ide="${sel}"`, icon: 'i-vote',
        label: 'Вмешаться в выборы: ' + label, why: Game.canMeddle(c, sel),
        sub: `+7% сразу · шанс ${U.pct(Game.meddleChance(c))} · провал: −4% и скандал`, cost: this.costTag(CFG.POL.meddle),
        tip: 'Боты, утечки и «независимые» СМИ в последние месяцы перед выборами.' });
    }
    if (!own && !Game.isPower(c.ctrl)) {
      h += this.actBtn({ act: 'pol-coup', id: c.id, data: `data-ide="${sel}"`, icon: 'i-swords', cls: 'act-danger',
        label: 'Переворот: ' + label, why: Game.canCoup(c, sel),
        sub: `Шанс ${U.pct(Game.coupChance(c, sel))} · напряжённость +3–5%`, cost: this.costTag(CFG.POL.coup),
        tip: 'Военные и политики выбранной партии берут власть. Единомышленники могут сразу вступить в наш блок.' });
    }
    return h + '</div>';
  },

  confirmCoup(id, ide) {
    const c = Game.c(id), I = IDEOLOGIES[ide];
    const why = Game.canCoup(c, ide);
    if (why) return this.result(Game.fail(why));
    const leader = c.pol.cands[ide];
    const fit = Politics.affinity(ide, Game.powerIde(Game.me)) === 2;
    const html = `<div class="mh"><svg><use href="#i-swords"/></svg><div><div class="mh-k">Тайная операция</div><h2>Переворот: ${U.esc(c.name)}</h2></div></div>
      <ul class="consequences">
        <li>К власти придёт партия «${U.esc(Game.partyName(c, ide))}»${leader ? ` — лидер ${U.esc(leader)}` : ''}. Строй: ${I.gov.toLowerCase()}.</li>
        <li>Шанс успеха: <b>${U.pct(Game.coupChance(c, ide))}</b>. Он выше, если партию поддерживает больше людей.</li>
        ${fit && c.faction === 'NEU' ? '<li class="pos">Наши единомышленники: 60% — страна сразу вступит в наш блок.</li>' : ''}
        <li class="neg">Успех: напряжённость +3%. Провал: напряжённость +5%, партия теряет 6%, следующая попытка — через год.</li>
      </ul>
      <div class="m-actions"><button class="btn" data-cancel>Отмена</button><button class="btn btn-red" data-go><svg><use href="#i-swords"/></svg>Начать (${CFG.POL.coup} ПВ)</button></div>`;
    this.openModal({
      key: 'coup', cls: 'm-small', html,
      onOpen: (el, m) => {
        el.querySelector('[data-cancel]').onclick = () => this.closeModal(m);
        el.querySelector('[data-go]').onclick = () => { this.closeModal(m); Act.call('coup', id, ide).then(res => this.result(res)); };
      }
    });
  },

  /* ---------------- МИРОВЫЕ НОВОСТИ ---------------- */
  onNews(e) {
    this.flashNews(e);
    this.updateNewsBadge();
    if (this.isOpen('news')) { this.newsSeen = Math.max(this.newsSeen, e.id); this.renderNews(); }
  },
  /* ---- Новости прямо на экране (как в HOI4) ---- */
  getNewsMode() { return this.newsMode || (this.newsMode = U.storage.get('meridian_news_mode') || 'full'); },
  newsModeName() { return { full: 'важные окном', ticker: 'только строкой', off: 'выключены' }[this.getNewsMode()]; },
  // Важная новость: война, мировое событие, выборы и перевороты в крупных странах
  isMajorNews(e) {
    if (e.k === 'war' || e.k === 'world') return true;
    if (e.k === 'elections') {
      const c = e.cid && Game.c(e.cid);
      return !!c && (c.major || Game.isPower(c.ctrl) || c.pop > 4e7 || ['RUS', 'UKR', 'USA', 'CHN'].includes(c.id));
    }
    return false;
  },
  flashNews(e) {
    const mode = this.getNewsMode();
    if (mode === 'off' || !this.started) return;
    if (mode === 'full' && this.isMajorNews(e)) {
      this.newsQueue.push(e);
      setTimeout(() => this.nextNews(), 0);
    } else this.tickerNews(e);
  },
  nextNews() {
    if (!this.started || !this.newsQueue.length || this.isOpen('newsflash')) return;
    // Сначала — окна, которые требуют решения или уже на экране
    if (this.eventQueue.length || this.modals.length) return;
    const wait = this.fxBusyUntil - performance.now();
    if (wait > 0) { clearTimeout(this.newsTimer); this.newsTimer = setTimeout(() => this.nextNews(), wait + 60); return; }
    // Устаревшие (больше 45 дней) и лишние, если их накопилось много, уходят в бегущую строку
    while (this.newsQueue.length > 3 || (this.newsQueue.length && Game.S.date - this.newsQueue[0].date > 45 * DAY_MS)) this.tickerNews(this.newsQueue.shift());
    const e = this.newsQueue.shift();
    if (!e) return;
    this.newsSeen = Math.max(this.newsSeen, e.id);
    this.updateNewsBadge();
    const c = e.cid && Game.c(e.cid);
    const icon = { war: 'i-swords', elections: 'i-vote', world: 'i-globe' }[e.k] || 'i-news';
    const kind = { war: 'Война и мир', elections: 'Выборы и власть', world: 'Мировые события' }[e.k] || 'Новости';
    const html = `<div class="nf k-${e.k || 'misc'}">
      <div class="nf-mast"><span>Мировые новости</span><em>${U.fmtDate(e.date)}</em></div>
      <div class="nf-art"><div class="nf-grid"></div><svg><use href="#${icon}"/></svg>
        <span class="nf-stamp">${kind}</span>${c ? `<span class="nf-place">${U.esc(c.name)}</span>` : ''}</div>
      <h2 class="nf-head">${U.esc(e.title)}</h2>
      <p class="nf-text">${U.esc(e.text)}</p>
      <div class="m-actions">${c ? '<button class="btn" data-map>Показать на карте</button>' : ''}<button class="btn btn-gold" data-ok>Понятно</button></div>
    </div>`;
    Sound.play(e.k === 'war' ? 'alert' : 'event');
    this.openModal({
      key: 'newsflash', cls: 'm-newsflash', html,
      onOpen: (el, m) => {
        el.querySelector('[data-ok]').onclick = () => { Sound.play('click'); this.closeModal(m); };
        const map = el.querySelector('[data-map]');
        if (map) map.onclick = () => { this.closeModal(m); this.select(c.id, true); };
      }
    });
  },
  // Бегущая строка вверху экрана: исчезает сама, клик — открыть все новости
  tickerNews(e) {
    if (this.getNewsMode() === 'off' || !this.started) return;
    let box = document.getElementById('news-ticker');
    if (!box) {
      box = document.createElement('div');
      box.id = 'news-ticker';
      document.getElementById('app').appendChild(box);
    }
    const item = document.createElement('button');
    item.className = 'nt-item' + (this.isMajorNews(e) ? ' major' : '');
    item.innerHTML = `<svg><use href="#i-news"/></svg><b>${U.esc(e.title)}</b><span>${U.esc(e.text)}</span>`;
    item.onclick = () => { item.remove(); this.openNews(); };
    box.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => { item.classList.remove('show'); setTimeout(() => item.remove(), 400); }, 7000);
  },

  newsList() { return Game.S ? Game.S.log.filter(e => e.cat === 'news') : []; },
  updateNewsBadge() {
    const b = document.getElementById('badge-news');
    if (!b || !Game.S) return;
    const n = this.newsList().filter(e => e.id > this.newsSeen).length;
    b.classList.toggle('hidden', !n);
    b.textContent = n > 99 ? '99+' : n;
  },

  openNews() {
    if (!this.started || !Game.S) return;
    const list = this.newsList();
    if (list.length) this.newsSeen = Math.max(this.newsSeen, list[0].id);
    this.updateNewsBadge();
    if (this.isOpen('news')) return this.renderNews();
    this.openModal({ key: 'news', cls: 'm-news', html: '<div class="nw"></div>', onOpen: () => this.renderNews() });
  },

  renderNews() {
    const el = this.modalEl('news');
    if (!el || !Game.S) return;
    const tab = this.newsTab;
    const tabs = [['all', 'Все новости'], ['elections', 'Выборы и власть'], ['war', 'Войны'], ['calendar', 'Календарь выборов']];
    let body = '';
    if (tab === 'calendar') {
      const rows = Game.list(c => c.pol && !c.inert && (c.ctrl === c.id || Game.isPowerHome(c)) && Game.electionIn(c.pol) != null)
        .sort((a, b) => a.pol.next - b.pol.next).slice(0, 40);
      body = rows.length ? `<div class="nw-cal">${rows.map(c => {
        const pol = c.pol, I = IDEOLOGIES[pol.ide], opp = Object.entries(pol.pop).filter(([k]) => k !== pol.ide).sort((a, b) => b[1] - a[1])[0];
        const left = Game.electionIn(pol);
        return `<button class="nw-cal-row${left <= CFG.POL.meddleWindow ? ' soon' : ''}" data-act="news-goto" data-id="${c.id}">
          <span class="nw-cal-date">${U.fmtDate(Game.S.date + left * DAY_MS)}<em>${left <= CFG.POL.meddleWindow ? 'можно вмешаться' : 'через ' + U.days(left)}</em></span>
          <b>${U.esc(c.name)}${Game.isPowerHome(c) ? ' <small>держава</small>' : ''}</b>
          <span class="nw-cal-race"><i style="background:${I.color}"></i>${U.esc(Game.partyName(c, pol.ide))} ${U.fmt(pol.pop[pol.ide] || 0, 0)}%
            ${opp ? ` · <i style="background:${IDEOLOGIES[opp[0]].color}"></i>${U.esc(Game.partyName(c, opp[0]))} ${U.fmt(opp[1], 0)}%` : ''}${pol.managed ? ' · <em>управляемые</em>' : ''}</span>
        </button>`;
      }).join('')}</div>` : '<div class="nw-empty">В ближайшие годы выборов не ожидается.</div>';
    } else {
      const items = this.newsList().filter(e => tab === 'all' || e.k === tab).slice(0, 80);
      body = items.length ? `<div class="nw-list">${items.map((e, i) => `<article class="nw-item${i === 0 ? ' lead' : ''}${e.k ? ' k-' + e.k : ''}" ${e.cid ? `data-act="news-goto" data-id="${e.cid}"` : ''}>
          <div class="nw-meta"><span>${U.fmtDate(e.date)}</span>${e.cid && Game.c(e.cid) ? `<em>${U.esc(Game.c(e.cid).name)}</em>` : ''}</div>
          <h3>${U.esc(e.title)}</h3><p>${U.esc(e.text)}</p></article>`).join('')}</div>`
        : '<div class="nw-empty">Пока без новостей.</div>';
    }
    el.querySelector('.nw').innerHTML = `<div class="nw-mast"><div class="nw-k">${U.fmtDate(Game.S.date)} · выпуск №${Game.S.day + 1}</div><h2>Мировые новости</h2></div>
      <div class="rs-tabs nw-tabs">${tabs.map(([k, t]) => `<button class="rs-tab${k === tab ? ' active' : ''}" data-ntab="${k}">${t}</button>`).join('')}</div>${body}`;
    el.querySelectorAll('[data-ntab]').forEach(b => b.onclick = () => { Sound.play('click'); this.newsTab = b.dataset.ntab; this.renderNews(); });
  },

  /* ---------------- КАРТА ИДЕОЛОГИЙ ---------------- */
  toggleMapLayer() {
    if (!Game.S) return;
    MapView.layer = MapView.layer === 'ide' ? 'bloc' : 'ide';
    const ide = MapView.layer === 'ide';
    $('#legend .lg-bloc').classList.toggle('hidden', ide);
    const box = $('#lg-ide');
    box.classList.toggle('hidden', !ide);
    box.innerHTML = IDE_KEYS.map(k => `<div class="lg-row"><i style="--c:${IDEOLOGIES[k].color}"></i>${IDEOLOGIES[k].name}</div>`).join('');
    $('#btn-map-layer span').textContent = ide ? 'Блоки' : 'Идеологии';
    MapView.refresh(true);
  },


  /* ---------------- КОНСОЛЬ (клавиша Ё / `) ----------------
     Видна только на этом экране. Команды сверяются по хешу. */
  openConsole() {
    if (document.getElementById('cmd-line')) return;
    const box = document.createElement('div');
    box.id = 'cmd-line';
    box.innerHTML = '<span>&gt;</span><input maxlength="40" autocomplete="off" spellcheck="false">';
    document.body.appendChild(box);
    const inp = box.querySelector('input');
    const close = () => { if (box.isConnected) box.remove(); };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Enter') { e.preventDefault(); const v = inp.value; this.runCommand(v); close(); }
    });
    // Закрывается только по Esc, Enter или клику мимо строки
    setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!box.contains(ev.target)) { close(); document.removeEventListener('mousedown', off); } }), 0);
    setTimeout(() => inp.focus(), 30);
    inp.focus();
  },
  // Русская раскладка → латинская по тем же клавишам (можно не переключать язык)
  cmdHash(str) {
    const ru = 'йцукенгшщзхъфывапролджэячсмитьбю', en = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
    // Оставляем только латинские буквы: «human_Ai», «human ai», «ргьфт_фш» — всё одно и то же
    const s = String(str).toLowerCase().split('').map(ch => { const i = ru.indexOf(ch); return i >= 0 ? en[i] : ch; }).join('').replace(/[^a-z]/g, '');
    let h = 5381;
    for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return h;
  },
  runCommand(v) {
    if (!Game.S || !v.trim()) return;
    if (this.cmdHash(v) === 1264065138) {
      Act.call('setAssist').then(res => {
        if (!res || !res.ok) return this.toast((res && res.msg) || 'Не получилось', 'err');
        this.assist = res.on;
        document.body.classList.toggle('assist-on', res.on);
        this.toast(res.on ? 'ИИ принял командование державой' : 'Командование возвращено вам', 'ok');
      });
    } else this.toast('Неизвестная команда', 'err');
  },

  /* ---------------- КОНЕЦ ИГРЫ ---------------- */
  showGameOver(o) {
    if (this.isOpen('gameover') || !this.started) return;
    const S = Game.S, st = this.P().stats, me = Game.me;
    const win = o.type === 'victory' && o.winner === me;
    const wName = o.winner ? POWERS[o.winner].name : '';
    const texts = {
      capital: ['Поражение', 'Столица пала', 'Вражеские танки на главной площади. Правительство эвакуировано, но война проиграна.'],
      winter: ['Поражение', 'Ядерная зима', 'Пепел сотен городов закрыл солнце. Победителей в этой войне нет — только выжившие.'],
      industry: win ? ['Победа', 'Мировая гегемония', 'Больше половины промышленности планеты работает на нашу экономику.'] : ['Поражение', 'Гегемония соперника', `${wName} контролирует больше половины мировой промышленности.`],
      rivals: win ? ['Победа', 'Крах соперников', 'Столицы обоих соперников пали. Над ними — наши знамёна.'] : ['Поражение', 'Крах соперников', `${wName} захватила столицы соперников.`],
      lastStanding: win ? ['Победа', 'Последняя держава', 'Все соперники-люди капитулировали. Мир принадлежит нам.'] : ['Поражение', 'Держава повержена', `${wName} остаётся единственной великой державой.`]
    };
    const [k, title, text] = texts[o.reason] || texts.capital;
    Sound.play(win ? 'victory' : 'defeat');
    const html = `<div class="go ${win ? 'win' : 'lose'}">
      <div class="mh-k">${k} · ${U.fmtDate(S.date)}</div><h1>${title}</h1><p>${text}</p>
      <div class="br-tiles">
        <div class="tile"><span>Лет у власти</span><b>${U.fmt(S.day / 365, 1)}</b></div>
        <div class="tile gold"><span>Доля промышленности</span><b>${U.pct(Game.industryShare())}</b></div>
        <div class="tile pos"><span>Побед / поражений</span><b>${st.won} / ${st.lost}</b></div>
        <div class="tile"><span>Присоединено территорий</span><b>${st.annexed}</b></div>
        <div class="tile neg"><span>Ядерных ударов</span><b>${st.nukes}</b></div>
        <div class="tile"><span>Тайных операций</span><b>${st.spyOk} / ${st.spyOk + st.spyFail}</b></div>
      </div>
      <div class="m-actions">
        ${!Net.mp && Game.hasSave() ? '<button class="btn" data-load>Загрузить сохранение</button>' : ''}
        <button class="btn ${win ? '' : 'btn-red'}" data-new>${Net.mp ? 'В главное меню' : 'Новая игра'}</button>
        ${win && !Net.mp ? '<button class="btn btn-gold" data-cont>Продолжить править</button>' : ''}
      </div></div>`;
    this.openModal({
      key: 'gameover', cls: 'm-gameover', html, dismissible: false, pause: false,
      onOpen: (el, m) => {
        const q = s => el.querySelector(s);
        if (q('[data-load]')) q('[data-load]').onclick = () => { this.closeModal(m); this.loadGame(); };
        q('[data-new]').onclick = () => {
          this.closeModal(m);
          if (Net.mp) { Net.send('leave'); Net.disconnect(); }
          this.showIntro();
        };
        if (q('[data-cont]')) q('[data-cont]').onclick = () => { Game.continueAfterVictory(); this.closeModal(m); this.updateClock(); };
      }
    });
  }
};
