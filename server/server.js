'use strict';
/* ============================================================
   СЕРВЕР СЕТЕВОЙ ИГРЫ «Красный меридиан»
   1. Раздаёт файлы игры (index.html, js, css…) — друг просто открывает ссылку.
   2. Держит комнаты: код из 4 букв, до 3 игроков, каждый выбирает державу.
   3. Для каждой комнаты запускает СВОЮ копию игрового ядра (те же файлы
      js/game.js, js/ai.js… что и в браузере) в изолированной песочнице vm.
      Сервер сам считает игровые дни и рассылает игрокам «патчи» — что изменилось.

   Запуск:  npm install  →  npm start   (порт берётся из PORT, по умолчанию 5085)
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 5085;
const MAX_PLAYERS = 3;
const ROOM_TTL_MS = 20 * 60 * 1000;   // комната без игроков живёт 20 минут
const FLUSH_MS = 250;                  // как часто рассылать изменения

/* ---------------- Игровое ядро: один раз компилируем, запускаем в каждой комнате ---------------- */
const ENGINE_FILES = ['data/countries.js', 'js/util.js', 'js/data.js', 'js/focuses.js', 'js/geo.js', 'js/combat.js', 'js/ai.js', 'js/game.js',
  'js/politics.js', 'js/events.js'];
const ENGINE_SRC = ENGINE_FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
  + '\n;({ Game, Geo, Bus, POWERS, DIFFICULTY });';
const ENGINE = new vm.Script(ENGINE_SRC, { filename: 'engine.js' });

async function createEngine() {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  ctx.window = ctx;
  const api = ENGINE.runInContext(ctx);
  await api.Geo.load();
  api.Game.server = true;
  api.Game.me = null;
  api.Game.cur = null;
  return api;
}

/* ---------------- Раздача файлов ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};
const fileCache = new Map();

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    let entry = fileCache.get(file);
    if (!entry || entry.mtime !== st.mtimeMs) {
      const raw = fs.readFileSync(file);
      entry = { mtime: st.mtimeMs, raw, gz: zlib.gzipSync(raw) };
      fileCache.set(file, entry);
    }
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {})
    });
    res.end(gzip ? entry.gz : entry.raw);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { url = '/'; }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  const rel = path.relative(ROOT, file);
  // Не отдаём ничего за пределами игры и служебные папки
  if (rel.startsWith('..') || path.isAbsolute(rel) || /^(server|node_modules)([\\/]|$)/.test(rel) || rel.split(/[\\/]/).some(p => p.startsWith('.'))) {
    res.writeHead(404); return res.end();
  }
  serveFile(req, res, file);
});

/* ---------------- Комнаты ---------------- */
const rooms = new Map();
// Буквы, которые одинаково выглядят в латинице и кириллице — код не перепутать
const CODE_ABC = 'ABCEHKMOPTX';
const CYR = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' };
const normCode = s => String(s || '').toUpperCase().split('').map(ch => CYR[ch] || ch).join('').slice(0, 4);

function newCode() {
  for (let i = 0; i < 1000; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('нет свободных кодов');
}

function lobbyView(room) {
  return {
    code: room.code, host: room.host, difficulty: room.difficulty, started: !!room.api,
    players: room.players.map(p => ({ clientId: p.clientId, name: p.name, power: p.power, online: !!p.ws }))
  };
}

function sendWs(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function broadcastLobby(room) {
  const msg = JSON.stringify({ type: 'lobby', room: lobbyView(room) });
  room.players.forEach(p => sendWs(p.ws, msg));
}
function toastRoom(room, text, kind, exceptId) {
  room.players.forEach(p => { if (p.clientId !== exceptId) sendWs(p.ws, { type: 'toast', text, kind }); });
}

/* ---------------- Синхронизация состояния ---------------- */
const round1 = v => Math.round(v * 10) / 10;
function wireCountry(c) {
  const o = Object.assign({}, c);
  o.divs = round1(c.divs);
  o.baseDivs = round1(c.baseDivs);
  o.control = round1(c.control);
  o.noise = Math.round(c.noise * 100) / 100;
  o.pop = Math.round(c.pop);
  o.intel = {};
  for (const [k, v] of Object.entries(c.intel)) o.intel[k] = Math.round(v);
  if (c.pol) {
    o.pol = Object.assign({}, c.pol, { pop: {}, base: {} });
    for (const [k, v] of Object.entries(c.pol.pop)) o.pol.pop[k] = round1(v);
    for (const [k, v] of Object.entries(c.pol.base)) o.pol.base[k] = round1(v);
  }
  return o;
}

function topState(S) {
  return {
    day: S.day, date: S.date, tension: S.tension, speed: S.speed, paused: S.paused,
    pwars: S.pwars, over: S.over, victoryShown: S.victoryShown, powers: S.powers, difficulty: S.difficulty
  };
}

function fullState(room, power) {
  const S = room.api.Game.S;
  const countries = {};
  for (const [id, c] of Object.entries(S.countries)) countries[id] = wireCountry(c);
  return Object.assign({}, S, { countries, log: S.log.filter(e => !e.to || e.to === power), me: power });
}

// Отправить всем изменения с прошлого раза, затем накопившиеся сообщения (бой, ядерный удар…)
function flush(room) {
  if (!room.api) return;
  room.lastFlush = Date.now();
  const S = room.api.Game.S;
  const changed = {};
  let any = false;
  for (const [id, c] of Object.entries(S.countries)) {
    const w = wireCountry(c);
    const j = JSON.stringify(w);
    if (room.lastWire[id] !== j) { room.lastWire[id] = j; changed[id] = w; any = true; }
  }
  const top = JSON.stringify(topState(S));
  const countries = any ? JSON.stringify(changed) : '{}';
  const logs = room.newLogs;
  room.newLogs = [];
  for (const p of room.players) {
    if (!p.ws) continue;
    const mine = logs.filter(e => !e.to || e.to === p.power);
    sendWs(p.ws, '{"type":"patch","top":' + top + ',"countries":' + countries + ',"logs":' + JSON.stringify(mine) + '}');
  }
  const out = room.outbox;
  room.outbox = [];
  for (const m of out) {
    const msg = JSON.stringify({ type: m.type, data: m.data });
    room.players.forEach(p => { if (p.ws && (!m.to || m.to === p.power)) sendWs(p.ws, msg); });
  }
}

/* ---------------- Запуск партии ---------------- */
async function startGame(room) {
  const api = await createEngine();
  room.api = api;
  room.lastWire = {};
  room.newLogs = [];
  room.outbox = [];
  const tags = room.players.map(p => p.power);
  const names = {};
  room.players.forEach(p => { names[p.power] = p.name; });

  const B = api.Bus;
  const out = (type, to) => data => room.outbox.push({ type, to: typeof to === 'function' ? to(data) : to, data });
  B.on('log', e => room.newLogs.push(e));
  B.on('event', out('event', d => d.power));
  B.on('eventClosed', out('eventClosed', d => d.power));
  B.on('battle', out('battle', d => d.by));
  B.on('enemyAttack', out('enemyAttack', d => d.power));
  B.on('techDone', out('techDone', d => d.power));
  B.on('focusDone', out('focusDone', d => d.power));
  ['nuke', 'enemyNuke', 'war', 'powerOut', 'gameover'].forEach(t => B.on(t, out(t, null)));

  api.Game.newGame(room.difficulty, tags, names);
  api.Game.S.paused = true;
  // Начальное состояние уже уходит в 'start', поэтому стартовые записи журнала не дублируем
  room.newLogs = [];
  for (const id of Object.keys(api.Game.S.countries)) room.lastWire[id] = JSON.stringify(wireCountry(api.Game.S.countries[id]));

  room.players.forEach(p => sendStart(room, p));
  flush(room);
  runLoop(room);
}

function sendStart(room, p) {
  if (!p.ws) return;
  sendWs(p.ws, {
    type: 'start', me: p.power, room: lobbyView(room),
    state: fullState(room, p.power),
    events: room.api.Game.pendingFor(p.power)
  });
}

const SPEEDS = [0, 1000, 500, 250, 100];
function runLoop(room) {
  let last = Date.now(), acc = 0;
  room.loop = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(1000, now - last);
    last = now;
    const G = room.api.Game, S = G.S;
    // Все игроки отключились — ставим на паузу, чтобы никто не проиграл в своё отсутствие
    if (!S.paused && !room.players.some(p => p.ws)) S.paused = true;
    if (!S.paused && !S.over) {
      acc += dt;
      const ms = SPEEDS[S.speed] || 1000;
      let steps = 0;
      while (acc >= ms && steps < 4) {
        acc -= ms;
        steps++;
        try { G.tick(); } catch (e) { console.error(`[${room.code}] tick`, e); }
        if (S.paused || S.over) { acc = 0; break; }
      }
      if (steps === 4) acc = Math.min(acc, ms);
    } else acc = 0;
    if (room.outbox.length || now - room.lastFlush >= FLUSH_MS) flush(room);
  }, 50);
}

/* ---------------- Действия игроков ---------------- */
const ACTIONS = new Set(['deploy', 'fortify', 'justify', 'declareWar', 'createArmy', 'reinforceArmy', 'disbandArmy', 'orderHold', 'orderMove', 'orderAttack', 'saveTemplate', 'deleteTemplate', 'peace', 'influence', 'integrate', 'spy',
  'nuke', 'startResearch', 'startFocus', 'chooseEvent', 'setPaused', 'setSpeed', 'supportParty', 'meddle', 'coup']);

function doAction(room, p, name, args) {
  if (!room.api) return { ok: false, msg: 'Игра ещё не началась' };
  if (!ACTIONS.has(name)) return { ok: false, msg: 'Неизвестное действие' };
  if (!Array.isArray(args) || args.length > 3 || args.some(a => a !== null && typeof a === 'object')) return { ok: false, msg: 'Неверные параметры' };
  const G = room.api.Game;
  let res;
  try {
    res = G.as(p.power, () => G[name](...args)) || { ok: true };
  } catch (e) {
    console.error(`[${room.code}] ${name}`, e);
    res = { ok: false, msg: 'Ошибка на сервере' };
  }
  if (name === 'setPaused' && res.ok) toastRoom(room, `${p.name}: ${G.S.paused ? 'пауза' : 'время пошло'}`, 'info', p.clientId);
  if (name === 'setSpeed' && res.ok) toastRoom(room, `${p.name}: скорость ${G.S.speed}`, 'info', p.clientId);
  flush(room);
  return res;
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', ws => {
  const client = { clientId: null, room: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const reply = (rid, res) => sendWs(ws, { type: 'reply', rid, res });
  const me = () => client.room && client.room.players.find(p => p.clientId === client.clientId);

  function leaveRoom() {
    const room = client.room;
    if (!room) return;
    const p = me();
    client.room = null;
    if (!p) return;
    if (room.api) {
      p.ws = null;
      toastRoom(room, `${p.name} вышел из игры`, 'warn');
    } else {
      room.players = room.players.filter(x => x !== p);
      if (room.host === p.clientId && room.players.length) room.host = room.players[0].clientId;
    }
    room.touched = Date.now();
    broadcastLobby(room);
  }

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const rid = msg.rid;
    try {
      switch (msg.type) {
        case 'hello':
          client.clientId = String(msg.clientId || '').slice(0, 40) || 'anon' + Math.random();
          return;

        case 'create': {
          leaveRoom();
          const room = {
            code: newCode(), host: client.clientId, difficulty: 'normal', players: [], api: null,
            touched: Date.now(), lastFlush: 0, outbox: [], newLogs: [], lastWire: {}
          };
          rooms.set(room.code, room);
          room.players.push({ clientId: client.clientId, name: String(msg.name || 'Игрок').slice(0, 20), power: null, ws });
          client.room = room;
          reply(rid, { ok: true, code: room.code });
          broadcastLobby(room);
          console.log(`[${room.code}] создана`);
          return;
        }

        case 'join': {
          const room = rooms.get(normCode(msg.code));
          if (!room) return reply(rid, { ok: false, msg: 'Комната не найдена. Проверьте код.' });
          const name = String(msg.name || 'Игрок').slice(0, 20);
          let p = room.players.find(x => x.clientId === client.clientId);
          if (room.api && !p) return reply(rid, { ok: false, msg: 'В этой комнате игра уже идёт' });
          if (!p) {
            if (room.players.length >= MAX_PLAYERS) return reply(rid, { ok: false, msg: 'Комната заполнена' });
            p = { clientId: client.clientId, name, power: null, ws };
            room.players.push(p);
          } else {
            p.ws = ws;
            if (!room.api) p.name = name;
          }
          if (client.room !== room) leaveRoom();
          client.room = room;
          room.touched = Date.now();
          reply(rid, { ok: true });
          broadcastLobby(room);
          if (room.api) {
            sendStart(room, p);
            toastRoom(room, `${p.name} вернулся в игру`, 'ok', p.clientId);
          }
          return;
        }

        case 'pick': {
          const room = client.room, p = me();
          if (!room || !p) return reply(rid, { ok: false, msg: 'Вы не в комнате' });
          if (room.api) return reply(rid, { ok: false, msg: 'Игра уже идёт' });
          if (!['SOV', 'WST', 'AXS'].includes(msg.power)) return reply(rid, { ok: false, msg: 'Нет такой державы' });
          if (room.players.some(x => x !== p && x.power === msg.power)) return reply(rid, { ok: false, msg: 'Эту державу уже выбрал другой игрок' });
          p.power = msg.power;
          reply(rid, { ok: true });
          broadcastLobby(room);
          return;
        }

        case 'difficulty': {
          const room = client.room;
          if (!room || room.host !== client.clientId) return reply(rid, { ok: false, msg: 'Сложность выбирает хост' });
          if (!['easy', 'normal', 'hard'].includes(msg.difficulty)) return reply(rid, { ok: false, msg: 'Нет такой сложности' });
          room.difficulty = msg.difficulty;
          reply(rid, { ok: true });
          broadcastLobby(room);
          return;
        }

        case 'start': {
          const room = client.room;
          if (!room || room.host !== client.clientId) return reply(rid, { ok: false, msg: 'Начать игру может только хост' });
          if (room.api) return reply(rid, { ok: false, msg: 'Игра уже идёт' });
          if (!room.players.every(p => p.power)) return reply(rid, { ok: false, msg: 'Все игроки должны выбрать державу' });
          reply(rid, { ok: true });
          await startGame(room);
          console.log(`[${room.code}] игра началась: ${room.players.map(p => p.name + '=' + p.power).join(', ')}`);
          return;
        }

        case 'act': {
          const room = client.room, p = me();
          if (!room || !p) return reply(rid, { ok: false, msg: 'Вы не в игре' });
          room.touched = Date.now();
          return reply(rid, doAction(room, p, String(msg.name), msg.args || []));
        }

        case 'leave':
          leaveRoom();
          return;
      }
    } catch (e) {
      console.error('[ws]', msg.type, e);
      if (rid) reply(rid, { ok: false, msg: 'Ошибка на сервере' });
    }
  });

  ws.on('close', () => {
    const room = client.room;
    const p = me();
    if (!room || !p || p.ws !== ws) return;
    if (room.api) {
      p.ws = null;
      toastRoom(room, `${p.name} потерял связь`, 'warn');
      broadcastLobby(room);
    } else {
      leaveRoom();
    }
    room.touched = Date.now();
  });
});

// Пинг раз в 25 секунд: обрываем «мёртвые» соединения и не даём хостингу закрыть живые
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* соединение уже закрыто */ }
  });
}, 25000);

// Удаляем комнаты, в которых давно никого нет
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.some(p => p.ws)) { room.touched = now; continue; }
    if (now - room.touched > ROOM_TTL_MS || !room.players.length) {
      if (room.loop) clearInterval(room.loop);
      rooms.delete(code);
      console.log(`[${code}] удалена`);
    }
  }
}, 60000);

server.listen(PORT, () => console.log(`Красный меридиан: сервер на http://localhost:${PORT}`));
