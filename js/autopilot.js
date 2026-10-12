'use strict';
/* ============================================================
   АВТОПИЛОТ: ИИ ведёт державу игрока.
   Включается скрытой командой в консоли (клавиша Ё / `).
   Флаг хранится в Game.autopilot — вне Game.S, поэтому не попадает
   ни в сохранения, ни в данные, которые сервер рассылает другим игрокам.

   Что делает ИИ:
   — сразу решает события, выбирая самый выгодный вариант;
   — держит оба научных отдела занятыми, ведёт фокусы, сохраняя курс;
   — следит за популярностью власти и выборами;
   — формирует дивизии, собирает армии, держит фронт и наступает
     только там, где расчёт обещает победу;
   — в мирное время выбирает слабого нейтрального соседа и расширяется;
   — переманивает в блок страны с близкой идеологией.
   На другие державы-игроков сам не нападает и ядерное оружие не применяет.
   ============================================================ */

const Bot = {
  mem: {},                                   // память бота по державам (тоже вне Game.S)
  M() { return this.mem[Game.cur] || (this.mem[Game.cur] = { target: null, lastExpand: -999, lastPeace: -999 }); },

  /* ---------- Оценка варианта события по его подсказке ---------- */
  num(s) { return parseFloat(String(s).replace(',', '.')); },
  sign(ch) { return ch === '+' ? 1 : -1; },
  scoreTip(tip) {
    let s = 0;
    const each = (re, fn) => { for (const m of tip.matchAll(re)) fn(m); };
    each(/([+−-])(\d+(?:,\d+)?) ПВ( в день)?/g, m => { const v = this.num(m[2]); s += this.sign(m[1]) * (m[3] || v < 1 ? v * 150 : v); });
    each(/([+−-])(\d+) завод/g, m => { s += this.sign(m[1]) * this.num(m[2]) * 14; });
    each(/([+−-])(\d+) ОИ/g, m => { s += this.sign(m[1]) * this.num(m[2]) * 0.4; });
    each(/([+−-])(\d+) див/g, m => { if (!/(КНДР|Армения|Украина|Израиль|Австралия|Тайвань|Афганистан|Таджикистан|страна) \+/.test(tip)) s += this.sign(m[1]) * this.num(m[2]) * 4; });
    each(/напряжённость ([+−-])(\d+)/gi, m => { s -= this.sign(m[1]) * this.num(m[2]) * (Game.S.tension > 60 ? 2.5 : 1.2); });
    each(/популярность власти ([+−-])(\d+)/g, m => { s += this.sign(m[1]) * this.num(m[2]) * 3; });
    each(/([+−-])(\d+)% (призыва|ОИ)/g, m => { s += this.sign(m[1]) * this.num(m[2]) * 0.8; });
    each(/(\d+)%: [^·]*вступает/g, m => { s += this.num(m[1]) * 0.4; });
    if (/повод для войны/i.test(tip)) s += /Украин|Росси/.test(tip) ? -10 : 6;
    // Автопилот не ищет войны с другой державой-игроком: напряжённость Россия — Украина и войну с ней избегает
    each(/Россия — Украина ([+−-])(\d+)/g, m => { s -= this.sign(m[1]) * this.num(m[2]) * 0.8; });
    if (/^Война с /i.test(tip)) s -= 60;
    each(/доверие Запада ([+−-])(\d+)/g, m => { if (Game.cur === 'UA') s += this.sign(m[1]) * this.num(m[2]) * 0.6; });
    if (/Талибы приходят|убрать «Старение/i.test(tip)) s += 4;
    return s;
  },
  bestOption(opts) {
    let best = 0, bs = -Infinity;
    opts.forEach((o, i) => { const v = this.scoreTip(o.tip || '') + Math.random() * 0.5; if (v > bs) { bs = v; best = i; } });
    return best;
  },

  /* ---------- Один день державы ---------- */
  day() {
    const S = Game.S, X = Game.cur, P = Game.P();
    if (!P || P.out) return;
    this.events();
    this.research();
    this.focus();
    this.politics();
    this.mobilize();
    if (S.day % 2 === 0) this.armies();
    if (S.day % 10 === 0) this.diplomacy();
    if (S.day % 15 === 0) this.expand();
    if (S.day % 7 === 3) this.trade();
  },

  /* Торговля: закрыть нехватку ресурсов самым дешёвым импортом, лишние контракты — разорвать */
  trade() {
    if (!Game.resBalance) return;
    const X = Game.cur, P = Game.P();
    const b = Game.resBalance(X);
    for (const k of RES_KEYS) {
      const v = b[k];
      if (v.short > 0.1 && P.pp > 25) {
        const p = Game.tradePartners(k, X).find(x => !x.why);
        if (p) Game.buyRes(p.id, k, Math.min(p.free, Math.ceil(v.need - v.have)));
      } else if (v.have - v.need >= 1.5) {
        const c = Game.contracts().find(t => t.buyer === X && t.res === k);
        if (c) Game.cancelTrade(c.id);
      }
    }
  },

  events() {
    const X = Game.cur;
    for (const [iid, p] of Object.entries(Game.pending)) {
      if (p.power !== X) continue;
      Game.chooseEvent(iid, this.bestOption(p.options || p.def.options));
      Bus.emit('eventClosed', { iid, power: X });
    }
  },

  research() {
    const P = Game.P();
    const order = { industry: 0, armor: 1, nuclear: 2 };
    while (P.research.length < 2) {
      const av = TECHS.filter(t => Game.techState(t) === 'available' && !Game.canResearch(t))
        .sort((a, b) => a.tier - b.tier || order[a.branch] - order[b.branch]);
      if (!av.length || !Game.startResearch(av[0].id).ok) break;
    }
  },

  focus() {
    const P = Game.P();
    if (P.focus) return;
    const ide = Game.powerIde();
    const av = Game.focusTree().filter(f => !Game.canFocus(f));
    if (!av.length) return;
    // На развилке остаёмся на нынешнем курсе (тот же лидер и идеология), если такой путь есть
    const keep = av.find(f => f.fx.gov && f.fx.gov.ide === ide);
    const f = keep || av.filter(f => !f.fx.gov || !keep).sort((a, b) => a.y - b.y || (a.fx.addFactories ? -1 : 0))[0];
    if (f) Game.startFocus(f.id);
  },

  // Власть должна быть популярной, особенно перед выборами
  politics() {
    const P = Game.P(), home = Game.c(Game.def().capital), pol = home && home.pol;
    if (!pol || home.ctrl !== Game.cur) return;
    const left = Game.electionIn(pol), share = pol.pop[pol.ide] || 0;
    const need = left != null && left < 400 ? 58 : 45;
    if (share < need && P.pp > 40 && !Game.canSupport(home, pol.ide)) Game.supportParty(home.id, pol.ide);
    if (left != null && left <= CFG.POL.meddleWindow && share < 60 && P.pp > 60 && !Game.canMeddle(home, pol.ide)) Game.meddle(home.id, pol.ide);
  },

  // Мобилизация: копим резерв из дивизий прорыва и мотострелков
  mobilize() {
    const P = Game.P();
    const training = P.training.reduce((s, t) => s + t.count, 0);
    if (training >= 12 || P.pp < 40) return;
    const total = Game.totalDivs();
    const cap = 40 + Game.playerFactories() * 0.6;
    if (total + training > cap && P.pp < 400) return;
    const tanks = Object.values(P.armies).reduce((s, a) => s + (a.mix.T2 || 0), 0) + (P.rmix.T2 || 0);
    const tpl = Game.tpl('T2') && tanks < total * 0.35 ? 'T2' : (Game.tpl('T3') ? 'T3' : Game.defaultTpl());
    for (const n of [5, 3, 1]) if (!Game.canDeploy(n, tpl)) { Game.deploy(n, tpl); return; }
  },

  /* ---------- Армии: фронт, оборона, наступление ---------- */
  nb(id) { return Regions.nb(id); },
  // Насколько опасен регион: силы врага в соседних регионах
  threat(land) {
    let t = 0;
    for (const n of this.nb(land.id)) {
      const r = Game.r(n);
      if (!r || r.ctrl === Game.cur) continue;
      if (Game.atWar(r)) t += Math.max(2, Game.estDivs(r).mid) * 2;
      else if (Game.isPower(r.ctrl)) t += 3;
    }
    return t;
  },
  armies() {
    const X = Game.cur, P = Game.P();
    // Резерв собираем в армии
    if (P.divs >= 6) {
      const small = P.armies.filter(a => a.divs < 24 && a.loc === Game.capitalRegion(X) && a.order.type === 'hold').sort((a, b) => a.divs - b.divs)[0];
      if (small) Game.reinforceArmy(small.id, Math.min(P.divs, 24 - Math.floor(small.divs)));
      else Game.createArmy(Math.min(P.divs, 24));
    }
    const war = Game.fronts().length > 0;
    const lands = Game.lands().filter(c => !c.radioactive);
    const frontier = lands.filter(c => this.threat(c) > 0);

    // 0) Десант: свободная армия ВДВ высаживается там, где расчёт обещает быстрый успех
    if (war) {
      for (const a of P.armies) {
        if (!Game.isAirborne(a) || a.order.type !== 'hold' || a.org < CFG.AIRBORNE.minOrg || (a.airCd || 0) > Game.S.day) continue;
        let best = null;
        for (const c of Game.regionList()) {
          if (c.ctrl === X || !Game.atWar(c) || Game.canAirdrop(a, c)) continue;
          const est = Combat.estimateArmies(c, [a], true);
          if (est.pWin < 0.65 || est.daysToTake > est.orgDays) continue;
          const v = (c.factories + 1 + (Game.isCapitalRegion(c) ? 6 : 0)) / Math.max(1, est.daysToTake);
          if (!best || v > best.v) best = { c, v };
        }
        if (best) Game.orderAirborne(a.id, best.c.id);
      }
    }

    // 1) Наступления: группа армий на одной земле бьёт по самой выгодной соседней цели
    if (war) {
      const byLoc = {};
      for (const a of P.armies) if (a.order.type === 'hold' && a.org >= 70) (byLoc[a.loc] = byLoc[a.loc] || []).push(a);
      for (const [loc, group] of Object.entries(byLoc)) {
        let best = null;
        for (const n of this.nb(loc)) {
          const c = Game.r(n);
          if (!c || !Game.atWar(c) || Game.canOrderAttack(group[0], c)) continue;
          const est = Combat.estimateArmies(c, group);
          const ok = est.pWin >= 0.55 && est.daysToTake <= est.orgDays + 2;
          const value = (est.pWin * 2 + c.factories * 0.15 + (c.core === X ? 1 : 0) + (Game.isCapitalRegion(c) ? 2 : 0)) / Math.max(1, est.daysToTake / 10);
          if (ok && (!best || value > best.value)) best = { c, value };
        }
        if (best) {
          // Слабая разведка — сначала уточняем силы врага
          const owner = Game.ownerNation(best.c);
          if (owner && Game.intel(owner) < 60 && P.pp > 30 && !Game.canSpy(owner, SPY_OPS[0])) Game.spy(owner.id, 'intel');
          group.forEach(a => Game.orderAttack(a.id, best.c.id));
        }
      }
    }

    // 2) Расстановка: свободные армии идут туда, где угроза больше всего превышает наши силы
    if (!frontier.length) return;
    const ours = id => P.armies.filter(a => a.loc === id || (a.order.type === 'move' && a.order.to === id)).reduce((s, a) => s + a.divs, 0);
    const free = P.armies.filter(a => a.order.type === 'hold' && !a.battle);
    for (const a of free) {
      const here = Game.r(a.loc);
      const hereNeed = here ? this.threat(here) - ours(a.loc) + a.divs : -Infinity;
      if (here && this.threat(here) > 0 && hereNeed > a.divs * 0.5) continue;   // и здесь нужны
      let best = null;
      for (const f of frontier) {
        if (f.id === a.loc) continue;
        const need = this.threat(f) - ours(f.id);
        if (need <= 0) continue;
        const path = Game.armyPath(a.loc, f.id);
        if (!path) continue;
        const v = need / (1 + path.length * 0.5);
        if (!best || v > best.v) best = { f, v };
      }
      if (best) Game.orderMove(a.id, best.f.id);
    }
  },

  /* ---------- Дипломатия и мир ---------- */
  diplomacy() {
    const S = Game.S, X = Game.cur, P = Game.P(), m = this.M();
    const ide = Game.powerIde();
    // Переманиваем нейтралов-единомышленников, интегрируем союзников
    if (P.pp > 90) {
      const cand = Game.list(c => c.faction === 'NEU' && !Game.canInfluence(c))
        .map(c => ({ c, p: Game.influenceChance(c) * (1 + c.factories * 0.15) * (Game.bordersPower(c.id) ? 1.5 : 1) }))
        .sort((a, b) => b.p - a.p)[0];
      if (cand && Game.influenceChance(cand.c) >= 0.5) Game.influence(cand.c.id);
    }
    if (P.pp > 160) {
      const ally = Game.allies().filter(c => !Game.canIntegrate(c)).sort((a, b) => b.factories - a.factories)[0];
      if (ally && S.tension < 70) Game.integrate(ally.id);
    }
    if (P.pp > 120) {
      const c = Game.list(c => c.faction === 'NEU' && c.pol && c.pol.ide !== ide && (c.pol.pop[ide] || 0) >= 25 && !Game.canCoup(c, ide))
        .sort((a, b) => Game.coupChance(b, ide) - Game.coupChance(a, ide))[0];
      if (c && Game.coupChance(c, ide) >= 0.45) Game.coup(c.id, ide);
    }
    // Затяжная безуспешная война с ИИ-страной — предлагаем мир
    for (const c of Game.fronts()) {
      if (Game.isPower(c.ctrl) || c.ctrl !== c.id) continue;
      const lostLand = Game.regionList().filter(t => t.lostFrom === X && t.ctrl === c.id).length;
      if ((lostLand || (c.warDays || 0) > 300) && S.day - m.lastPeace > 60 && !Game.canPeace(c) && Game.peaceChance(c) > 0.3) {
        m.lastPeace = S.day;
        Game.peace(c.id);
      }
    }
    // Укрепляем самые опасные участки
    if (P.pp > 250) {
      const f = Game.lands().filter(c => this.threat(c) > 0 && !Game.canFortify(c)).sort((a, b) => this.threat(b) - this.threat(a))[0];
      if (f && f.fort < 2) Game.fortify(f.id);
    }
  },

  /* ---------- Расширение: слабый нейтральный сосед ---------- */
  armyPower() { return Game.armies().reduce((s, a) => s + a.divs, 0) + Game.P().divs; },
  expand() {
    const S = Game.S, X = Game.cur, P = Game.P(), m = this.M();
    const t = m.target && Game.c(m.target);
    if (t) {
      if (t.ctrl === X || (t.ctrl !== t.id && !Game.atWar(t))) { m.target = null; return; }
      if (Game.justified(t) && !Game.atWar(t)) {
        if (S.tension < 85) Game.declareWar(t.id);
        return;
      }
      if (Game.atWar(t) || Game.justifying(t)) return;
      m.target = null;
    }
    // Не расширяемся, пока идёт тяжёлая война или мир на грани
    const busy = Game.fronts().filter(c => !Game.isPower(c.ctrl)).length;
    if (busy || S.tension > 65 || S.day - m.lastExpand < 120 || P.pp < 80) return;
    const mine = this.armyPower();
    // Соседние государства — владельцы регионов, граничащих с нашими
    const nbIds = new Set(Game.lands().flatMap(r => this.nb(r.id)).map(id => Game.r(id)).filter(r => r && r.ctrl !== X).map(r => r.ctrl));
    const cands = [...nbIds].map(id => Game.c(id)).filter(c => c && c.ctrl === c.id && !c.inert && !c.radioactive &&
      !Game.isPower(c.ctrl) && !Game.isAlly(c) && !c.cb[X] && Game.supplyFactor(c.id) >= 0.8 &&
      // Союзников других держав-игроков не трогаем: это друзья игрока
      !Game.alive().some(t => t !== X && Game.isAlly(c, t)));
    let best = null;
    for (const c of cands) {
      const def = Game.estDivs(c).hi * (FACTION_DEF[c.faction] || 1);
      // Члены чужих блоков опаснее: за них вступятся
      const bloc = BLOCS.includes(c.faction) ? 2.2 : 1;
      if (mine < def * 3 * bloc + 10) continue;
      const v = (c.factories + 1) / (def * bloc + 3) * (c.major ? 0.6 : 1);
      if (!best || v > best.v) best = { c, v };
    }
    if (!best) return;
    if (Game.intel(best.c) < 50 && !Game.canSpy(best.c, SPY_OPS[0])) Game.spy(best.c.id, 'intel');
    if (!Game.canJustify(best.c) && Game.justify(best.c.id).ok) { m.target = best.c.id; m.lastExpand = S.day; }
  }
};

/* ---------------- Подключение к игре ---------------- */
Object.assign(Game, {
  autopilot: {},
  // Включить/выключить автопилот своей державы (без аргумента — переключить)
  setAssist(on) {
    const t = this.cur;
    if (!this.isPower(t)) return this.fail('Нет державы');
    if (on === undefined || on === null) on = !this.autopilot[t];
    if (on) this.autopilot[t] = true; else delete this.autopilot[t];
    return { ok: true, on: !!on };
  },
  tickAutopilot() {
    for (const t of this.alive()) {
      if (!this.autopilot[t]) continue;
      this.as(t, () => { try { Bot.day(); } catch (e) { console.error('[auto]', e); } });
    }
  }
});
