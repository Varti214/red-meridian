'use strict';
/* ============================================================
   ЯДЕРНАЯ ЗИМА — не конец игры, а тяжёлые последствия для всех.
   Наступает при CFG.NUCLEAR_WINTER радиоактивных регионах.
   Чем больше пустошей, тем она суровее (3 стадии):
   — дух «Ядерная зима» у всех держав: меньше ПВ, науки и призыва;
   — неурожай и холод: население и заводы понемногу гибнут;
   — армии ИИ-стран тают, напряжённость растёт.
   ============================================================ */

const WINTER_STAGES = [
  null,
  { name: 'Ядерная зима', fx: { pp: -0.5, rp: -0.1, mpMult: -0.25 }, fac: 0.006, pop: 0.0002, divs: 0.0004,
    desc: 'Пепел закрыл солнце: неурожай, холод, голод.' },
  { name: 'Ядерная зима: голод', fx: { pp: -0.9, rp: -0.2, mpMult: -0.4 }, fac: 0.012, pop: 0.0004, divs: 0.0008,
    desc: 'Мировой голод: города пустеют, заводы встают.' },
  { name: 'Ядерная зима: распад', fx: { pp: -1.4, rp: -0.3, mpMult: -0.55 }, fac: 0.02, pop: 0.0007, divs: 0.0012,
    desc: 'Цивилизация на грани: государства держатся из последних сил.' }
];

Object.assign(Game, {
  winterStage(w = this.wastelands()) {
    const T = CFG.NUCLEAR_WINTER;
    if (w < T) return 0;
    return Math.min(3, 1 + Math.floor((w - T) / 6));
  },
  tickWinter() {
    const S = this.S, stage = this.winterStage();
    const old = S.winter || 0;
    if (stage !== old) {
      S.winter = stage;
      for (const t of this.tags()) {
        for (let i = 1; i <= 3; i++) this.removeSpirit(t, 'nuclear_winter_' + i);
        if (stage) { const W = WINTER_STAGES[stage]; this.addSpirit(t, 'nuclear_winter_' + stage, W.name, W.fx, 99999, W.desc); }
      }
      this.recalcMods();
      if (stage > old) {
        const W = WINTER_STAGES[stage];
        this.news(stage === 1 ? 'Ядерная зима' : W.name, stage === 1
          ? `Пустошей на планете: ${this.wastelands()}. Пепел закрыл солнце, температура падает, урожаи гибнут. Пострадают все державы.`
          : `${W.desc} Пустошей на планете: ${this.wastelands()}.`, null, 'world', { hist: 1 });
        this.popup({
          id: 'sys_winter', art: 'i-nuke', cat: 'nuke', title: stage === 1 ? 'Ядерная зима' : W.name,
          text: `${W.desc} Все державы получают дух «${W.name}»: доход ПВ ${W.fx.pp}, наука ${Math.round(W.fx.rp * 100)}%, призыв ${Math.round(W.fx.mpMult * 100)}%. Заводы и население понемногу гибнут. Каждые 6 новых пустошей — следующая стадия.`,
          options: [{ label: 'Выживать', tip: 'Игра продолжается', fx: () => {} }]
        }, {}, null);
        this.addTension(5);
      } else if (!stage) {
        this.news('Зима отступает', 'Небо над планетой понемногу проясняется.', null, 'world');
      }
    }
    if (!stage) return;
    const W = WINTER_STAGES[stage];
    // Холод и голод: население, заводы, армии ИИ
    for (const r of this.regionList()) {
      if (r.radioactive) continue;
      r.pop = r.pop * (1 - W.pop);
      if (r.factories > 0 && U.chance(W.fac / 10)) r.factories--;
    }
    this.eachCountry(c => { if (c.ctrl === c.id && !this.isPower(c.ctrl) && c.divs > 1) c.divs *= 1 - W.divs; });
    this.addTension(0.03 * stage);
  }
});
