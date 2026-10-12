'use strict';
/* ============================================================
   МИРНЫЕ ДОГОВОРЫ (как в Hearts of Iron IV).

   Очки войны — доля земли противника (с учётом заводов и столицы),
   которую держит победитель, минус то, что противник занял у него.
   Капитуляция даёт 100 очков и созывает мирную конференцию: победитель
   тратит очки на требования. Без капитуляции можно предложить мир на
   условиях — ИИ примет его тем охотнее, чем меньше мы просим.

   Требования:
   — регион: занятый нами дешевле, соседний незанятый — дороже;
   — марионетка: страна вступает в наш блок и уже не может из него выйти;
   — смена режима: к власти приходит наша идеология;
   — репарации: страна год платит нам ПВ;
   — демилитаризация: армия распущена, два года не может вырасти.
   Регионы, которые мы занимали, но не забрали, возвращаются хозяину.
   ============================================================ */

const TREATY = {
  puppet: { name: 'Сделать марионеткой', cost: 45, icon: 'i-flag',
    desc: 'Страна вступает в наш блок и не может из него выйти. Её земли остаются за ней, но работают на нас.' },
  regime: { name: 'Сменить режим', cost: 25, icon: 'i-vote',
    desc: 'К власти приходит правительство нашей идеологии.' },
  reparations: { name: 'Репарации', cost: 15, icon: 'i-pp',
    desc: 'Год страна выплачивает нам политическую власть.' },
  demil: { name: 'Демилитаризация', cost: 15, icon: 'i-shield',
    desc: 'Армия страны распущена и два года не может превышать пятой части довоенной.' }
};

Object.assign(Game, {
  /* ---------- Очки войны ---------- */
  peaceWeight(r) { return 1 + r.factories + (this.isCapitalRegion(r) ? 4 : 0); },

  // Сколько очков X получил в войне с государством N (0–100)
  warScore(X, N) {
    if (!N) return 0;
    if (N.capitulated === X) return 100;
    const own = this.regionsOf(N.id);
    const total = own.reduce((s, r) => s + this.peaceWeight(r), 0) || 1;
    const gain = own.filter(r => r.ctrl === X).reduce((s, r) => s + this.peaceWeight(r), 0);
    const loss = this.regionList().filter(r => r.ctrl === N.id && r.lostFrom === X).reduce((s, r) => s + this.peaceWeight(r), 0);
    return U.clamp(Math.round(100 * (gain - loss) / total), 0, 100);
  },
  // Очки в войне двух держав: занятые регионы противника против потерянных своих
  powerWarScore(X, Y) {
    const w = r => this.peaceWeight(r);
    const total = this.regionList().filter(r => r.core === Y).reduce((s, r) => s + w(r), 0) || 1;
    const gain = this.regionList().filter(r => r.ctrl === X && r.lostFrom === Y).reduce((s, r) => s + w(r), 0);
    const loss = this.regionList().filter(r => r.ctrl === Y && r.lostFrom === X).reduce((s, r) => s + w(r), 0);
    return U.clamp(Math.round(100 * (gain - loss) / total), 0, 100);
  },

  /* ---------- Что можно потребовать ---------- */
  treatyOptions(X, N, cap) {
    const regions = [];
    const ours = new Set(this.lands(X).map(r => r.id));
    for (const r of this.regionList()) {
      const theirs = r.ctrl === N.id;
      const occupied = r.ctrl === X && (r.lostFrom === N.id || (r.cid === N.id && r.core !== X));
      if (!theirs && !occupied) continue;
      if (r.radioactive && !occupied) continue;
      const base = 3 + r.factories * 2 + (this.isCapitalRegion(r) ? 10 : 0);
      let cost;
      if (occupied) cost = base;
      else if (cap) cost = Math.round(base * 1.5);
      else if (Regions.nb(r.id).some(n => ours.has(n))) cost = base * 2;
      else continue;
      regions.push({ id: r.id, name: r.name, factories: r.factories, cost, occupied, capital: this.isCapitalRegion(r) });
    }
    regions.sort((a, b) => (b.occupied - a.occupied) || (b.factories - a.factories));
    const terms = [];
    const alive = N.ctrl === N.id && !N.inert;
    if (alive && !this.isAlly(N, X)) terms.push('puppet');
    if (alive && N.pol && N.pol.ide !== this.powerIde(X)) terms.push('regime');
    if (alive && N.factories >= 2) terms.push('reparations');
    if (alive && !(N.demil > this.S.day)) terms.push('demil');
    return { regions, terms };
  },
  treatyCost(X, N, dem, cap) {
    const o = this.treatyOptions(X, N, cap);
    let sum = 0;
    for (const id of dem.regions || []) { const r = o.regions.find(x => x.id === id); if (!r) return null; sum += r.cost; }
    for (const t of dem.terms || []) { if (!o.terms.includes(t)) return null; sum += TREATY[t].cost; }
    // Забрали все земли — марионетка и прочие условия теряют смысл
    return sum;
  },

  /* ---------- Капитуляция: созывается мирная конференция ---------- */
  capitulate(c, X, opts = {}) {
    if (opts.peaceful || !this.isPower(X) || c.ctrl !== c.id) return this.capitulateAnnex(c, X, opts);
    if (c.capitulated) return 0;
    const S = this.S;
    c.capitulated = X;
    c.divs = 0;
    if (!S.confs) S.confs = [];
    const id = 'pc' + (S.confSeq = (S.confSeq || 0) + 1);
    S.confs.push({ id, X, n: c.id, day: S.day });
    this.addTension(c.major ? 6 : 2);
    this.log('success', 'Капитуляция', `${c.name} капитулирует. Созвана мирная конференция: у нас 100 очков на требования.`, c.id, X);
    this.news(`${c.name} капитулирует`, `Правительство подписывает акт о капитуляции. Державе «${POWERS[X].name}» предстоит продиктовать условия мира.`, c.id, 'war');
    const leaderOf = Object.entries(FACTIONS).find(([, f]) => f.leader === c.id);
    if (leaderOf) {
      this.eachCountry(t => { if (t.faction === leaderOf[0] && t.ctrl === t.id) t.divs *= 0.8; });
      this.log('alert', 'Блок обезглавлен', `Лидер блока «${FACTIONS[leaderOf[0]].name}» повержен. Армии его союзников деморализованы: −20% дивизий.`, null, null);
    }
    Bus.emit('peaceConf', { id, power: X, n: c.id });
    Bus.emit('mapDirty');
    return 0;
  },
  myConf(tag = this.cur) { return (this.S.confs || []).find(f => f.X === tag) || null; },

  // Победитель диктует условия после капитуляции
  signTreaty(confId, dem = {}) {
    const S = this.S, X = this.cur;
    const cf = (S.confs || []).find(f => f.id === confId && f.X === X);
    if (!cf) return this.fail('Конференция уже завершена');
    const N = this.c(cf.n);
    const cost = this.treatyCost(X, N, dem, true);
    if (cost == null) return this.fail('Условия больше недоступны');
    if (cost > 100) return this.fail('Не хватает очков войны');
    S.confs = S.confs.filter(f => f !== cf);
    this.applyTreaty(X, N, dem, 'conference');
    return { ok: true, msg: 'Мирный договор подписан' };
  },

  /* ---------- Мир на условиях (без капитуляции) ---------- */
  canProposeTreaty(c) {
    const why = this.canPeace(c);
    if (why) return why;
    if (this.powerOf(c)) return null;
    const N = this.peaceTarget(c);
    if (!N || N.capitulated) return 'Страна уже капитулировала';
    return null;
  },
  treatyChance(N, cost, score) {
    const base = this.peaceChance(N);
    if (!cost) return base;
    if (cost > score) return 0;
    return U.clamp(base * (1 - 0.6 * cost / Math.max(score, 1)) + (score >= 60 ? 0.15 : 0), 0.03, 0.9);
  },
  proposeTreaty(id, dem = {}) {
    const S = this.S, X = this.cur;
    const c = this.c(id) || this.ownerNation(this.r(id));
    const why = this.canProposeTreaty(c);
    if (why) return this.fail(why);
    const Y = this.powerOf(c);
    if (Y) return this.proposePowerTreaty(Y, dem);
    const N = this.peaceTarget(c);
    const cost = this.treatyCost(X, N, dem, false);
    const score = this.warScore(X, N);
    if (cost == null) return this.fail('Условия недоступны');
    if (cost > score) return this.fail('Требования превышают очки войны');
    this.P().pp -= CFG.PEACE_PP;
    if (!U.chance(this.treatyChance(N, cost, score))) {
      this.log('dip', 'Условия отвергнуты', `Противник отказался подписать мир на наших условиях. Страна: ${N.name}.`, N.id);
      Bus.emit('stateChanged');
      return { ok: true, msg: 'Противник отверг условия', warn: true };
    }
    this.applyTreaty(X, N, dem, 'negotiated');
    return { ok: true, msg: 'Мирный договор подписан' };
  },

  /* ---------- Мир между державами-игроками ---------- */
  powerTreatyOptions(X, Y) {
    return this.regionList().filter(r => r.ctrl === X && r.lostFrom === Y)
      .map(r => ({ id: r.id, name: r.name, factories: r.factories, cost: 3 + r.factories * 2 + (r.id === this.capitalRegion(Y) ? 10 : 0), occupied: true }));
  },
  proposePowerTreaty(Y, dem = {}) {
    const X = this.cur;
    const opts = this.powerTreatyOptions(X, Y);
    const regions = (dem.regions || []).filter(id => opts.some(o => o.id === id));
    const reps = !!(dem.terms || []).includes('reparations');
    const cost = regions.reduce((s, id) => s + opts.find(o => o.id === id).cost, 0) + (reps ? TREATY.reparations.cost : 0);
    if (cost > this.powerWarScore(X, Y)) return this.fail('Требования превышают очки войны');
    this.P().pp -= CFG.PEACE_PP;
    const names = regions.map(id => this.r(id).name);
    const terms = (names.length ? `уступить регионы: ${names.join(', ')}` : 'границы остаются как есть') + (reps ? '; год выплачивать репарации' : '');
    this.popup({
      id: 'sys_peace_offer', art: 'i-flag', cat: 'dip', title: 'Предложение о мире',
      text: `${this.leaderTitle(X)} ${this.leaderOf(X)} предлагает мир. Условия: ${terms}.`,
      options: [
        { label: 'Принять мир', tip: names.length ? `Потеря регионов: ${names.length}` : 'Война окончена · напряжённость −5',
          fx: () => this.applyPowerTreaty(X, Y, regions, reps) },
        { label: 'Отвергнуть', tip: 'Война продолжается', fx: () => this.log('dip', 'Мир отвергнут', `Противник (${POWERS[Y].name}) отверг наши условия.`, null, X) }
      ]
    }, {}, Y);
    this.log('dip', 'Мирное предложение отправлено', `Ждём ответа противника: ${POWERS[Y].name}.`);
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Предложение отправлено противнику' };
  },
  applyPowerTreaty(X, Y, regions, reps) {
    const k = this.pairKey(X, Y);
    if (!this.S.pwars[k]) return;
    for (const id of regions) { const r = this.r(id); if (r && r.ctrl === X) r.lostFrom = null; }
    this.makePowerPeace(X, Y);
    if (reps) this.addReparations(X, Y, Math.max(0.3, this.playerFactories(Y) * 0.01));
    if (regions.length) this.news('Территориальные уступки', `По мирному договору к державе «${POWERS[X].name}» отходят регионы: ${regions.map(id => this.r(id).name).join(', ')}.`, null, 'war');
  },

  /* ---------- Исполнение договора ---------- */
  applyTreaty(X, N, dem, how) {
    const S = this.S;
    const taken = new Set(dem.regions || []);
    const terms = dem.terms || [];
    const names = [];
    // 1. Отходящие регионы
    for (const id of taken) {
      const r = this.r(id);
      if (!r) continue;
      if (r.ctrl !== X) this.transferRegion(r, X, { peaceful: true });
      r.lostFrom = null;
      names.push(r.name);
    }
    // 2. Остальные занятые земли возвращаются; наши, занятые противником, — нам
    for (const r of this.regionList()) {
      if (r.ctrl === X && r.lostFrom === N.id && !taken.has(r.id)) this.transferRegion(r, N.id, { peaceful: true });
      else if (r.ctrl === X && r.cid === N.id && r.core !== X && !taken.has(r.id) && r.lostFrom) this.transferRegion(r, N.id, { peaceful: true });
      else if (r.ctrl === N.id && r.lostFrom === X) this.transferRegion(r, X, { peaceful: true });
    }
    delete N.wars[X];
    N.warDays = 0;
    N.capitulated = null;
    if (taken.size) this.addTension(Math.min(8, taken.size * 0.6));
    else this.addTension(-5);
    // 3. Страна исчезла целиком
    if (!this.heldRegions(N).length) {
      this.annexNation(N, X, { peaceful: true });
      this.P(X).stats.annexed++;
      this.log('success', 'Мирный договор', `${N.name} полностью входит в состав державы. Получено регионов: ${names.length}.`, N.id, X);
      this.news(`${N.name} прекращает существование`, `По мирному договору все земли страны отходят державе «${POWERS[X].name}».`, N.id, 'war');
      Bus.emit('treaty', { power: X, n: N.id, regions: names, terms: [], annexed: true });
      Bus.emit('mapDirty');
      Bus.emit('stateChanged');
      this.checkEnd();
      return;
    }
    if (how === 'conference') N.divs = Math.max(N.divs, N.baseDivs * 0.3);
    // 4. Прочие условия
    const done = [];
    if (terms.includes('puppet')) {
      for (const t of this.tags()) if (t !== X && N.wars[t]) delete N.wars[t];
      this.setFaction(N.id, POWERS[X].allyFaction);
      N.puppet = X;
      done.push('марионетка');
    }
    if (terms.includes('regime') && N.pol) {
      const ide = this.powerIde(X);
      if (ide) this.setGov(N, ide, null, 'event', 'Временное правительство');
      done.push('смена режима');
    }
    if (terms.includes('reparations')) {
      this.addReparations(X, N.id, Math.max(0.2, N.factories * 0.06));
      done.push('репарации');
    }
    if (terms.includes('demil')) {
      N.demil = S.day + 730;
      N.divs = Math.min(N.divs, N.baseDivs * 0.2);
      done.push('демилитаризация');
    }
    const parts = [];
    if (names.length) parts.push(`регионы: ${names.join(', ')}`);
    if (done.length) parts.push(done.join(', '));
    const what = parts.length ? parts.join('; ') : 'довоенные границы';
    this.log('dip', 'Мирный договор', `Подписан мир. Сторона договора: ${N.name}. Условия: ${what}.`, N.id, X);
    this.news(`Мир: ${POWERS[X].name} — ${N.name}`, `Стороны подписали договор. Условия: ${what}.`, N.id, 'war');
    Bus.emit('treaty', { power: X, n: N.id, regions: names, terms: done });
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },

  addReparations(X, from, pp) {
    const P = this.P(X);
    if (!P.reparations) P.reparations = [];
    P.reparations.push({ from, pp: Math.round(pp * 100) / 100, days: 365 });
  },

  /* ---------- Ежедневно: репарации и забытые конференции ---------- */
  tickTreaties() {
    const S = this.S;
    for (const tag of this.alive()) {
      const P = this.P(tag);
      if (!P.reparations || !P.reparations.length) continue;
      for (const rp of P.reparations) { P.pp += rp.pp; rp.days--; }
      P.reparations = P.reparations.filter(rp => rp.days > 0);
    }
    for (const cf of (S.confs || []).slice()) {
      // Конференцию за ИИ (автопилот, сервер без игрока) и забытую больше 30 дней решает компьютер
      const auto = (this.autopilot && this.autopilot[cf.X]) || S.day - cf.day > 30 || !this.isPower(cf.X) || this.P(cf.X).out;
      if (!auto) continue;
      const N = this.c(cf.n);
      if (!N || this.P(cf.X).out) { S.confs = S.confs.filter(f => f !== cf); if (N) N.capitulated = null; continue; }
      this.as(cf.X, () => this.signTreaty(cf.id, this.autoTreaty(cf.X, N, 100, true)));
    }
  },

  // Разумные требования для ИИ: сначала занятые богатые регионы, на остаток — марионетка или репарации
  autoTreaty(X, N, points, cap) {
    const o = this.treatyOptions(X, N, cap);
    const regions = [];
    let left = points;
    const byValue = o.regions.slice().sort((a, b) => (b.factories + 1 + (b.capital ? 4 : 0)) / b.cost - (a.factories + 1 + (a.capital ? 4 : 0)) / a.cost);
    for (const r of byValue) {
      if (!r.occupied && left - r.cost < TREATY.puppet.cost) continue;
      if (r.cost <= left) { regions.push(r.id); left -= r.cost; }
    }
    const terms = [];
    const remain = o.regions.length - regions.length;
    if (remain > 0) {
      for (const t of ['puppet', 'reparations', 'demil']) {
        if (o.terms.includes(t) && TREATY[t].cost <= left) { terms.push(t); left -= TREATY[t].cost; }
      }
    }
    return { regions, terms };
  }
});

// Прежняя капитуляция (полная аннексия) — для мирного присоединения и случаев без конференции
Game.capitulateAnnex = function (c, X, opts = {}) {
  const wasIndependent = c.ctrl === c.id;
  const keep = this.annexNation(c, X, opts);
  if (!opts.peaceful) this.addTension(c.major ? 8 : 3);
  if (this.isPower(X)) this.P(X).stats.annexed++;
  if (wasIndependent && this.isPower(X) && !opts.peaceful) {
    this.log('success', 'Капитуляция', `${c.name} капитулирует. Земли присоединены, заводов получено: ${keep}.`, c.id, X);
    this.news(`${c.name} капитулирует`, `Страна переходит под контроль державы «${POWERS[X].name}».`, c.id, 'war');
  }
  return keep;
};
