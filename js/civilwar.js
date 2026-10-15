'use strict';
/* ============================================================
   ГРАЖДАНСКИЕ ВОЙНЫ.
   Если в стране с недемократическим режимом власть почти никто не
   поддерживает, а оппозиция сильна, страна может расколоться:
   дальние от столицы регионы переходят к повстанцам — отдельному
   государству «<Страна> (повстанцы)» с идеологией оппозиции.
   Стороны воюют, линия фронта ползёт по регионам. Победят
   повстанцы — их идеология и лидер приходят к власти во всей стране;
   проиграют — мятеж подавлен.
   Державы могут разжечь гражданскую войну (тайная операция),
   поддержать любую сторону добровольцами или вмешаться войной.
   ============================================================ */

const CIVIL = { incitePP: 80, supportPP: 15, startChance: 0.05 };

Object.assign(Game, {
  rebelOf(N) { return N && N.civil ? this.c(N.civil) : null; },
  isRebel(c) { return !!(c && c.rebel); },

  // Начать гражданскую войну в стране N: повстанцы идеологии ide
  startCivilWar(N, ide, by) {
    if (!N || N.civil || N.rebel || N.ctrl !== N.id) return null;
    const regs = this.heldRegions(N).filter(r => !r.radioactive);
    if (regs.length < 3) return null;
    const S = this.S, id = N.id + '_R';
    if (S.countries[id]) return null;
    const cap = Regions.center(this.capitalRegion(N.id)) || Regions.center(regs[0].id);
    const far = regs.filter(r => !this.isCapitalRegion(r)).map(r => {
      const c = Regions.center(r.id);
      return { r, d: Math.hypot(c.lat - cap.lat, ((c.lng - cap.lng + 540) % 360) - 180) };
    }).sort((a, b) => b.d - a.d);
    const take = far.slice(0, Math.max(1, Math.round(regs.length * 0.4))).map(x => x.r);
    const share = take.reduce((s, r) => s + r.pop, 0) / (regs.reduce((s, r) => s + r.pop, 0) || 1);
    const pol = JSON.parse(JSON.stringify(N.pol));
    pol.ide = ide;
    pol.leader = (N.pol.cands && N.pol.cands[ide]) || null;
    pol.title = 'Лидер повстанцев';
    pol.next = null;
    pol.managed = true;
    const R = {
      id, name: N.name + ' (повстанцы)', rebel: { of: N.id, ide, since: S.day, by: by || null },
      ctrl: id, faction: 'NEU', wars: {}, cb: {}, intel: Object.assign({}, N.intel), warDays: 0,
      divs: Math.max(1, N.divs * Math.max(0.35, share) + 1), baseDivs: Math.max(1, (N.baseDivs || 2) * 0.5),
      pop: Math.round(N.pop * share), major: false, sab: 0, sabDays: 0, influence: null, integrate: null, pol
    };
    N.divs = Math.max(1, N.divs * (1 - Math.max(0.3, share * 0.8)));
    N.civil = id;
    S.countries[id] = R;
    this.bindNation(R);
    for (const r of take) { r.ctrl = id; r.control = 70; r.lostFrom = null; }
    this._gw = null;
    // Повстанцы-единомышленники разжигателя сразу просятся в его блок
    if (by && this.isPower(by) && Politics.affinity(ide, this.powerIde(by)) === 2) R.faction = POWERS[by].allyFaction;
    this.addTension(N.major ? 5 : 2);
    this.news(`Гражданская война: ${N.name}`, `Страна раскололась. Повстанцы (${IDEOLOGIES[ide].name.toLowerCase()})${pol.leader ? ' во главе с ' + pol.leader : ''} контролируют регионы: ${take.map(r => r.name).join(', ')}.`, N.id, 'war', { hist: N.major ? 1 : 0 });
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
    return R;
  },

  endCivilWar(N, R, rebelsWon) {
    const S = this.S;
    if (rebelsWon) {
      for (const r of this.regionList()) if (r.ctrl === R.id) { r.ctrl = N.id; r.control = 80; }
      N.divs = Math.max(N.divs, R.divs);
      this.setGov(N, R.rebel.ide, R.pol.leader, 'coup', null);
      if (R.faction !== 'NEU' && R.faction !== N.faction) { N.faction = R.faction; N.cb = {}; }
      this.news(`Победа повстанцев: ${N.name}`, `Столица пала. К власти приходят повстанцы (${IDEOLOGIES[R.rebel.ide].name.toLowerCase()})${R.pol.leader ? ', страну возглавляет ' + R.pol.leader : ''}.`, N.id, 'war');
    } else {
      for (const r of this.regionList()) if (r.ctrl === R.id) { r.ctrl = N.id; r.control = 60; }
      this.news(`Мятеж подавлен: ${N.name}`, 'Правительственные войска взяли последние опорные пункты повстанцев. Гражданская война окончена.', N.id, 'war');
    }
    N.civil = null;
    // Державы, воевавшие с повстанцами, — война окончена
    delete S.countries[R.id];
    S.trade = (S.trade || []).filter(t => t.seller !== R.id);
    S.confs = (S.confs || []).filter(f => f.n !== R.id);
    this._gw = null;
    Bus.emit('mapDirty');
    Bus.emit('stateChanged');
  },

  tickCivilWars() {
    const S = this.S;
    // Ход боёв
    for (const R of this.list(c => c.rebel)) {
      if (!R.rebel.of) continue;              // повстанцы, ставшие самостоятельным государством
      const N = this.c(R.rebel.of);
      if (!N || N.civil !== R.id) { delete S.countries[R.id]; continue; }
      const rRegs = this.heldRegions(R), nRegs = this.heldRegions(N);
      if (!rRegs.length) { this.endCivilWar(N, R, false); continue; }
      if (N.ctrl !== N.id) { N.civil = null; R.rebel.of = null; R.name = R.name.replace(' (повстанцы)', ''); continue; }   // страну захватили — повстанцы остаются сами по себе
      const capR = this.r(this.capitalRegion(N.id));
      // Победа повстанцев: у правительства не осталось земли или пала столица, а повстанцы держат больше регионов
      if (!nRegs.length || (capR && capR.ctrl === R.id && rRegs.length > nRegs.length)) { this.endCivilWar(N, R, true); continue; }
      R.divs = Math.max(0.5, R.divs * 0.999);
      N.divs = Math.max(0.5, N.divs * 0.999);
      if (!U.chance(0.035)) continue;
      // Пограничные пары регионов
      const pairs = [];
      for (const r of rRegs) for (const n of Regions.nb(r.id)) { const t = this.r(n); if (t && t.ctrl === N.id) pairs.push([r, t]); }
      if (!pairs.length) continue;
      const sR = R.divs * (1 + (R.rebel.help || 0) * 0.05), sN = N.divs * 1.1;
      const [rr, nr] = pairs[U.randi(0, pairs.length - 1)];
      const capK = this.isCapitalRegion(nr) ? 2.5 : 1;          // столицу правительство держит упорнее
      const rebelsWin = U.chance(sR / (sR + sN * capK));
      const lost = rebelsWin ? nr : rr;
      lost.ctrl = rebelsWin ? R.id : N.id;
      lost.control = 50;
      (rebelsWin ? N : R).divs *= 0.95;
      this._gw = null;
      Bus.emit('mapDirty');
    }
    if (S.day % 30 !== 7) return;
    // Новые расколы: непопулярная недемократическая власть и сильная оппозиция
    this.eachCountry(N => {
      if (N.ctrl !== N.id || N.inert || N.rebel || N.civil || N.capitulated || !N.pol || this.isPowerHome(N)) return;
      if (this.tags().some(t => N.wars[t])) return;
      const pol = N.pol, I = IDEOLOGIES[pol.ide];
      if (!I || I.group === 'dem') return;
      const ruling = pol.pop[pol.ide] || 0;
      const [opp, oppV] = Object.entries(pol.pop).filter(([k]) => k !== pol.ide).sort((a, b) => b[1] - a[1])[0] || [];
      if (ruling >= 30 || !opp || oppV < 30) return;
      if (U.chance(CIVIL.startChance)) this.startCivilWar(N, opp, null);
    });
  },

  /* ---------- Действия держав ---------- */
  canIncite(c, ide) {
    if (this.outReason()) return this.outReason();
    if (!c || c.ctrl !== c.id || c.inert || c.rebel) return 'Только независимая страна';
    if (this.isPowerHome(c)) return 'Не против державы-игрока';
    if (c.civil) return 'Там уже идёт гражданская война';
    if (!c.pol || !IDEOLOGIES[ide] || ide === c.pol.ide) return 'Выберите оппозиционную партию';
    if ((c.pol.pop[ide] || 0) < 15) return 'Партия слишком слаба (нужно ≥ 15%)';
    if (this.heldRegions(c).length < 3) return 'Страна слишком мала для раскола';
    if ((c.pol.coupCd || {})[this.cur] > this.S.day) return 'Агентура ещё не восстановлена';
    if (this.P().pp < CIVIL.incitePP) return `Нужно ${CIVIL.incitePP} ПВ`;
    return null;
  },
  inciteChance(c, ide) {
    const I = IDEOLOGIES[c.pol.ide];
    return U.clamp(0.15 + (c.pol.pop[ide] || 0) / 100 - (c.pol.pop[c.pol.ide] || 0) / 200 + (I && I.group === 'dem' ? -0.1 : 0.1), 0.05, 0.8);
  },
  inciteCivilWar(id, ide) {
    const c = this.c(id), why = this.canIncite(c, ide);
    if (why) return this.fail(why);
    const X = this.cur, P = this.P();
    P.pp -= CIVIL.incitePP;
    c.pol.coupCd = c.pol.coupCd || {};
    c.pol.coupCd[X] = this.S.day + 365;
    if (U.chance(this.inciteChance(c, ide))) {
      P.stats.spyOk++;
      const R = this.startCivilWar(c, ide, X);
      if (!R) return this.fail('Раскол не удался');
      this.log('intel', 'Гражданская война', `Наши агенты подняли мятеж: ${c.name}. Повстанцы контролируют часть страны.`, id);
      return { ok: true, msg: `Мятеж начался: ${c.name}` };
    }
    P.stats.spyFail++;
    this.addTension(4);
    this.news(`Мятеж сорван: ${c.name}`, `Спецслужбы раскрыли сеть заговорщиков. Следы ведут к державе «${POWERS[X].name}».`, id, 'elections');
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Мятеж сорван', warn: true };
  },
  // Добровольцы: 1 дивизия из резерва и ПВ — одной из сторон гражданской войны
  canSupportSide(c) {
    if (this.outReason()) return this.outReason();
    if (!c || !(c.civil || c.rebel)) return 'Там нет гражданской войны';
    if (c.wars[this.cur]) return 'Мы с ними воюем';
    if (this.P().divs < 1) return 'Нужна 1 дивизия в резерве';
    if (this.P().pp < CIVIL.supportPP) return `Нужно ${CIVIL.supportPP} ПВ`;
    return null;
  },
  supportSide(id) {
    const c = this.c(id), why = this.canSupportSide(c);
    if (why) return this.fail(why);
    const P = this.P();
    P.pp -= CIVIL.supportPP;
    this.takeReserve(1);
    c.divs += 1.5;
    if (c.rebel) c.rebel.help = (c.rebel.help || 0) + 1;
    if (c.pol) c.pol.helped = Object.assign(c.pol.helped || {}, { [this.cur]: this.S.day });
    this.log('mil', 'Добровольцы', `Отправлены добровольцы: ${c.name} (+1,5 див.).`, id);
    Bus.emit('stateChanged');
    return { ok: true, msg: `Добровольцы отправлены: ${c.name}` };
  }
});
