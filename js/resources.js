'use strict';
/* ============================================================
   РЕСУРСЫ И ТОРГОВЛЯ.

   Четыре стратегических ресурса добываются в регионах (по реальной
   добыче стран на 2018 год). Державе они нужны:
     нефть   — армии: без неё слабеет наступление;
     газ     — промышленности и энергетике: без него падает доход ПВ;
     сталь   — военным заводам: без неё дольше обучаются дивизии;
     редкие металлы — науке: без них медленнее исследования.
   Нехватку закрывают импортом: контракт с ИИ-страной или другой
   державой стоит ПВ каждый день. Излишки сами уходят на мировой рынок.
   Эмбарго и санкции закрывают рынки.
   ============================================================ */

const RES = {
  oil:   { name: 'Нефть', short: 'нефть', color: '#d9a441', icon: 'i-oil' },
  gas:   { name: 'Газ', short: 'газ', color: '#6fb7ff', icon: 'i-gas' },
  steel: { name: 'Сталь', short: 'сталь', color: '#aab4c0', icon: 'i-steel' },
  rare:  { name: 'Редкие металлы', short: 'редкие металлы', color: '#c58bff', icon: 'i-rare' }
};
const RES_KEYS = Object.keys(RES);

// Добыча по странам (условные единицы; ~ реальные доли мира в 2018)
const RES_DATA = {
  USA: { oil: 13, gas: 12, steel: 3, rare: 1 }, RUS: { oil: 11, gas: 11, steel: 3, rare: 1 }, CHN: { oil: 4, gas: 2, steel: 30, rare: 8 },
  SAU: { oil: 12, gas: 2 }, IRQ: { oil: 5 }, IRN: { oil: 5, gas: 3, steel: 1 }, CAN: { oil: 5, gas: 3, steel: 1, rare: 1 },
  ARE: { oil: 4, gas: 1 }, KWT: { oil: 3 }, QAT: { oil: 2, gas: 3 }, BRA: { oil: 3, steel: 4, rare: 1 }, NOR: { oil: 2, gas: 2 },
  MEX: { oil: 2, steel: 1 }, KAZ: { oil: 2, gas: 1, steel: 1, rare: 1 }, NGA: { oil: 2, gas: 1 }, AGO: { oil: 2 }, VEN: { oil: 2 },
  DZA: { oil: 1, gas: 2 }, LBY: { oil: 1 }, GBR: { oil: 1, gas: 1, steel: 1 }, AZE: { oil: 1, gas: 1 }, OMN: { oil: 1, gas: 1 },
  COL: { oil: 1 }, IDN: { oil: 1, gas: 1, rare: 1 }, EGY: { oil: 1, gas: 1 }, MYS: { oil: 1, gas: 1 }, IND: { oil: 1, steel: 4, rare: 1 },
  ECU: { oil: 1 }, TKM: { gas: 2 }, UZB: { gas: 1 }, AUS: { gas: 2, steel: 5, rare: 2 }, NLD: { gas: 1 }, ARG: { gas: 1, rare: 1 },
  UKR: { gas: 1, steel: 1 }, JPN: { steel: 4 }, KOR: { steel: 3 }, DEU: { steel: 2 }, TUR: { steel: 2 }, ITA: { steel: 1 },
  FRA: { steel: 1 }, ESP: { steel: 1 }, POL: { steel: 1 }, SWE: { steel: 1 }, ZAF: { steel: 1, rare: 2 }, VNM: { steel: 1, rare: 1 },
  TWN: { steel: 1 }, MMR: { rare: 1 }, COD: { rare: 2 }, CHL: { rare: 2 }, PER: { rare: 1 }, BOL: { rare: 1 }, MNG: { rare: 1 },
  ZMB: { rare: 1 }, SDN: { oil: 1 }, SYR: { oil: 1 }, ROU: { gas: 1 }, BLR: { steel: 1 }
};

// Реальные месторождения: страна → регион → добыча (остаток ресурса страны распределяется сам)
const RES_PLACE = {
  RUS: { 'Ханты-Мансийск': { oil: 5 }, 'Ямал': { gas: 6, oil: 1 }, 'Поволжье': { oil: 2 }, 'Коми': { oil: 1 }, 'Западная Сибирь': { oil: 1, gas: 1 },
    'Сахалин': { oil: 1, gas: 1 }, 'Урал': { steel: 2, gas: 1 }, 'Таймыр': { rare: 1 }, 'Юг России': { gas: 1 }, 'Красноярский край': { gas: 1, steel: 1 }, 'Якутия': { gas: 1 } },
  USA: { 'Техас': { oil: 6, gas: 4 }, 'Великие равнины': { oil: 3, gas: 1 }, 'Луизиана': { oil: 1, gas: 2 }, 'Аляска': { oil: 2 }, 'Пенсильвания': { gas: 3, steel: 1 },
    'Колорадо': { gas: 1, oil: 1 }, 'Огайо': { steel: 1 }, 'Иллинойс': { steel: 1 }, 'Невада': { rare: 1 }, 'Калифорния': { gas: 1 } },
  CHN: { 'Маньчжурия': { oil: 2, steel: 4 }, 'Синьцзян': { oil: 1, gas: 1 }, 'Сычуань': { gas: 1, steel: 2 }, 'Шаньдун': { oil: 1, steel: 3 }, 'Внутренняя Монголия': { rare: 5, steel: 3 },
    'Ляонин': { steel: 5 }, 'Хэнань': { steel: 3 }, 'Хубэй': { steel: 3 }, 'Шанхай': { steel: 2 }, 'Гуандун': { steel: 2 }, 'Цзянси': { rare: 1 }, 'Гуанси': { rare: 1 }, 'Юньнань': { rare: 1 }, 'Шэньси': { steel: 1 }, 'Фуцзянь': { steel: 1, rare: 1 } },
  SAU: { 'Восточная провинция': { oil: 10, gas: 2 }, 'Эр-Рияд': { oil: 2 } },
  IRN: { 'Хузестан': { oil: 4 }, 'Фарс': { gas: 2, oil: 1 }, 'Исфахан': { steel: 1 }, 'Хорасан': { gas: 1 } },
  IRQ: { 'Ирак: юго-восток': { oil: 4 }, 'Ирак: север': { oil: 1 } },
  CAN: { 'Альберта': { oil: 4, gas: 3 }, 'Прерии': { oil: 1 }, 'Онтарио': { steel: 1, rare: 1 } },
  KAZ: { 'Атырау': { oil: 1, gas: 1 }, 'Мангистау': { oil: 1 }, 'Караганда': { steel: 1 }, 'Восточный Казахстан': { rare: 1 } },
  UKR: { 'Днепропетровщина': { steel: 1 }, 'Полтавщина': { gas: 1 } },
  AUS: { 'Западная Австралия': { steel: 4, gas: 2, rare: 1 }, 'Квинсленд': { steel: 1 }, 'Северная территория': { rare: 1 } },
  BRA: { 'Рио-де-Жанейро': { oil: 3 }, 'Минас-Жерайс': { steel: 2, rare: 1 }, 'Пара': { steel: 2 } },
  IND: { 'Одиша': { steel: 2, rare: 1 }, 'Махараштра': { steel: 1, oil: 1 }, 'Карнатака': { steel: 1 } },
  NOR: { 'Западная Норвегия': { oil: 2, gas: 2 } },
  MEX: { 'Юкатан': { oil: 2 }, 'Нуэво-Леон': { steel: 1 } },
  VEN: { 'Венесуэла: запад': { oil: 1 }, 'Венесуэла: восток': { oil: 1 } },
  NGA: { 'Нигерия: юг': { oil: 2, gas: 1 } },
  DZA: { 'Алжир: юго-восток': { oil: 1, gas: 2 } },
  TKM: { 'Туркмения: юго-восток': { gas: 2 } },
  LBY: { 'Ливия: северо-восток': { oil: 1 } },
  CHL: { 'Чили: север': { rare: 2 } },
  COD: { 'ДР Конго: юго-восток': { rare: 2 } },
  ZAF: { 'ЮАР: северо-восток': { rare: 1, steel: 1 }, 'ЮАР: северо-запад': { rare: 1 } }
};

const Resources = {
  byRegion: {},       // id региона → { oil, gas, steel, rare }
  // Детерминированное «месторождение»: одинаково на сервере и у всех игроков
  hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; },
  build() {
    this.byRegion = {};
    const byC = {};
    for (const r of Regions.list) (byC[r.cid] || (byC[r.cid] = [])).push(r);
    for (const [cid, data] of Object.entries(RES_DATA)) {
      const regs = byC[cid];
      if (!regs) continue;
      for (const k of RES_KEYS) {
        let total = data[k];
        if (!total) continue;
        // Сначала — известные месторождения
        const place = RES_PLACE[cid] || {};
        for (const r of regs) {
          const v = place[r.name] && place[r.name][k];
          if (!v) continue;
          const take = Math.min(v, total);
          if (take > 0) { (this.byRegion[r.id] || (this.byRegion[r.id] = {}))[k] = take; total -= take; }
        }
        if (total <= 0) continue;
        // Месторождения сосредоточены: вес — площадь и случайный «геологический» множитель
        const w = regs.map(r => Math.sqrt(r.area || 1) * Math.pow(0.15 + this.hash(r.id + k), 3));
        const sum = w.reduce((s, x) => s + x, 0) || 1;
        const raw = w.map(x => total * x / sum);
        const out = raw.map(Math.floor);
        let left = total - out.reduce((s, x) => s + x, 0);
        raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => out[i]++);
        regs.forEach((r, i) => { if (out[i]) { const o = this.byRegion[r.id] || (this.byRegion[r.id] = {}); o[k] = (o[k] || 0) + out[i]; } });
      }
    }
  },
  of(id) { return this.byRegion[id] || null; }
};

const TRADE = {
  price: 0.12,        // ПВ в день за единицу по контракту
  allyPrice: 0.08,    // для стран своего блока
  market: 0.02,       // ПВ в день за единицу излишков на мировом рынке
  marketCap: 0.45,    // потолок дохода с рынка
  shortK: { oil: 0.35, gas: 0.25, steel: 0.5, rare: 0.4 }
};

Object.assign(Game, {
  /* ---------- Добыча и потребность ---------- */
  regionRes(r) { return r.radioactive ? null : Resources.of(r.id); },
  sumRes(regions) {
    const o = { oil: 0, gas: 0, steel: 0, rare: 0 };
    for (const r of regions) { const x = this.regionRes(r); if (x) for (const k in x) o[k] += x[k]; }
    return o;
  },
  resNeed(tag) {
    const P = this.P(tag), F = this.playerFactories(tag), D = this.totalDivs(tag);
    const train = P.training.reduce((s, t) => s + t.count, 0);
    return {
      oil: 1 + D * 0.07,
      gas: F * 0.03,
      steel: F * 0.05 + train * 0.2,
      rare: 0.4 + F * 0.012 + P.research.length * 0.3
    };
  },
  // Сводка по державе (кэш на день): добыча, импорт, экспорт по контрактам, потребность, нехватка 0..1
  resBalance(tag = this.cur) {
    const S = this.S;
    const key = S.day + '|' + (S.tradeSeq || 0) + '|' + this.lands(tag).length;
    this._rb = this._rb || {};
    const hit = this._rb[tag];
    if (hit && hit.key === key) return hit.v;
    const prod = this.sumRes(this.lands(tag)), need = this.resNeed(tag);
    const v = {};
    for (const k of RES_KEYS) {
      const imp = this.contracts().filter(t => t.buyer === tag && t.res === k).reduce((s, t) => s + t.n, 0);
      const exp = this.contracts().filter(t => t.seller === tag && t.res === k).reduce((s, t) => s + t.n, 0);
      const have = prod[k] + imp - exp;
      const short = need[k] > 0 ? U.clamp(1 - have / need[k], 0, 1) : 0;
      v[k] = { prod: prod[k], imp, exp, need: need[k], have, short, surplus: Math.max(0, have - need[k]) };
    }
    this._rb[tag] = { key, v };
    return v;
  },
  resShort(k, tag = this.cur) { return this.P(tag) ? this.resBalance(tag)[k].short : 0; },
  // Множитель скорости/силы от нехватки: 1 — всё в порядке
  resK(k, tag = this.cur) { return 1 - TRADE.shortK[k] * this.resShort(k, tag); },

  /* ---------- Торговые партнёры ---------- */
  contracts() { return this.S.trade || (this.S.trade = []); },
  underSanctions(tag) { return (this.P(tag).spirits || []).some(x => x.id === 'war_sanctions'); },
  embargoed(seller, buyer) {
    // Эмбарго держав: сама держава и страны её блока не торгуют с целью
    const sellerPower = this.isPower(seller) ? seller : POWER_TAGS.find(t => this.isPower(t) && this.isAlly(this.c(seller), t));
    if (sellerPower && (this.P(sellerPower).embargo || {})[buyer]) return true;
    if (this.isPower(seller) && (this.P(buyer).embargo || {})[seller]) return true;
    return false;
  },
  // Почему страна (или держава) не продаёт нам; null — продаёт
  tradeBlock(sellerId, tag = this.cur) {
    if (sellerId === tag) return 'Это мы';
    if (this.isPower(sellerId)) {
      if (this.P(sellerId).out) return 'Держава выбыла';
      if (this.powersAtWar(sellerId, tag)) return 'Идёт война';
    } else {
      const N = this.c(sellerId);
      if (!N || N.ctrl !== N.id || N.inert) return 'Нет независимого правительства';
      if (N.wars[tag]) return 'Идёт война';
      if (N.capitulated) return 'Страна капитулировала';
      if (N.faction === 'WEST' && this.underSanctions(tag)) return 'Санкции Запада';
      const enemyPower = POWER_TAGS.find(t => t !== tag && this.isPower(t) && this.isAlly(N, t) && this.powersAtWar(t, tag));
      if (enemyPower) return `Союзник противника (${POWERS[enemyPower].name})`;
      const hostile = ['WEST', 'COM', 'AXIS', 'GUAM'].includes(N.faction) && !POWERS[tag].family.includes(N.faction) && this.S.tension >= 75;
      if (hostile) return 'Враждебный блок при напряжённости ≥ 75%';
    }
    if (this.embargoed(sellerId, tag)) return 'Эмбарго';
    return null;
  },
  // Сколько единицы ресурса продавец ещё может продать
  sellerFree(sellerId, k) {
    const sold = this.contracts().filter(t => t.seller === sellerId && t.res === k).reduce((s, t) => s + t.n, 0);
    if (this.isPower(sellerId)) {
      const b = this.resBalance(sellerId)[k];
      const f = b.prod + b.imp - b.need - sold;
      return f < 0 ? Math.ceil(f) : Math.floor(f);
    }
    const N = this.c(sellerId);
    const prod = this.sumRes(this.heldRegions(N))[k];
    return Math.floor(prod * 0.8) - sold;
  },
  tradePrice(sellerId, tag = this.cur) {
    if (!this.isPower(sellerId) && this.isAlly(this.c(sellerId), tag)) return TRADE.allyPrice;
    return TRADE.price;
  },
  tradePartners(k, tag = this.cur) {
    const out = [];
    for (const t of this.alive()) {
      if (t === tag) continue;
      const free = this.sellerFree(t, k);
      if (free > 0) out.push({ id: t, name: POWERS[t].name, power: true, free, price: this.tradePrice(t, tag), why: this.tradeBlock(t, tag) });
    }
    this.eachCountry(N => {
      if (N.ctrl !== N.id || N.inert) return;
      const free = this.sellerFree(N.id, k);
      if (free > 0) out.push({ id: N.id, name: N.name, power: false, free, price: this.tradePrice(N.id, tag), why: this.tradeBlock(N.id, tag), ally: this.isAlly(N, tag) });
    });
    return out.sort((a, b) => (!!a.why - !!b.why) || (a.price - b.price) || (b.free - a.free));
  },

  /* ---------- Действия игрока ---------- */
  canBuy(sellerId, k, n = 1) {
    if (this.outReason()) return this.outReason();
    if (!RES[k]) return 'Нет такого ресурса';
    const why = this.tradeBlock(sellerId);
    if (why) return why;
    if (this.sellerFree(sellerId, k) < n) return 'У продавца нет столько';
    if (this.P().pp < 5) return 'Нужно хотя бы 5 ПВ';
    return null;
  },
  buyRes(sellerId, k, n = 1) {
    n = Math.max(1, Math.min(10, Math.round(n)));
    const why = this.canBuy(sellerId, k, n);
    if (why) return this.fail(why);
    const S = this.S, X = this.cur;
    const price = this.tradePrice(sellerId);
    const ex = this.contracts().find(t => t.buyer === X && t.seller === sellerId && t.res === k);
    if (ex) ex.n += n;
    else this.contracts().push({ id: 'tr' + (S.tradeSeq = (S.tradeSeq || 0) + 1), buyer: X, seller: sellerId, res: k, n, price, since: S.day });
    S.tradeSeq = (S.tradeSeq || 0) + 1;
    const name = this.isPower(sellerId) ? POWERS[sellerId].name : this.c(sellerId).name;
    this.log('dip', 'Торговый контракт', `Закупка: ${RES[k].short}, ${n} ед. Продавец: ${name}. Цена: ${U.fmt(price * n, 2)} ПВ в день.`, this.isPower(sellerId) ? null : sellerId);
    if (this.isPower(sellerId)) this.log('dip', 'Экспорт', `${POWERS[X].name} закупает у нас: ${RES[k].short}, ${n} ед. Доход: ${U.fmt(price * n, 2)} ПВ в день.`, null, sellerId);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Контракт заключён: ${RES[k].short} +${n}` };
  },
  cancelTrade(id) {
    const S = this.S, t = this.contracts().find(x => x.id === id);
    if (!t || (t.buyer !== this.cur && t.seller !== this.cur)) return this.fail('Контракт не найден');
    if (t.n > 1 && t.buyer === this.cur) t.n--;
    else S.trade = this.contracts().filter(x => x !== t);
    S.tradeSeq = (S.tradeSeq || 0) + 1;
    Bus.emit('stateChanged');
    return { ok: true };
  },
  canEmbargo(tag) {
    if (this.outReason()) return this.outReason();
    if (!this.isPower(tag) || tag === this.cur) return 'Только против другой державы';
    return null;
  },
  toggleEmbargo(tag) {
    const why = this.canEmbargo(tag);
    if (why) return this.fail(why);
    const P = this.P(), X = this.cur;
    P.embargo = P.embargo || {};
    if (P.embargo[tag]) {
      delete P.embargo[tag];
      this.log('dip', 'Эмбарго снято', `Торговля с державой «${POWERS[tag].name}» возобновлена.`);
      this.news('Эмбарго снято', `${POWERS[X].name} возобновляет торговлю с державой «${POWERS[tag].name}».`, null);
    } else {
      P.embargo[tag] = true;
      this.addTension(2);
      // Контракты с целью эмбарго разорваны
      this.S.trade = this.contracts().filter(t => !((t.buyer === tag && (t.seller === X || this.embargoed(t.seller, tag))) || (t.buyer === X && t.seller === tag)));
      this.log('dip', 'Эмбарго', `Наш блок прекращает торговлю с державой «${POWERS[tag].name}».`);
      this.news('Торговое эмбарго', `${POWERS[X].name} и союзники объявляют эмбарго державе «${POWERS[tag].name}».`, null, 'world');
    }
    this.S.tradeSeq = (this.S.tradeSeq || 0) + 1;
    Bus.emit('stateChanged');
    return { ok: true };
  },

  /* ---------- Ежедневно: оплата контрактов, рынок излишков ---------- */
  tickTrade() {
    const S = this.S;
    const keep = [];
    for (const t of this.contracts()) {
      const B = this.P(t.buyer);
      const why = !B || B.out ? 'out' : this.tradeBlock(t.seller, t.buyer);
      const short = !why && this.sellerFree(t.seller, t.res) < 0;
      const cost = t.price * t.n;
      if (why || short || B.pp < cost) {
        if (B && !B.out) {
          const name = this.isPower(t.seller) ? POWERS[t.seller].name : (this.c(t.seller) || {}).name;
          const reason = why || (short ? 'продавец больше не может поставлять' : 'не хватает ПВ на оплату');
          this.log('alert', 'Контракт разорван', `Поставки (${RES[t.res].short}, ${t.n} ед.) от продавца «${name}» прекращены: ${reason[0].toLowerCase() + reason.slice(1)}.`, null, t.buyer);
        }
        S.tradeSeq = (S.tradeSeq || 0) + 1;
        continue;
      }
      B.pp -= cost;
      if (this.isPower(t.seller)) this.P(t.seller).pp += cost;
      keep.push(t);
    }
    S.trade = keep;
    // Излишки уходят на мировой рынок (под санкциями — вдвое дешевле)
    for (const tag of this.alive()) {
      const b = this.resBalance(tag);
      let inc = 0;
      for (const k of RES_KEYS) inc += b[k].surplus * TRADE.market;
      inc = Math.min(TRADE.marketCap, inc) * (this.underSanctions(tag) ? 0.5 : 1);
      this.P(tag).pp += inc;
      this.P(tag).market = Math.round(inc * 100) / 100;
    }
  }
});
