'use strict';
/* ============================================================
   КОМАНДОВАНИЕ: генералы, опыт войск и приказы по линии фронта.

   Генерал: навыки «атака», «оборона», «снабжение» (1–5). Они
   постоянны для каждого человека, а с опытом боёв растёт уровень
   генерала (+1 ко всем навыкам за уровень, максимум 3 уровня).
     атака     — +4% к силе наступления за единицу;
     оборона   — +4% к обороне региона, где стоит армия;
     снабжение — −5% к расходу организации в наступлении.
   Опыт армии (0–100) растёт в боях. Новобранцы → обстрелянные →
   ветераны → элита: до +20% к атаке и обороне. Пополнение
   новобранцами разбавляет опыт.

   Приказы фронта (армия выполняет их сама каждый день):
     «Наступать по фронту» — бьёт по соседнему вражескому региону,
        где прогноз победы хороший, и идёт дальше после захвата;
     «Держать фронт» — сама выдвигается на самый опасный участок
        границы поблизости и обороняет его.
   ============================================================ */

const VETERANCY = [
  { min: 0, name: 'Новобранцы', k: 1 },
  { min: 20, name: 'Обстрелянные', k: 1.06 },
  { min: 50, name: 'Ветераны', k: 1.12 },
  { min: 80, name: 'Элита', k: 1.2 }
];
const GEN_LEVELS = [0, 25, 70, 140];        // дней боёв до уровня генерала

Object.assign(Game, {
  /* ---------- Генералы ---------- */
  genBase(name) {
    const h = k => Resources.hash(name + k);
    // Сумма навыков 6–9: у каждого свой профиль
    const raw = [h('a'), h('d'), h('l')].map(x => 1 + Math.floor(x * 3));
    const bonus = Math.floor(h('x') * 3);
    raw[Math.floor(h('y') * 3)] += bonus;
    return { atk: Math.min(5, raw[0]), def: Math.min(5, raw[1]), log: Math.min(5, raw[2]) };
  },
  genLevel(a) { let l = 0; GEN_LEVELS.forEach((v, i) => { if ((a.gxp || 0) >= v) l = i; }); return l; },
  genSkills(a) {
    const b = this.genBase(a.general || '?'), l = this.genLevel(a);
    return { atk: Math.min(6, b.atk + l), def: Math.min(6, b.def + l), log: Math.min(6, b.log + l), level: l };
  },
  veterancy(xp = 0) { let v = VETERANCY[0]; for (const x of VETERANCY) if (xp >= x.min) v = x; return v; },
  // Лучший генерал и средний опыт группы армий
  groupCommand(armies) {
    if (!armies.length) return null;
    const divs = armies.reduce((s, a) => s + a.divs, 0) || 1;
    const xp = armies.reduce((s, a) => s + (a.xp || 0) * a.divs, 0) / divs;
    let best = null;
    for (const a of armies) { const s = this.genSkills(a); if (!best || s.atk + s.def > best.s.atk + best.s.def) best = { a, s }; }
    return { general: best.a.general, skills: best.s, xp, vet: this.veterancy(xp) };
  },
  gainXp(a, n) {
    const before = this.genLevel(a), vb = this.veterancy(a.xp).name;
    a.xp = Math.min(100, (a.xp || 0) + n);
    a.gxp = (a.gxp || 0) + 1;
    const owner = this.alive().find(t => this.armies(t).includes(a));
    if (this.genLevel(a) > before) this.log('success', 'Генерал растёт', `${a.general} (${a.name}) получает ${this.genLevel(a)}-й уровень: +1 ко всем навыкам.`, a.loc, owner);
    if (this.veterancy(a.xp).name !== vb) this.log('success', 'Опыт войск', `${a.name}: теперь «${this.veterancy(a.xp).name.toLowerCase()}».`, a.loc, owner);
  },

  /* ---------- Приказы фронта ---------- */
  canOrderFront(a, mode) {
    if (!a) return 'Армия не найдена';
    if (this.outReason()) return this.outReason();
    if (mode && !['attack', 'defend'].includes(mode)) return 'Нет такого приказа';
    return null;
  },
  orderFront(id, mode) {
    const a = this.army(id), why = this.canOrderFront(a, mode);
    if (why) return this.fail(why);
    a.front = mode || null;
    this.log('mil', 'Приказ по фронту', `${a.name}: ${mode === 'attack' ? 'наступать по линии фронта' : mode === 'defend' ? 'держать фронт' : 'ручное управление'}.`, a.loc);
    Bus.emit('stateChanged');
    return { ok: true, msg: `${a.name}: ${mode === 'attack' ? 'наступает по фронту' : mode === 'defend' ? 'держит фронт' : 'ручное управление'}` };
  },
  // Ближайший свой регион у фронта (поиск по своей и союзной земле)
  nearestFront(from, tag = this.cur, depth = 8) {
    const seen = { [from]: 0 }, queue = [from];
    let best = null;
    while (queue.length) {
      const cur = queue.shift(), d = seen[cur];
      const r = this.r(cur);
      const threat = Regions.nb(cur).reduce((s, n) => { const t = this.r(n); return s + (t && this.atWar(t, tag) ? Math.max(1, this.estDivs(t, tag).mid) : 0); }, 0);
      if (threat > 0 && r && r.ctrl === tag) {
        const mine = this.defendersAt(cur, tag).reduce((s, a) => s + a.divs, 0);
        const need = threat - mine * 0.6;
        const score = need - d * 0.8 + (this.isCapitalRegion(r) ? 3 : 0);
        if (!best || score > best.score) best = { id: cur, score };
      }
      if (d >= depth) continue;
      for (const n of Regions.nb(cur)) {
        if (n in seen) continue;
        if (!this.friendly(this.r(n), tag)) continue;
        seen[n] = d + 1;
        queue.push(n);
      }
    }
    return best && best.id;
  },
  tickFronts() {
    for (const X of this.alive()) {
      this.as(X, () => {
        for (const a of this.armies()) {
          if (!a.front || a.order.type !== 'hold' || a.battle) continue;
          if (a.front === 'attack') {
            if (a.org < 60) continue;
            let best = null;
            for (const n of Regions.nb(a.loc)) {
              const r = this.r(n);
              if (!r || !this.atWar(r) || this.canOrderAttack(a, r)) continue;
              const e = Combat.estimateArmies(r, [a]);
              if (e.pWin < 0.55 || e.daysToTake > e.orgDays + 3) continue;
              const v = e.pWin + r.factories * 0.05 + (this.isCapitalRegion(r) ? 0.5 : 0) - e.daysToTake / 60;
              if (!best || v > best.v) best = { r, v };
            }
            if (best) { this._auto = true; this.orderAttack(a.id, best.r.id); this._auto = false; continue; }
            // Некого бить рядом — выдвигаемся к фронту
            const here = Regions.nb(a.loc).some(n => this.atWar(this.r(n)));
            if (!here) { const to = this.nearestFront(a.loc); if (to && to !== a.loc) { this._auto = true; this.orderMove(a.id, to); this._auto = false; } }
          } else if (a.front === 'defend') {
            const to = this.nearestFront(a.loc, X, 6);
            if (to && to !== a.loc) {
              const hereThreat = Regions.nb(a.loc).some(n => this.atWar(this.r(n)));
              const others = this.defendersAt(a.loc, X).filter(x => x !== a).length;
              if (!hereThreat || others > 0) { this._auto = true; this.orderMove(a.id, to); this._auto = false; }
            }
          }
        }
      });
    }
  }
});

/* Встраиваем генералов и опыт в бой */
(function () {
  const G = Game;
  // Ручной приказ отменяет приказ по фронту
  for (const k of ['orderMove', 'orderAttack', 'orderAirborne']) {
    const f = G[k];
    if (!f) continue;
    G[k] = function (id, ...rest) {
      const res = f.call(this, id, ...rest);
      if (!this._auto && res && res.ok !== false) { const a = this.army(id); if (a) a.front = null; }
      return res;
    };
  }
  // Опыт: пополнение разбавляет
  const reinforce = G.reinforceArmy;
  G.reinforceArmy = function (id, n) {
    const a = this.army(id), before = a ? a.divs : 0;
    const res = reinforce.call(this, id, n);
    if (a && res.ok !== false && a.divs > before) a.xp = (a.xp || 0) * before / a.divs;
    return res;
  };
  // Бой: опыт наступающим, снабжение генерала бережёт организацию
  const battleDay = G.battleDay;
  G.battleDay = function (r, list) {
    const org = list.map(a => a.org);
    const ratio0 = r.control;
    battleDay.call(this, r, list);
    list.forEach((a, i) => {
      const s = this.genSkills(a);
      const spent = org[i] - a.org;
      if (spent > 0) a.org = Math.min(100, a.org + spent * 0.05 * s.log);
      this.gainXp(a, r.control < ratio0 || r.ctrl === this.cur ? 0.8 : 0.4);
    });
  };
  // Оборона от ИИ: опыт защитникам
  const enemyOffensive = G.enemyOffensive;
  G.enemyOffensive = function (src, target) {
    const Y = target.ctrl;
    const defenders = this.isPower(Y) ? this.defendersAt(target.id, Y) : [];
    enemyOffensive.call(this, src, target);
    defenders.forEach(a => { if (a.divs > 0) this.gainXp(a, 0.5); });
  };
  // Сила атаки и обороны
  const armyGroup = Combat.armyGroup;
  Combat.armyGroup = function (armies, targetId, air) {
    const g = armyGroup.call(this, armies, targetId, air);
    g.cmd = Game.groupCommand(armies);
    return g;
  };
  const attackBreakdown = Combat.attackBreakdown;
  Combat.attackBreakdown = function (target, g, fromLoc) {
    const r = attackBreakdown.call(this, target, g, fromLoc);
    if (g.cmd) {
      const k1 = 1 + 0.04 * g.cmd.skills.atk, k2 = g.cmd.vet.k;
      r.lines.push({ label: `Генерал ${g.cmd.general}: атака ${g.cmd.skills.atk}`, mult: k1 });
      if (k2 !== 1) r.lines.push({ label: `Опыт: ${g.cmd.vet.name.toLowerCase()}`, mult: k2 });
      r.mult *= k1 * k2;
      r.total = r.base * r.mult;
    }
    return r;
  };
  const powerDefense = Combat.powerDefense;
  Combat.powerDefense = function (target, Y, divsOverride) {
    const r = powerDefense.call(this, target, Y, divsOverride);
    const cmd = Game.groupCommand(Game.defendersAt(target.id, Y));
    if (cmd) {
      const k1 = 1 + 0.04 * cmd.skills.def, k2 = cmd.vet.k;
      r.lines.push({ label: `Генерал ${cmd.general}: оборона ${cmd.skills.def}`, mult: k1 });
      if (k2 !== 1) r.lines.push({ label: `Опыт: ${cmd.vet.name.toLowerCase()}`, mult: k2 });
      r.mult *= k1 * k2;
      r.total = r.base * r.mult;
    }
    return r;
  };
})();
