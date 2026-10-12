'use strict';
/* ============================================================
   ООН И МЕЖДУНАРОДНЫЕ ОРГАНИЗАЦИИ.

   Генеральная Ассамблея — все независимые страны, решение простым
   большинством: осуждение агрессии, осуждение ядерного удара.
   Совет Безопасности — 5 постоянных членов с правом вето и 10
   непостоянных (состав 2018 года): миротворческая миссия (принуждение
   к миру), санкции ООН против страны. Голосование длится 10 дней;
   державы-игроки голосуют сами, остальные страны — по своим интересам.

   Организации: ЕС, БРИКС, ОПЕК+, ШОС (по составу 2018 года) —
   дешёвая торговля внутри, бонусы членам. НАТО, ОДКБ, ГУАМ — это
   военные блоки игры.
   ============================================================ */

const UN_P5 = ['USA', 'GBR', 'FRA', 'RUS', 'CHN'];
const UN_SC10 = ['BOL', 'CIV', 'GNQ', 'ETH', 'KAZ', 'KWT', 'NLD', 'PER', 'POL', 'SWE'];

const UN_RES = {
  condemn: { name: 'Осудить агрессию', body: 'GA', icon: 'i-flag',
    desc: 'Генассамблея осуждает нападение. Агрессор — «Осуждение ООН» на год: −0,25 ПВ в день, страны Запада и половина нейтральных не торгуют с ним.' },
  nuke: { name: 'Осудить ядерный удар', body: 'GA', icon: 'i-nuke',
    desc: 'Осуждение применения ядерного оружия: −0,5 ПВ и −5% науки в день на два года.' },
  peace: { name: 'Миротворческая миссия', body: 'SC', icon: 'i-shield',
    desc: 'Совбез принуждает стороны к миру на условиях статус-кво. Полгода новая война между ними невозможна.' },
  sanctions: { name: 'Санкции ООН', body: 'SC', icon: 'i-pp',
    desc: 'Против независимой страны: эмбарго на торговлю на два года, армия −10%.' }
};

const ORGS = {
  EU: { name: 'Европейский союз', short: 'ЕС', color: '#3d6fe0',
    members: ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'GBR'],
    fx: 'Общий рынок: торговля со странами ЕС по союзной цене. Структурные фонды: +0,3 ПВ в день.' },
  BRICS: { name: 'БРИКС', short: 'БРИКС', color: '#e0a23d', members: ['BRA', 'RUS', 'IND', 'CHN', 'ZAF'],
    fx: 'Торговля внутри БРИКС по союзной цене. Новый банк развития: +5% очков исследований.' },
  OPEC: { name: 'ОПЕК+', short: 'ОПЕК+', color: '#b0702a',
    members: ['SAU', 'IRQ', 'IRN', 'ARE', 'KWT', 'VEN', 'NGA', 'AGO', 'DZA', 'LBY', 'GAB', 'COG', 'GNQ', 'RUS', 'KAZ', 'AZE', 'OMN', 'MEX', 'MYS', 'BHR', 'BRN', 'SDN', 'SSD'],
    fx: 'Квоты на добычу держат цены: излишки нефти продаются вдвое дороже. Покупатели не из ОПЕК+ платят за нефть картеля на 25% больше.' },
  SCO: { name: 'Шанхайская организация сотрудничества', short: 'ШОС', color: '#3dbbb0', members: ['CHN', 'RUS', 'KAZ', 'KGZ', 'TJK', 'UZB', 'IND', 'PAK'],
    fx: 'Торговля внутри ШОС по союзной цене. Страны организации реже голосуют в ООН против своих партнёров.' }
};

Object.assign(Game, {
  /* ---------- Состав ---------- */
  un() {
    const S = this.S;
    if (!S.un) S.un = { active: [], history: [], seq: 0, truce: {}, nukes: {}, next: 30 };
    if (!S.orgs) { S.orgs = {}; for (const [k, o] of Object.entries(ORGS)) S.orgs[k] = o.members.filter(id => this.c(id)); }
    return S.un;
  },
  homeOf(tag) { return POWERS[tag] ? POWERS[tag].capital : tag; },
  // Чьё мнение — страна или держава, которая ею управляет
  voterPower(cid) { const c = this.c(cid); return c && this.isPower(c.ctrl) && POWERS[c.ctrl].capital === cid ? c.ctrl : null; },
  unMembers() { return this.list(c => c.ctrl === c.id && !c.inert && Geo.meta[c.id]).map(c => c.id).concat(this.alive().map(t => this.homeOf(t))); },
  scMembers() { return UN_P5.concat(UN_SC10).filter(id => { const c = this.c(id); return c && (c.ctrl === c.id || this.voterPower(id)); }); },
  inOrg(org, idOrTag) {
    this.un();
    const id = this.isPower(idOrTag) ? this.homeOf(idOrTag) : idOrTag;
    const c = this.c(id);
    if (!c || !(this.S.orgs[org] || []).includes(id)) return false;
    return c.ctrl === c.id || this.voterPower(id) != null;
  },
  orgsOf(idOrTag) { return Object.keys(ORGS).filter(k => this.inOrg(k, idOrTag)); },
  // Торговые союзы: общий рынок ЕС, БРИКС, ШОС
  tradeUnion(a, b) { return ['EU', 'BRICS', 'SCO'].some(k => this.inOrg(k, a) && this.inOrg(k, b)); },

  /* ---------- Вступление и выход ---------- */
  canJoinOrg(org) {
    if (this.outReason()) return this.outReason();
    const X = this.cur, home = this.homeOf(X);
    if (this.inOrg(org, X)) return 'Мы уже в организации';
    if ((this.un().applying || {})[X] === org) return 'Переговоры уже идут';
    if (org === 'EU') {
      if (POWERS[X].faction !== 'WEST' && X !== 'UA') return 'Только для европейских демократий';
      if (X === 'UA' && (this.S.uaw || 0) < 70) return 'Нужно доверие Запада ≥ 70%';
      if (this.S.orgs.EU.some(id => this.c(id) && this.c(id).wars[X])) return 'Война со страной ЕС';
    }
    if (org === 'BRICS' && POWERS[X].faction === 'WEST') return 'Запад не вступает в БРИКС';
    if (org === 'SCO' && !['SOV', 'AXS'].includes(X) && !this.S.orgs.SCO.some(id => Regions.list.some(r => r.cid === id && this.bordersPower(r.id, X)))) return 'Нужна граница со страной ШОС';
    if (org === 'OPEC' && this.resBalance(X).oil.prod < 3) return 'Нужно добывать хотя бы 3 ед. нефти';
    if (this.P().pp < 40) return 'Нужно 40 ПВ';
    return null;
  },
  joinOrg(org) {
    const why = this.canJoinOrg(org);
    if (why) return this.fail(why);
    const X = this.cur, U0 = this.un();
    this.P().pp -= 40;
    U0.applying = U0.applying || {};
    U0.applying[X] = org;
    U0.applyDay = U0.applyDay || {};
    U0.applyDay[X] = this.S.day + (org === 'EU' ? 365 : 60);
    this.log('dip', 'Заявка на вступление', `Начаты переговоры о вступлении: ${ORGS[org].name}. Срок: ${org === 'EU' ? 'год' : 'два месяца'}.`);
    this.news(`${POWERS[X].name} подаёт заявку: ${ORGS[org].short}`, `Переговоры о вступлении в организацию «${ORGS[org].name}» начались.`, this.homeOf(X));
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Заявка подана' };
  },
  leaveOrg(org) {
    const X = this.cur;
    if (!this.inOrg(org, X)) return this.fail('Мы не состоим в организации');
    this.S.orgs[org] = this.S.orgs[org].filter(id => id !== this.homeOf(X));
    if (org === 'EU') this.removeSpirit(X, 'eu_member');
    this.log('dip', 'Выход из организации', `Мы покидаем организацию «${ORGS[org].name}».`);
    this.news(`${POWERS[X].name} выходит: ${ORGS[org].short}`, `Держава покидает организацию «${ORGS[org].name}».`, this.homeOf(X));
    this.recalcMods();
    Bus.emit('stateChanged');
    return { ok: true };
  },
  orgJoined(X, org) {
    const S = this.S;
    if (!S.orgs[org].includes(this.homeOf(X))) S.orgs[org].push(this.homeOf(X));
    if (org === 'EU') this.addSpirit(X, 'eu_member', 'Член Евросоюза', { pp: 0.3 }, 99999, 'Структурные фонды и общий рынок.');
    if (org === 'BRICS') this.addSpirit(X, 'brics_member', 'Банк развития БРИКС', { rp: 0.05 }, 99999, 'Кредиты на науку и инфраструктуру.');
    this.log('success', 'Вступление', `Мы вступили в организацию «${ORGS[org].name}».`, null, X);
    this.news(`${POWERS[X].name} — новый член: ${ORGS[org].short}`, `Переговоры завершены, держава принята в организацию «${ORGS[org].name}».`, this.homeOf(X));
  },

  /* ---------- Резолюции ---------- */
  canPropose(type, target) {
    if (this.outReason()) return this.outReason();
    const U0 = this.un(), X = this.cur, T = UN_RES[type];
    if (!T) return 'Нет такой резолюции';
    if ((U0.cool || {})[X] > this.S.day) return `Новую резолюцию можно внести через ${U.days(U0.cool[X] - this.S.day)}`;
    if (U0.active.some(r => r.type === type && r.target === target)) return 'Такое голосование уже идёт';
    if (this.P().pp < 25) return 'Нужно 25 ПВ';
    if (target === X) return 'Против себя — нельзя';
    const isP = this.isPower(target);
    if (!isP && !this.c(target)) return 'Нет цели';
    if (type === 'sanctions' && (isP || this.c(target).ctrl !== target)) return 'Только против независимой страны';
    if (type === 'condemn' && (!isP || !this.isAggressor(target))) return 'Осудить можно державу, которая ведёт войну';
    if (type === 'nuke' && !(isP && this.P(target).stats.nukes > 0)) return 'Цель не применяла ядерное оружие';
    if (type === 'peace' && !this.peacePairs(target).length) return 'Цель не воюет';
    return null;
  },
  // Агрессор: держава или страна, которая сейчас ведёт войну (держава объявила её сама)
  isAggressor(t) {
    if (this.isPower(t)) return this.fronts(t).length > 0;
    const c = this.c(t);
    return !!c && Object.values(c.wars || {}).some(Boolean);
  },
  peacePairs(t) {
    const out = [];
    if (this.isPower(t)) {
      for (const c of this.fronts(t)) { const N = this.peaceTarget(c); if (N && !out.some(p => p[1] === N.id)) out.push([t, this.isPower(N.ctrl) ? N.ctrl : N.id]); }
    } else {
      const c = this.c(t);
      if (c) for (const tag of Object.keys(c.wars || {})) if (c.wars[tag]) out.push([tag, t]);
    }
    return out;
  },
  proposeResolution(type, target, auto) {
    const S = this.S, U0 = this.un(), X = this.cur;
    if (!auto) {
      const why = this.canPropose(type, target);
      if (why) return this.fail(why);
      this.P().pp -= 25;
      U0.cool = U0.cool || {};
      U0.cool[X] = S.day + 60;
    }
    const T = UN_RES[type];
    const tName = this.isPower(target) ? POWERS[target].name : this.c(target).name;
    const by = auto ? auto : POWERS[X].name;
    const res = { id: 'un' + (++U0.seq), type, target, tName, by, body: T.body, start: S.day, end: S.day + 10, votes: {} };
    U0.active.push(res);
    // Страны голосуют сразу (державы-игроки — через окно решения)
    const voters = T.body === 'SC' ? this.scMembers() : this.unMembers();
    for (const id of voters) if (!this.voterPower(id)) res.votes[id] = this.aiVote(id, res);
    for (const id of voters) {
      const tag = this.voterPower(id);
      if (tag) this.askVote(tag, res);
    }
    this.news(`ООН: «${T.name}» — ${tName}`, `${T.body === 'SC' ? 'Совет Безопасности' : 'Генеральная Ассамблея'} рассматривает проект резолюции. Внёс: ${by}. Голосование — 10 дней.`, this.isPower(target) ? this.homeOf(target) : target, 'world');
    Bus.emit('stateChanged');
    return { ok: true, msg: 'Проект резолюции внесён' };
  },
  askVote(tag, res) {
    const T = UN_RES[res.type], home = this.homeOf(tag), p5 = res.body === 'SC' && UN_P5.includes(home);
    const set = v => () => { const R = this.un().active.find(x => x.id === res.id); if (R) R.votes[home] = v; };
    const opts = [
      { label: 'Голосовать «за»', tip: 'Поддержать резолюцию', fx: set('yes') },
      { label: 'Голосовать «против»', tip: 'Отклонить', fx: set('no') },
      { label: 'Воздержаться', tip: 'Не участвовать', fx: set('abs') }
    ];
    if (p5) opts.push({ label: 'Наложить вето', tip: 'Резолюция не пройдёт · напряжённость +2', fx: () => { set('veto')(); this.addTension(2); } });
    this.popup({
      id: 'un_vote_' + res.id, art: 'i-globe', cat: 'dip',
      title: `ООН: ${T.name}`,
      text: `${res.body === 'SC' ? 'Совет Безопасности' : 'Генеральная Ассамблея'} голосует по проекту резолюции против: ${res.tName}. Внёс: ${res.by}. ${T.desc}${p5 ? ' Как постоянный член Совбеза мы можем наложить вето.' : ''}`,
      options: opts
    }, { target: res.target, type: res.type }, tag);
  },
  // Позиция страны: близость к цели по блоку и идеологии
  aiVote(id, res) {
    const c = this.c(id), t = res.target;
    if (!c) return 'abs';
    const tHome = this.isPower(t) ? this.c(this.homeOf(t)) : this.c(t);
    if (!tHome) return 'yes';
    if (id === tHome.id) return res.body === 'SC' && UN_P5.includes(id) ? 'veto' : 'no';
    const tFac = this.isPower(t) ? POWERS[t].faction : tHome.faction;
    const tFam = this.isPower(t) ? POWERS[t].family : [tFac];
    const friend = tFam.includes(c.faction) || (this.isPower(t) && this.isAlly(c, t));
    const sameOrg = Object.keys(ORGS).some(k => this.inOrg(k, id) && this.inOrg(k, t));
    const aff = this.gov(c) && this.gov(tHome) ? Politics.affinity(this.gov(c).ide, this.gov(tHome).ide) : 1;
    const h = Resources.hash(id + res.id);
    if (friend) return res.body === 'SC' && UN_P5.includes(id) && h < 0.85 ? 'veto' : 'no';
    if (res.body === 'SC' && UN_P5.includes(id)) {
      // Постоянные члены защищают партнёров
      const shield = (id === 'RUS' && ['COM', 'SOV'].includes(tFac)) || (id === 'CHN' && ['AXIS', 'COM'].includes(tFac)) ||
        (['USA', 'GBR', 'FRA'].includes(id) && ['WEST', 'GUAM', 'UAF'].includes(tFac));
      if (shield) return 'veto';
    }
    const rival = (c.faction === 'WEST' && ['SOV', 'COM', 'AXIS'].includes(tFac)) || (['SOV', 'COM', 'AXIS'].includes(c.faction) && ['WEST', 'GUAM', 'UAF'].includes(tFac));
    if (rival) return 'yes';
    let p = 0.55 - (sameOrg ? 0.25 : 0) - (aff === 2 ? 0.2 : 0) + (aff === 0 ? 0.15 : 0) + (res.type === 'nuke' ? 0.3 : 0) + (res.type === 'peace' ? 0.1 : 0);
    if (h < p) return 'yes';
    if (h < p + 0.25) return 'abs';
    return 'no';
  },
  tally(res) {
    const v = Object.values(res.votes);
    const yes = v.filter(x => x === 'yes').length, no = v.filter(x => x === 'no' || x === 'veto').length, abs = v.filter(x => x === 'abs').length;
    const vetoBy = res.body === 'SC' ? Object.keys(res.votes).filter(id => res.votes[id] === 'veto' && UN_P5.includes(id)) : [];
    const pass = res.body === 'SC' ? yes >= 9 && !vetoBy.length : yes > no;
    return { yes, no, abs, vetoBy, pass };
  },
  closeResolution(res) {
    const S = this.S, U0 = this.un();
    // Державы, не успевшие ответить, голосуют по совету МИД
    const voters = res.body === 'SC' ? this.scMembers() : this.unMembers();
    for (const id of voters) if (!res.votes[id]) res.votes[id] = this.aiVote(id, res);
    const t = this.tally(res);
    U0.active = U0.active.filter(r => r !== res);
    U0.history.unshift(Object.assign({}, res, { result: t, votes: undefined, day: S.day }));
    if (U0.history.length > 12) U0.history.length = 12;
    const T = UN_RES[res.type];
    const tally = `за ${t.yes}, против ${t.no}, воздержались ${t.abs}`;
    if (!t.pass) {
      const why = t.vetoBy.length ? `вето: ${t.vetoBy.map(id => this.c(id).name).join(', ')}` : 'не набрала голосов';
      this.news(`ООН: резолюция отклонена`, `«${T.name}» (${res.tName}) — ${why}. Итоги: ${tally}.`, null, 'world');
      Bus.emit('unResult', { id: res.id, pass: false });
      return;
    }
    this.news(`ООН принимает резолюцию: ${T.name}`, `Цель: ${res.tName}. Итоги: ${tally}.`, this.isPower(res.target) ? this.homeOf(res.target) : res.target, 'world');
    this.applyResolution(res);
    Bus.emit('unResult', { id: res.id, pass: true });
  },
  applyResolution(res) {
    const S = this.S, t = res.target, U0 = this.un();
    if (res.type === 'condemn') {
      if (this.isPower(t)) {
        this.addSpirit(t, 'un_condemn', 'Осуждение ООН', { pp: -0.25 }, 365, 'Генассамблея осудила агрессию: дипломатическая изоляция.');
        this.P(t).unCondemned = S.day + 365;
        this.log('alert', 'Осуждение ООН', 'Генассамблея осудила нашу агрессию. Страны Запада и часть нейтральных прекращают с нами торговлю.', null, t);
      } else { const c = this.c(t); if (c) c.unCondemned = S.day + 365; }
      this.addTension(2);
    } else if (res.type === 'nuke') {
      if (this.isPower(t)) this.addSpirit(t, 'un_nuke', 'Ядерный изгой', { pp: -0.5, rp: -0.05 }, 720, 'Мир осудил применение ядерного оружия.');
      this.addTension(-5);
    } else if (res.type === 'peace') {
      for (const [a, b] of this.peacePairs(t)) {
        if (this.isPower(b)) this.makePowerPeace(a, b);
        else { const N = this.c(b); if (N && N.wars[a]) { if (N.capitulated) continue; this.makePeace(N, a); } }
        U0.truce[this.pairKey(a, b)] = S.day + 180;
        this.log('dip', 'Миротворцы ООН', `Совбез принудил стороны к миру. Полгода новая война невозможна. Стороны: ${this.isPower(a) ? POWERS[a].name : a} — ${this.isPower(b) ? POWERS[b].name : this.c(b).name}.`, null, this.isPower(a) ? a : null);
      }
    } else if (res.type === 'sanctions') {
      const c = this.c(t);
      if (c) { c.unSanctions = S.day + 730; c.divs *= 0.9; }
      S.trade = this.contracts().filter(x => x.seller !== t);
      S.tradeSeq = (S.tradeSeq || 0) + 1;
    }
    Bus.emit('stateChanged');
  },
  // Перемирие по решению ООН
  truceWith(a, b) { const v = (this.un().truce || {})[this.pairKey(a, b)]; return v && v > this.S.day ? v : 0; },

  /* ---------- Ежедневно ---------- */
  tickUN() {
    const S = this.S, U0 = this.un();
    if (!U0.init) {
      U0.init = true;
      for (const t of this.alive()) {
        if (this.inOrg('EU', t)) this.addSpirit(t, 'eu_member', 'Член Евросоюза', { pp: 0.3 }, 99999, 'Структурные фонды и общий рынок.');
        if (this.inOrg('BRICS', t)) this.addSpirit(t, 'brics_member', 'Банк развития БРИКС', { rp: 0.05 }, 99999, 'Кредиты на науку и инфраструктуру.');
      }
    }
    for (const r of U0.active.slice()) if (S.day >= r.end) this.closeResolution(r);
    // Переговоры о вступлении
    for (const [X, org] of Object.entries(U0.applying || {})) {
      if (S.day < (U0.applyDay || {})[X]) continue;
      delete U0.applying[X];
      if (!this.isPower(X) || this.P(X).out) continue;
      const ok = org !== 'EU' || ((S.uaw || 0) >= 60 || POWERS[X].faction === 'WEST');
      if (ok) this.orgJoined(X, org);
      else {
        this.log('alert', 'Вступление отложено', `Переговоры о вступлении (${ORGS[org].name}) провалились: доверие упало.`, null, X);
        this.news(`${ORGS[org].short} откладывает вступление`, `Переговоры с державой «${POWERS[X].name}» зашли в тупик.`, this.homeOf(X));
      }
    }
    // Ядерный удар — Генассамблея сама ставит вопрос об осуждении
    for (const t of this.alive()) {
      const n = this.P(t).stats.nukes || 0;
      if (n > (U0.nukes[t] || 0)) {
        U0.nukes[t] = n;
        if (!U0.active.some(r => r.type === 'nuke' && r.target === t)) this.proposeResolution('nuke', t, 'Генеральный секретарь ООН');
      }
    }
    // Инициативы стран раз в месяц: осудить агрессию державы, принудить к миру затяжную войну
    if (S.day < U0.next) return;
    U0.next = S.day + 30;
    for (const t of this.alive()) {
      const fr = this.fronts(t).filter(c => { const N = this.peaceTarget(c); return N && !this.isPower(N.ctrl) && (N.warDays || 0) > 20; });
      if (!fr.length) continue;
      const N = this.peaceTarget(fr[0]);
      const sponsor = POWERS[t].faction === 'WEST' ? this.c('RUS') : this.c('USA');
      const sponsorAI = sponsor && sponsor.ctrl === sponsor.id;
      if (sponsorAI && !U0.active.some(r => r.target === t) && U.chance(0.35) && !(this.P(t).unCondemned > S.day))
        this.proposeResolution('condemn', t, sponsor.name);
      else if ((N.warDays || 0) > 240 && U.chance(0.15) && !U0.active.some(r => r.target === t))
        this.proposeResolution('peace', t, 'Генеральный секретарь ООН');
    }
  }
});

// Изоляция после решений ООН закрывает рынки
(function () {
  const block = Game.tradeBlock;
  Game.tradeBlock = function (sellerId, tag = this.cur) {
    const why = block.call(this, sellerId, tag);
    if (why) return why;
    const S = this.S, P = this.P(tag);
    if (!this.isPower(sellerId)) {
      const N = this.c(sellerId);
      if (N.unSanctions > S.day) return 'Санкции ООН';
      if (P && P.unCondemned > S.day && (N.faction === 'WEST' || (N.faction === 'NEU' && Resources.hash(N.id) < 0.5))) return 'Осуждение ООН';
    }
    return null;
  };
  const price = Game.tradePrice;
  Game.tradePrice = function (sellerId, tag = this.cur, k) {
    let p = price.call(this, sellerId, tag, k);
    if (this.tradeUnion(sellerId, tag)) p = Math.min(p, TRADE.allyPrice);
    if (k === 'oil' && this.inOrg('OPEC', sellerId) && !this.inOrg('OPEC', tag)) p = Math.round(p * 125) / 100;
    return p;
  };
  // Перемирие ООН запрещает объявлять войну
  const canDeclare = Game.canDeclare;
  Game.canDeclare = function (c) {
    const why = canDeclare.call(this, c);
    if (why) return why;
    const Y = this.powerOf(c);
    const until = this.truceWith(this.cur, Y || c.id);
    return until ? `Миротворцы ООН: перемирие ещё ${U.days(until - this.S.day)}` : null;
  };
})();
