'use strict';
/* ============================================================
   НАПРЯЖЁННОСТЬ РОССИЯ — УКРАИНА (S.ruua, 0–100).
   Своя шкала поверх мировой напряжённости. Медленно растёт сама
   (война на Донбассе не закончена), её двигают события, фокусы,
   обоснование войны. На 100% наступает развязка:
     — Россией играет человек: Генштаб предлагает начать операцию или отступить;
     — Россией правит ИИ, а Украиной человек — ИИ объявляет войну;
     — обеими правит ИИ — кризис замораживается.
   Пока идёт война, шкала стоит на 100%, после мира падает до 60%.
   ============================================================ */
Object.assign(Game, {
  addRUUA(n) { if (this.S.ruua == null) this.S.ruua = 45; this.S.ruua = U.clamp(this.S.ruua + n, 0, 100); },

  // Кто сейчас «Россия» и кто «Украина»: держава-игрок или ИИ-страна
  ruuaSides() {
    const r = this.c('RUS'), u = this.c('UKR');
    if (!r || !u) return null;
    const rp = this.isPower(r.ctrl) ? r.ctrl : null, up = this.isPower(u.ctrl) ? u.ctrl : null;
    if (!(r.ctrl === r.id || (rp && POWERS[rp].capital === 'RUS'))) return null;
    if (!(u.ctrl === u.id || (up && POWERS[up].capital === 'UKR'))) return null;
    return { r, u, rp, up };
  },
  // Земли a и b — это Россия и Украина (в любом порядке)?
  ruuaPair(a, b) {
    const s = this.ruuaSides();
    if (!s || !a || !b) return false;
    const ids = [this.govHolder(a) && this.govHolder(a).id, this.govHolder(b) && this.govHolder(b).id].sort().join();
    return ids === 'RUS,UKR';
  },
  ruuaWar() {
    const s = this.ruuaSides();
    if (!s) return false;
    if (s.rp && s.up) return this.powersAtWar(s.rp, s.up);
    if (s.rp) return !!s.u.wars[s.rp];
    if (s.up) return !!s.r.wars[s.up];
    return false;
  },

  tickRUUA() {
    const S = this.S, F = S.flags;
    this.tickWest();
    if (S.ruua == null) S.ruua = 45;
    const s = this.ruuaSides();
    if (!s) return;
    if (this.ruuaWar()) {
      if (!F.ruuaWar) { F.ruuaWar = 1; this.news('Война России и Украины', 'Боевые действия идут по всей линии фронта. Мир с ужасом следит за происходящим.', 'UKR', 'war'); }
      S.ruua = 100;
      return;
    }
    if (F.ruuaWar) {
      F.ruuaWar = 0;
      S.ruua = 60;
      this.news('Перемирие между Россией и Украиной', 'Стороны прекращают огонь. Напряжённость остаётся высокой.', 'UKR', 'war');
    }
    // Нерешённый конфликт сам по себе тлеет
    this.addRUUA(0.012 + (S.tension > 60 ? 0.01 : 0));
    const cross = (lvl, key, fn) => { if (S.ruua >= lvl && !F[key]) { F[key] = 1; fn(); } else if (S.ruua < lvl - 15) F[key] = 0; };
    cross(75, 'ruua75', () => this.news('Войска у границ Украины', `Спутники фиксируют концентрацию российских войск. Напряжённость между странами — ${Math.round(S.ruua)}%.`, 'UKR', 'war'));
    cross(90, 'ruua90', () => {
      const warn = { id: 'sys_ruua90', art: 'i-tension', cat: 'alert', title: 'На грани войны',
        text: 'Напряжённость между Россией и Украиной достигла 90%. Ещё немного — и начнётся большая война.',
        options: [{ label: 'Готовиться к худшему', tip: 'Организация всех армий 100%', fx: () => this.setArmyOrg(100) },
          { label: 'Искать компромисс', tip: '−20 ПВ · напряжённость Россия — Украина −15', fx: () => { this.addPP(-20); this.addRUUA(-15); } }] };
      if (s.rp) this.popup(warn, {}, s.rp);
      if (s.up) this.popup(warn, {}, s.up);
    });
    if (S.ruua < 100 || S.day < (F.ruuaNext || 0)) return;
    F.ruuaNext = S.day + 90;
    if (s.rp) {
      const X = s.rp;
      this.popup({
        id: 'sys_ruua100', art: 'i-swords', cat: 'alert', title: 'Генштаб ждёт приказа',
        text: 'Переговоры зашли в тупик, войска развёрнуты у границы. Генеральный штаб докладывает о готовности к операции против Украины.',
        options: [
          { label: 'Начать операцию', tip: 'Война с Украиной · мировая напряжённость резко вырастет', fx: () => { s.u.cb[X] = true; this.declareWar(s.u.id); } },
          { label: 'Отвести войска', tip: '−30 ПВ · напряжённость Россия — Украина −30', fx: () => { this.addPP(-30); this.addRUUA(-30); } }
        ]
      }, {}, X);
    } else if (s.up) {
      this.aiDeclareWar('RUS', s.up, 'Москва начинает военную операцию против Украины');
    } else {
      S.ruua = 85;
      this.news('Кризис заморожен', 'Москва и Киев в последний момент отводят войска. Конфликт снова тлеет.', 'UKR', 'war');
    }
  }
});

/* ============================================================
   УКРАИНА И ЗАПАД (S.uaw, 0–100): насколько Запад доверяет Киеву.
   Тянется к «естественному» уровню: его задают идеология правительства
   Украины, коррупция и членство в НАТО; фокусы и события сдвигают шкалу.
   Если Россия нападает на Украину:
     — Запад вводит санкции (тем жёстче, чем выше доверие к Киеву);
     — раз в 30 дней — пакет военной помощи (бригады и «Западное оружие»).
   Если за США играет человек — он сам решает, но отдача зависит от доверия.
   ============================================================ */
const WEST_ARMS = ['Javelin', 'HIMARS', 'Bradley', 'Leopard 2', 'Patriot', 'Stinger', 'M777', 'Storm Shadow', 'Abrams', 'Bayraktar TB2', 'NLAW', 'IRIS-T'];

Object.assign(Game, {
  addUAW(n) { if (this.S.uaw == null) this.S.uaw = 55; this.S.uaw = U.clamp(this.S.uaw + n, 0, 100); },
  uawTarget() {
    const u = this.c('UKR');
    const pol = u && this.gov(u);
    let t = 50 + ({ lib: 22, con: 15, soc: 8, nat: -4, auth: -28, com: -35, theo: -20 }[pol && pol.ide] || 0);
    if (this.isPower('UA') && (this.P('UA').spirits || []).some(s => s.id === 'corruption')) t -= 8;
    if (u && u.faction === 'WEST') t += 15;
    return U.clamp(t, 5, 95);
  },
  // Может ли Запад действовать: США живы и не под чужой оккупацией
  westAlive() {
    const us = this.c('USA');
    return !!us && !us.radioactive && (us.ctrl === 'USA' || us.ctrl === 'WST');
  },
  westHuman() { return this.isPower('WST') && !this.P('WST').out; },

  tickWest() {
    const S = this.S, F = S.flags;
    if (S.uaw == null) S.uaw = 55;
    const s = this.ruuaSides();
    if (!s) return;
    S.uaw += (this.uawTarget() - S.uaw) * 0.004;
    const war = this.ruuaWar();
    if (!war) {
      F.westWar = 0;
      // Мирное время: при большом доверии — программы подготовки армии
      if (S.uaw >= 70 && S.day >= (F.westTrain || 0) && s.up) {
        F.westTrain = S.day + 180;
        this.addSpirit(s.up, 'nato_training', 'Подготовка по стандартам НАТО', { defense: 0.05, org: 0.1 }, 180, 'Инструкторы из стран НАТО учат бригады ВСУ.');
        this.news('Инструкторы НАТО на Украине', 'Западные страны расширяют программу подготовки украинских военных.', 'UKR');
      }
      return;
    }
    if (!this.westAlive()) return;
    const byRussia = F.ruuaBy !== 'UKR';
    if (!F.westWar) { F.westWar = 1; F.westAidNext = S.day + 10; this.westSanctions(s, byRussia); }
    if (S.day >= (F.westAidNext || 0)) { F.westAidNext = S.day + 30; this.westAidRound(s, byRussia); }
  },

  // Сила помощи от доверия: 0 — ничего, 1 — полный пакет
  westAidLevel(byRussia) {
    const w = this.S.uaw;
    return byRussia ? U.clamp((w - 25) / 55, 0, 1.25) : U.clamp((w - 55) / 100, 0, 0.3);
  },

  westSanctions(s, byRussia) {
    const w = this.S.uaw, k = byRussia ? 0.5 + w / 100 : 0.15;
    const apply = level => {
      if (level <= 0) { this.news('Запад ограничился заявлениями', 'Санкции против России не вводятся.', 'RUS', 'war'); return; }
      if (s.rp) this.addSpirit(s.rp, 'war_sanctions', 'Санкции за войну', { pp: -(0.15 + 0.3 * level), rp: -0.06 * level }, 540,
        'Отключение от SWIFT, заморозка резервов, запрет на технологии.');
      else s.r.factories = Math.max(0, s.r.factories - Math.round(2 * level));
      this.addTension(2);
      this.news('Санкции против России', level > 0.9 ? 'США и ЕС вводят беспрецедентные санкции: заморозка резервов, отключение банков от SWIFT, эмбарго на технологии.'
        : 'Запад вводит точечные санкции против банков и чиновников.', 'RUS', 'war');
    };
    if (this.westHuman()) {
      this.popup({
        id: 'sys_west_sanctions', art: 'i-flag', cat: 'alert', title: byRussia ? 'Россия напала на Украину' : 'Война России и Украины',
        text: `${byRussia ? 'Россия начала войну против Украины.' : 'Украина первой атаковала Россию.'} Союзники ждут решения Вашингтона о санкциях. Доверие Запада к Киеву — ${Math.round(w)}%.`,
        options: [
          { label: 'Жёсткие санкции', tip: '+10 ПВ · России — «Санкции за войну» · напряжённость +2', fx: () => { this.addPP(10); apply(k); } },
          { label: 'Точечные санкции', tip: 'России — ослабленные санкции', fx: () => apply(k * 0.5) },
          { label: 'Не вводить санкций', tip: '+5 ПВ', fx: () => { this.addPP(5); apply(0); } }
        ]
      }, {}, 'WST');
    } else apply(w >= 25 || !byRussia ? k : 0);
  },

  westAidRound(s, byRussia) {
    const level0 = this.westAidLevel(byRussia);
    const deliver = choice => {
      const L = choice * (0.5 + this.S.uaw / 100);
      if (L <= 0.05) return;
      const arms = U.pick(WEST_ARMS) + ', ' + U.pick(WEST_ARMS.filter(x => true));
      const brigades = Math.max(1, Math.round(1 + 4 * L));
      if (s.up) {
        this.as(s.up, () => {
          this.addDivs(brigades);
          this.addPP(Math.round(5 * L));
          this.addSpirit(s.up, 'west_arms', 'Западное оружие', { defense: 0.04 + 0.1 * L, attackBonus: 0.04 * L }, 45, 'Оружие и боеприпасы союзников.');
          this.log('success', 'Пакет военной помощи', `Прибыли ${arms}. В резерв: ${U.divs(brigades)}. Доверие Запада — ${Math.round(this.S.uaw)}%.`, 'UKR');
        });
      } else s.u.divs += brigades;
      this.news('Западная помощь Украине', `Новый пакет военной помощи: ${arms}.`, 'UKR', 'war');
    };
    if (this.westHuman()) {
      this.popup({
        id: 'sys_west_aid', art: 'i-div', cat: 'mil', title: 'Киев просит оружие',
        text: `Украина просит новый пакет военной помощи. Доверие к Киеву — ${Math.round(this.S.uaw)}%: чем оно выше, тем больше отдача от помощи.`,
        options: [
          { label: 'Большой пакет', tip: '−30 ПВ · Украине — бригады и «Западное оружие»', fx: () => { this.addPP(-30); deliver(1); } },
          { label: 'Ограниченный пакет', tip: '−10 ПВ · вдвое меньше', fx: () => { this.addPP(-10); deliver(0.5); } },
          { label: 'Отказать', tip: '+5 ПВ', fx: () => this.addPP(5) }
        ]
      }, {}, 'WST');
    } else if (level0 > 0) deliver(level0);
    else if (!this.S.flags.westRefused) {
      this.S.flags.westRefused = 1;
      this.news('Запад не спешит помогать Киеву', `Доверие к украинскому правительству низкое (${Math.round(this.S.uaw)}%). Поставки оружия заморожены.`, 'UKR', 'war');
    }
  }
});
