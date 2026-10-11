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
