'use strict';
/* ============================================================
   СОЮЗ ДЕРЖАВ-ИГРОКОВ.
   Одна держава предлагает, вторая принимает. Союзники:
   — не могут объявить друг другу войну;
   — получают предложение вступить в каждую войну союзника
     (и могут вступить сами из панели страны);
   — проводят армии по земле друг друга и вместе обороняют её;
   — торгуют по союзной цене и держат общее эмбарго;
   — побеждают вместе: последние державы-союзники или общая доля
     промышленности ≥ 55%.
   ============================================================ */

Object.assign(Game, {
  pacts() { return this.S.palliance || (this.S.palliance = {}); },
  allied(a, b) { return !!a && !!b && a !== b && this.isPower(a) && this.isPower(b) && !!this.pacts()[this.pairKey(a, b)]; },
  alliesOfPower(tag = this.cur) { return this.alive().filter(t => this.allied(tag, t)); },
  // Регион свой или союзной державы
  friendly(r, tag = this.cur) { return !!r && (r.ctrl === tag || this.allied(tag, r.ctrl)); },
  // Армии державы и её союзников в регионе
  defendersAt(locId, tag) { return [tag, ...this.alliesOfPower(tag)].flatMap(t => this.armiesAt(locId, t)); },

  canProposeAlliance(tag) {
    if (this.outReason()) return this.outReason();
    const X = this.cur;
    if (!this.isPower(tag) || tag === X || this.P(tag).out) return 'Только с другой державой';
    if (this.allied(X, tag)) return 'Мы уже союзники';
    if (this.powersAtWar(X, tag)) return 'Сначала заключите мир';
    if (this.P().pp < 30) return 'Нужно 30 ПВ';
    if ((this.S.flags['allyAsk_' + X + tag] || 0) > this.S.day) return 'Ответ ещё не получен';
    return null;
  },
  proposeAlliance(tag) {
    const why = this.canProposeAlliance(tag);
    if (why) return this.fail(why);
    const X = this.cur;
    this.P().pp -= 30;
    this.S.flags['allyAsk_' + X + tag] = this.S.day + 30;
    this.popup({
      id: 'sys_alliance_offer', art: 'i-flag', cat: 'dip', title: 'Предложение союза',
      text: `${this.leaderTitle(X)} ${this.leaderOf(X)} предлагает военный союз. Союзники не воюют друг с другом, вместе обороняют свои земли, проводят армии по территории друг друга, торгуют по союзной цене и побеждают вместе.`,
      options: [
        { label: 'Заключить союз', tip: `Союз с державой «${POWERS[X].name}»`, fx: () => this.formAlliance(X, tag) },
        { label: 'Отказаться', tip: 'Каждый сам за себя', fx: () => this.log('dip', 'Союз отвергнут', `${POWERS[tag].name} отказывается от союза.`, null, X) }
      ]
    }, {}, tag);
    this.log('dip', 'Предложение союза', `Ждём ответа: ${POWERS[tag].name}.`);
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Предложение отправлено' };
  },
  formAlliance(a, b) {
    if (this.allied(a, b) || this.powersAtWar(a, b)) return;
    this.pacts()[this.pairKey(a, b)] = { since: this.S.day };
    delete this.S.flags['allyAsk_' + a + b];
    // Эмбарго друг против друга теряет смысл
    for (const [x, y] of [[a, b], [b, a]]) { const P = this.P(x); if (P.embargo) delete P.embargo[y]; }
    this.log('success', 'Военный союз', `Заключён союз: ${POWERS[a].name} и ${POWERS[b].name}.`, null, null);
    this.news(`Союз: ${POWERS[a].name} и ${POWERS[b].name}`, 'Две великие державы подписывают договор о военном союзе. Мир встревожен.', null, 'world', { hist: 1 });
    this.addTension(5);
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },
  breakAlliance(tag) {
    const X = this.cur;
    if (!this.allied(X, tag)) return this.fail('Союза нет');
    delete this.pacts()[this.pairKey(X, tag)];
    // Бесплатные поставки друг другу прекращаются
    this.S.trade = this.contracts().filter(t => !(t.price === 0 && ((t.buyer === X && t.seller === tag) || (t.buyer === tag && t.seller === X))));
    this.S.tradeSeq = (this.S.tradeSeq || 0) + 1;
    // Армии на земле бывшего союзника возвращаются домой
    for (const [t, other] of [[X, tag], [tag, X]]) {
      for (const a of this.armies(t)) {
        const r = this.r(a.loc);
        if (r && r.ctrl === other) {
          if (a.battle) this.as(t, () => this.finishBattle(a, 'stopped'));
          a.loc = this.capitalRegion(t); a.order = { type: 'hold' };
        }
      }
    }
    this.log('alert', 'Союз расторгнут', `${POWERS[X].name} разрывает союз с державой «${POWERS[tag].name}».`, null, null);
    this.news('Союз расторгнут', `${POWERS[X].name} выходит из союза с державой «${POWERS[tag].name}».`, null, 'world', { hist: 1 });
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* --- Война союзника --- */
  // С кем воюет союзник: ИИ-страны и державы
  allyWars(tag = this.cur) {
    const out = [];
    for (const A of this.alliesOfPower(tag)) {
      this.eachCountry(c => { if (c.ctrl === c.id && c.wars[A] && !c.wars[tag] && !c.capitulated) out.push({ id: c.id, ally: A }); });
      for (const t of this.alive()) if (t !== tag && t !== A && this.powersAtWar(A, t) && !this.powersAtWar(tag, t) && !this.allied(tag, t)) out.push({ id: POWERS[t].capital, ally: A });
    }
    return out;
  },
  canJoinAllyWar(id) {
    if (this.outReason()) return this.outReason();
    const c = this.c(id);
    if (!c) return 'Нет страны';
    if (this.atWar(c)) return 'Мы уже воюем';
    if (!this.allyWars().some(w => w.id === id)) return 'Союзник с ней не воюет';
    const until = this.truceWith && this.truceWith(this.cur, this.powerOf(c) || c.id);
    if (until) return 'Миротворцы ООН: перемирие';
    return null;
  },
  joinAllyWar(id) {
    const why = this.canJoinAllyWar(id);
    if (why) return this.fail(why);
    const c = this.c(id), X = this.cur;
    c.cb[X] = true;                         // повод — союзнический долг
    const res = this.declareWar(id);
    if (res && res.ok !== false) this.log('mil', 'Союзнический долг', `Мы вступаем в войну на стороне союзника. Противник: ${this.powerOf(c) ? POWERS[this.powerOf(c)].name : c.name}.`, id);
    return res;
  },
  // Союзник вступил в войну — предложить присоединиться
  callAllies(X, id) {
    const c = this.c(id);
    if (!c) return;
    const Y = this.powerOf(c);
    for (const A of this.alliesOfPower(X)) {
      if (Y ? this.powersAtWar(A, Y) || this.allied(A, Y) : c.wars[A]) continue;
      const name = Y ? POWERS[Y].name : c.name;
      this.popup({
        id: 'sys_ally_war', art: 'i-swords', cat: 'alert', title: 'Союзник просит помощи',
        text: `${POWERS[X].name} воюет с противником: ${name}. По союзному договору нас просят вступить в войну.`,
        options: [
          { label: 'Вступить в войну', tip: `Война с противником: ${name}`, fx: () => this.joinAllyWar(id) },
          { label: 'Пока воздержаться', tip: 'Вступить можно позже из панели страны', fx: () => {} }
        ]
      }, {}, A);
    }
  }
});

/* --- Помощь союзнику: дивизии, ПВ, ресурсы --- */
Object.assign(Game, {
  canGive(tag) {
    if (this.outReason()) return this.outReason();
    if (!this.allied(this.cur, tag)) return 'Только союзнику';
    if (this.P(tag).out) return 'Союзник выбыл';
    return null;
  },
  giveDivs(tag, n) {
    const why = this.canGive(tag);
    if (why) return this.fail(why);
    const P = this.P(), X = this.cur;
    n = Math.min(Math.round(n), P.divs);
    if (n < 1) return this.fail('Резерв пуст');
    const mix = this.takeReserve(n);
    for (const [id, k] of Object.entries(mix)) this.addReserve(id, k, tag);
    this.log('dip', 'Помощь союзнику', `Союзнику (${POWERS[tag].name}) переданы дивизии: ${n}.`);
    this.log('success', 'Помощь союзника', `${POWERS[X].name} передаёт нам дивизии: ${n}. Они в резерве в столице.`, null, tag);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Передано дивизий: ${n}` };
  },
  givePP(tag, n) {
    const why = this.canGive(tag);
    if (why) return this.fail(why);
    const P = this.P(), X = this.cur;
    n = Math.round(n);
    if (n < 1 || P.pp < n) return this.fail(`Нужно ${n} ПВ`);
    P.pp -= n;
    this.P(tag).pp += n;
    this.log('dip', 'Помощь союзнику', `Союзнику (${POWERS[tag].name}) передано ${n} ПВ.`);
    this.log('success', 'Помощь союзника', `${POWERS[X].name} передаёт нам ${n} ПВ.`, null, tag);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Передано ${n} ПВ` };
  },
  // Бесплатные поставки ресурса союзнику (контракт с нулевой ценой)
  giveRes(tag, k, n = 1) {
    const why = this.canGive(tag);
    if (why) return this.fail(why);
    if (!RES[k]) return this.fail('Нет такого ресурса');
    const X = this.cur, S = this.S;
    if (this.sellerFree(X, k) < n) return this.fail('Нет свободных излишков');
    const ex = this.contracts().find(t => t.buyer === tag && t.seller === X && t.res === k && t.price === 0);
    if (ex) ex.n += n;
    else this.contracts().push({ id: 'tr' + (S.tradeSeq = (S.tradeSeq || 0) + 1), buyer: tag, seller: X, res: k, n, price: 0, since: S.day, gift: true });
    S.tradeSeq = (S.tradeSeq || 0) + 1;
    this.log('dip', 'Поставки союзнику', `Бесплатно поставляем союзнику (${POWERS[tag].name}): ${RES[k].short}, +${n} ед.`);
    this.log('success', 'Поставки союзника', `${POWERS[X].name} бесплатно поставляет нам: ${RES[k].short}, +${n} ед.`, null, tag);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Поставки: ${RES[k].short} +${n}` };
  },
  stopGiveRes(tag, k) {
    const X = this.cur, S = this.S;
    const t = this.contracts().find(t => t.buyer === tag && t.seller === X && t.res === k && t.price === 0);
    if (!t) return this.fail('Поставок нет');
    if (t.n > 1) t.n--; else S.trade = this.contracts().filter(x => x !== t);
    S.tradeSeq = (S.tradeSeq || 0) + 1;
    Bus.emit('stateChanged');
    return { ok: true };
  }
});

/* Встраиваем союз в существующие правила */
(function () {
  const G = Game;
  const canNuke = G.canNuke;
  G.canNuke = function (r) { return r && this.allied(this.cur, r.ctrl) ? 'Это земля союзника' : canNuke.call(this, r); };
  const canDeclare = G.canDeclare;
  G.canDeclare = function (c) {
    const Y = this.powerOf(c);
    if (Y && this.allied(this.cur, Y)) return 'Это наш союзник';
    return canDeclare.call(this, c);
  };
  // Объявили войну мы — зовём союзников; ИИ напал на нас — тоже
  const declareWar = G.declareWar;
  G.declareWar = function (id) {
    const X = this.cur;
    const res = declareWar.call(this, id);
    if (res && res.ok) this.callAllies(X, id);
    return res;
  };
  const aiDeclareWar = G.aiDeclareWar;
  G.aiDeclareWar = function (id, X, reason) {
    const c = this.c(id), before = c && c.wars[X];
    const res = aiDeclareWar.call(this, id, X, reason);
    if (c && !before && c.wars[X]) this.callAllies(X, id);
    return res;
  };
  // Победа союза: остались только союзники, или их общая промышленность ≥ 55%
  const checkEnd = G.checkEnd;
  G.checkEnd = function () {
    checkEnd.call(this);
    const S = this.S;
    if (!S || S.over || S.victoryShown) return;
    const alive = this.alive(), all = this.tags();
    if (alive.length < 2) return;
    const team = alive.every(a => alive.every(b => a === b || this.allied(a, b)));
    if (team && all.length > alive.length) { S.over = null; return this.end('victory', 'alliance', alive[0], alive); }
    for (const tag of alive) {
      const mates = [tag, ...this.alliesOfPower(tag)];
      if (mates.length < 2) continue;
      const share = mates.reduce((s, t) => s + this.industryShare(t), 0);
      if (share >= CFG.VICTORY_SHARE) return this.end('victory', 'allianceIndustry', tag, mates);
    }
  };
  const end = G.end;
  G.end = function (type, reason, winner, allies) {
    end.call(this, type, reason, winner);
    if (this.S.over) this.S.over.allies = allies || (winner && type === 'victory' ? [winner, ...this.alliesOfPower(winner)] : []);
  };
})();
