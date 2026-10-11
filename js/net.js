'use strict';
/* ============================================================
   СЕТЬ (клиент). Сетевая игра устроена так:
   • сервер хранит комнату и САМ считает игровые дни (Game.tick);
   • браузер игрока только показывает состояние и отправляет действия;
   • сервер присылает «патчи» — что изменилось с прошлого раза.
   Act — единая точка вызова действий: в одиночной игре зовёт Game
   напрямую, в сетевой — отправляет запрос на сервер.
   ============================================================ */

const Net = {
  mp: false,            // идёт сетевая игра
  ws: null,
  url: '',
  room: null,           // состояние лобби: { code, host, difficulty, players: [...] }
  rid: 0,
  waiting: {},
  clientId: '',
  wantOpen: false,      // соединение закрыто намеренно или нет
  retry: 0,

  init() {
    this.clientId = U.storage.get('meridian_client_id');
    if (!this.clientId) {
      this.clientId = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      U.storage.set('meridian_client_id', this.clientId);
    }
  },

  // Адрес сервера: если игра открыта с сервера — он же; иначе последний введённый вручную
  defaultUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return location.origin;
    }
    return U.storage.get('meridian_server') || '';
  },
  wsUrl(base) {
    let u = (base || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^(https?|wss?):\/\//.test(u)) u = 'https://' + u;
    return u.replace(/^http/, 'ws') + '/ws';
  },

  connect(base) {
    const url = this.wsUrl(base);
    if (!url) return Promise.reject(new Error('Не указан адрес сервера'));
    this.url = url;
    U.storage.set('meridian_server', base.trim());
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      const t = setTimeout(() => { try { ws.close(); } catch (e) { /* уже закрыто */ } reject(new Error('Сервер не ответил за 60 секунд')); }, 60000);
      ws.onopen = () => {
        clearTimeout(t);
        this.ws = ws;
        this.wantOpen = true;
        this.retry = 0;
        this.send('hello', { clientId: this.clientId });
        resolve();
      };
      ws.onerror = () => { clearTimeout(t); reject(new Error('Не удалось подключиться к серверу')); };
      ws.onmessage = ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        try { this.handle(msg); } catch (e) { console.error('[net]', msg.type, e); }
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        for (const k of Object.keys(this.waiting)) { this.waiting[k]({ ok: false, msg: 'Связь с сервером потеряна' }); delete this.waiting[k]; }
        if (this.wantOpen) this.reconnect();
      };
    });
  },

  // Связь оборвалась — пробуем вернуться в ту же комнату
  reconnect() {
    Bus.emit('netStatus', 'lost');
    const delay = Math.min(10000, 1000 * Math.pow(2, this.retry++));
    setTimeout(() => {
      if (!this.wantOpen) return;
      const base = this.url.replace(/^ws/, 'http').replace(/\/ws$/, '');
      this.connect(base).then(() => {
        if (this.room) this.send('join', { code: this.room.code, name: this.myName() });
        Bus.emit('netStatus', 'ok');
      }).catch(() => this.reconnect());
    }, delay);
  },

  disconnect() {
    this.wantOpen = false;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* уже закрыто */ } }
    this.ws = null;
    this.mp = false;
    this.room = null;
  },

  myName() { return U.storage.get('meridian_name') || 'Игрок'; },

  send(type, data = {}) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(Object.assign({ type }, data)));
    return true;
  },

  request(type, data = {}) {
    return new Promise(resolve => {
      const rid = ++this.rid;
      this.waiting[rid] = resolve;
      if (!this.send(type, Object.assign({ rid }, data))) {
        delete this.waiting[rid];
        resolve({ ok: false, msg: 'Нет связи с сервером' });
        return;
      }
      setTimeout(() => {
        if (this.waiting[rid]) { delete this.waiting[rid]; resolve({ ok: false, msg: 'Сервер не ответил' }); }
      }, 15000);
    });
  },

  handle(msg) {
    switch (msg.type) {
      case 'reply': {
        const w = this.waiting[msg.rid];
        if (w) { delete this.waiting[msg.rid]; w(msg.res || { ok: true }); }
        return;
      }
      case 'lobby':
        this.room = msg.room;
        Bus.emit('lobby', msg.room);
        return;
      case 'start':
        this.mp = true;
        this.room = msg.room || this.room;
        Game.me = msg.me;
        Game.cur = msg.me;
        Game.loadState(msg.state);
        (msg.events || []).forEach(e => Bus.emit('event', e));
        Bus.emit('netStart', msg);
        return;
      case 'patch':
        this.applyPatch(msg);
        return;
      case 'log':
        (msg.entries || []).forEach(e => this.addLog(e));
        return;
      case 'toast':
        Bus.emit('toast', msg.text, msg.kind || 'info');
        return;
      case 'error':
        Bus.emit('toast', msg.text || 'Ошибка сервера', 'err');
        return;
      default:
        // battle, nuke, enemyNuke, enemyAttack, war, event, eventClosed, techDone, focusDone, gameover, powerOut
        Bus.emit(msg.type, msg.data);
    }
  },

  addLog(e) {
    const S = Game.S;
    if (!S || S.log.some(x => x.id === e.id)) return;
    S.log.unshift(e);
    if (S.log.length > 200) S.log.length = 200;
    Bus.emit('log', e);
  },

  // Что на карте зависит от страны: если это не изменилось — карту не перекрашиваем
  mapSig(c) {
    return [c.ctrl, c.faction, c.radioactive, JSON.stringify(c.wars), JSON.stringify(c.cb), c.pol && c.pol.ide,
      c.influence && c.influence.by, c.integrate && c.integrate.by].join('|');
  },

  applyPatch(p) {
    const S = Game.S;
    if (!S) return;
    let mapChanged = false;
    const oldPwars = JSON.stringify(S.pwars);
    Object.assign(S, p.top || {});
    if (JSON.stringify(S.pwars) !== oldPwars) mapChanged = true;
    for (const [id, c] of Object.entries(p.countries || {})) {
      const old = S.countries[id];
      if (!old || this.mapSig(old) !== this.mapSig(c)) mapChanged = true;
      S.countries[id] = c;
    }
    (p.logs || []).forEach(e => this.addLog(e));
    Game.modsCache = {};
    Bus.emit('tick');
    if (mapChanged) Bus.emit('mapDirty');
  }
};

/* Act: вызов действия игрока. Всегда возвращает Promise с { ok, msg }. */
const Act = {
  call(name, ...args) {
    if (Net.mp) return Net.request('act', { name, args });
    try {
      return Promise.resolve(Game[name](...args) || { ok: true });
    } catch (e) {
      console.error('[act]', name, e);
      return Promise.resolve({ ok: false, msg: 'Внутренняя ошибка: ' + e.message });
    }
  }
};
