'use strict';
/* ============================================================
   БОЕВОЙ КАЛЬКУЛЯТОР
   Сражение идёт КАЖДЫЙ ДЕНЬ, пока армия наступает:
     сила = база × множители × бросок 2d6 (от ×0,80 до ×1,30);
     по соотношению сил считаются потери, падение контроля врага
     и расход организации наступающих.
   Бой идёт за РЕГИОН. Обороняется гарнизон ИИ-государства (его армия
   стягивается к фронту) или держава игрока — тогда только армии, стоящие
   в этом регионе (и резерв, если это столичный регион).
   ============================================================ */

const Combat = {
  rollMult: sum => 0.7 + sum * 0.05,

  OUTCOMES: [
    { min: 2.0,  key: 'decisive',  title: 'Решительный прорыв',      tone: 'great',
      text: 'Танковые клинья прорвали оборону на всю глубину. Противник в беспорядке отступает, бросая технику.' },
    { min: 1.3,  key: 'victory',   title: 'Успешное наступление',    tone: 'good',
      text: 'Оборона противника взломана. Войска закрепляются на новых рубежах.' },
    { min: 1.0,  key: 'pyrrhic',   title: 'Тактическая победа',      tone: 'ok',
      text: 'Позиции взяты ценой тяжёлых потерь. Противник отошёл, но не сломлен.' },
    { min: 0.75, key: 'stalemate', title: 'Наступление захлебнулось', tone: 'warn',
      text: 'Атака увязла в глубокоэшелонированной обороне. Фронт практически не сдвинулся.' },
    { min: 0.45, key: 'repulsed',  title: 'Атака отбита',            tone: 'bad',
      text: 'Противник встретил наступающих плотным огнём. Части откатились на исходные позиции.' },
    { min: 0,    key: 'rout',      title: 'Разгром',                 tone: 'terrible',
      text: 'Наступление обернулось катастрофой. Командующий фронтом отстранён от должности.' }
  ],

  outcomeFor(ratio) { return this.OUTCOMES.find(o => ratio >= o.min); },

  /* --- Сила атаки армий текущей державы (Game.cur) ---
     g — сводка армий (armyGroup): дивизии, очки атаки по шаблонам, доля танков */
  attackBreakdown(target, g, fromLoc) {
    const m = Game.mods;
    const divs = g.divs, org = g.org;
    const base = g.att;
    const lines = [{ label: `${U.fmt(divs, 1)} див. по шаблонам (с техникой)`, value: base }];
    let mult = 1;
    const add = (label, k) => {
      if (Math.abs(k - 1) < 0.001) return;
      lines.push({ label, mult: k });
      mult *= k;
    };
    add('Военная доктрина', 1 + m.attackBonus);
    add(`Организация ${Math.round(org)}%`, 0.4 + 0.6 * org / 100);
    add('Нехватка нефти', Game.resK ? Game.resK('oil') : 1);
    if (g.air) add('Воздушный десант: внезапность', g.airDays < 4 ? CFG.AIRBORNE.surprise : 1.05);
    else if (fromLoc) add('Форсирование пролива', Game.armySupply(fromLoc, target.id));
    // ПТ-артиллерия противника (только у держав-игроков) гасит танковый удар
    const Y = Game.powerOf(target);
    if (Y && Y !== Game.cur && g.armor > 0) {
      const at = Game.landDefense(target, Y).at;
      add('ПТ-оборона противника', 1 - g.armor * Math.min(1, at * 4) * 0.4);
    }
    return { base, mult, total: base * mult, lines, divs };
  },

  /* --- Оборона. divsOverride — для оценки по разведданным --- */
  defenseBreakdown(target, divsOverride) {
    const Y = Game.powerOf(target);
    if (Y && Y !== Game.cur) return this.powerDefense(target, Y, divsOverride);
    const S = Game.S;
    const N = Game.ownerNation(target) || { faction: 'NEU', sab: 0 };
    const divs = divsOverride != null ? divsOverride : Game.garrison(target);
    const divPart = divs * CFG.ENEMY_DIV_DEF;
    const militia = target.factories * 0.8 + 3;
    const base = divPart + militia;
    const lines = [
      { label: `${U.fmt(divs, 1)} див. × ${CFG.ENEMY_DIV_DEF}`, value: divPart },
      { label: 'Ополчение и заводы', value: militia }
    ];
    let mult = 1;
    const add = (label, k) => {
      if (Math.abs(k - 1) < 0.001) return;
      lines.push({ label, mult: k });
      mult *= k;
    };
    add('Доктрина: ' + (FACTIONS[N.faction] || FACTIONS.NEU).name, FACTION_DEF[N.faction] || 1);
    add(`Укрепления ур. ${target.fort}`, 1 + 0.15 * target.fort);
    add('Столичный регион', Game.isCapitalRegion(target) ? 1.3 : 1);
    add('Саботаж', 1 - (N.sab || 0));
    add('Мобилизация (напряжённость ≥ 50%)', S.tension >= 50 && N.faction !== 'NEU' ? 1.1 : 1);
    add('Радиоактивное заражение', target.radioactive ? 0.4 : 1);
    add(`Контроль территории ${Math.round(target.control)}%`, 0.6 + 0.4 * target.control / 100);
    add('Военно-технический прогресс', Game.aiTech(target));
    add('Сложность', Game.diff.aiDef);
    return { base, mult, total: base * mult, lines, divs };
  },

  /* --- Оборона земли державы Y: армии на этой земле + ополчение --- */
  powerDefense(target, Y, divsOverride) {
    const mY = Game.modsFor(Y);
    const land = Game.landDefense(target, Y);
    const defenders = divsOverride != null ? divsOverride : land.divs;
    const perDiv = land.divs > 0 ? land.def / land.divs : CFG.DIV.defense;   // оборона одной дивизии по шаблонам
    const org = Game.landOrg(target, Y);
    const core = target.core === Y;
    const capital = target.id === Game.capitalRegion(Y);
    const home = Game.c(POWERS[Y].capital) || { sab: 0 };
    const divPart = defenders * perDiv;
    const militia = core ? target.factories * 1.5 + 6 : target.factories * 0.8 + 4;
    const base = divPart + militia;
    const lines = [
      { label: `${U.fmt(defenders, 1)} див. × ${U.fmt(perDiv, 1)}`, value: divPart },
      { label: core ? 'Ополчение родной земли' : 'Гарнизон и заводы', value: militia }
    ];
    let mult = 1;
    const add = (label, k) => {
      if (Math.abs(k - 1) < 0.001) return;
      lines.push({ label, mult: k });
      mult *= k;
    };
    add(`Укрепления ур. ${target.fort}`, 1 + 0.15 * target.fort);
    add(`Организация ${Math.round(org)}%`, 0.55 + 0.45 * org / 100);
    add('Бронетехника в обороне', 1 + (mY.attack - 1) * 0.5);
    add('Оборонная доктрина', 1 + mY.defense);
    add('Родные стены', core ? 1.25 : 1);
    add('Стратегическая глубина столицы', capital ? 1.5 : 1);
    add('Саботаж', 1 - (home.sab || 0));
    add('Радиоактивное заражение', target.radioactive ? 0.4 : 1);
    return { base, mult, total: base * mult, lines, divs: defenders, power: Y };
  },

  // Стойкость: как медленно падает контроль. Земля державы-игрока — ×2
  resilienceOf(r) { return Game.resilience(r) * (Game.isPower(r.ctrl) ? 1.4 : 1); },

  /* --- Итог одного дня боя при данном соотношении сил --- */
  dayEffects(ratio, res, attDivs, defDivs, g) {
    const m = Game.mods;
    // Пехота держится дольше (организация шаблона выше), танки быстрее прорывают оборону
    const orgK = g ? (50 / Math.max(15, g.orgStat)) * (1 - 0.35 * g.armor) * (g.air ? CFG.AIRBORNE.orgLoss : 1) : 1;
    return {
      // Регион меньше страны: контроль падает быстрее
      ctrlDrop: ratio >= 1 ? (5 + 9 * Math.min(ratio - 1, 2)) / res : ratio >= 0.85 ? 0.6 / res : 0,
      attLoss: attDivs * U.clamp(0.012 / ratio, 0.002, 0.03) * (1 - m.loss),
      defLoss: defDivs * (ratio >= 1 ? U.clamp(0.012 * ratio, 0.006, 0.04) : U.clamp(0.006 * ratio, 0.001, 0.008)),
      orgLoss: (2 + 2 / Math.max(ratio, 0.3)) * orgK
    };
  },

  // Сводные цифры наступающих армий
  armyGroup(armies, targetId, air) {
    const divs = armies.reduce((s, a) => s + a.divs, 0);
    const org = divs ? armies.reduce((s, a) => s + a.org * a.divs, 0) / divs : 0;
    const mix = {};
    armies.forEach(a => Game.addMix(mix, a.mix));
    const st = Game.mixStats(mix);
    // Если хоть одна армия идёт через пролив — штраф действует на всех
    const tgt = targetId || (armies[0].order && armies[0].order.target) || '';
    const from = armies.find(a => Regions.isSea(a.loc, tgt)) || armies[0];
    // Десант: все армии группы высаживаются с воздуха
    const isAir = air != null ? air : armies.every(a => a.order && a.order.air);
    const airDays = isAir ? Math.max(...armies.map(a => (a.battle ? a.battle.days : 0))) : 0;
    return { divs, org, from: from.loc, att: st.att, armor: st.armor, orgStat: st.org, air: isAir, airDays };
  },

  /* --- Один день сражения (бросаем кубики) --- */
  battleDay(c, armies) {
    const g = this.armyGroup(armies, c.id);
    const att = this.attackBreakdown(c, g, g.from);
    const def = this.defenseBreakdown(c);
    const aDice = U.roll2d6(), dDice = U.roll2d6();
    const aRoll = this.rollMult(aDice[0] + aDice[1]), dRoll = this.rollMult(dDice[0] + dDice[1]);
    const aPow = att.total * aRoll, dPow = Math.max(1, def.total * dRoll);
    const ratio = aPow / dPow;
    const res = this.resilienceOf(c);
    const fx = this.dayEffects(ratio, res, g.divs, def.divs, g);
    return Object.assign(fx, {
      ratio, resilience: res,
      defender: def.power || null,   // тег державы-защитника (null — ИИ-страна)
      att: { divs: g.divs, lines: att.lines, base: att.base, mult: att.mult, dice: aDice, roll: aRoll, power: aPow },
      def: { divs: def.divs, lines: def.lines, base: def.base, mult: def.mult, dice: dDice, roll: dRoll, power: dPow }
    });
  },

  /* --- Прогноз наступления: перебираем все 36×36 бросков ---
     Возвращает шанс «выиграть день», ожидаемые дни до захвата и на сколько дней хватит организации. */
  estimateArmies(c, armies, air) {
    const g = this.armyGroup(armies, c.id, air);
    const att = this.attackBreakdown(c, g, g.from);
    const est = Game.estDivs(c);
    const def = this.defenseBreakdown(c, est.mid);
    const res = this.resilienceOf(c);
    let pWin = 0, drop = 0, orgLoss = 0, attLoss = 0;
    for (const [sa, pa] of Object.entries(U.DIST_2D6)) {
      for (const [sd, pd] of Object.entries(U.DIST_2D6)) {
        const r = (att.total * this.rollMult(+sa)) / Math.max(1, def.total * this.rollMult(+sd));
        const p = pa * pd, fx = this.dayEffects(r, res, g.divs, def.divs, g);
        if (r >= 1) pWin += p;
        drop += p * fx.ctrlDrop;
        orgLoss += p * fx.orgLoss;
        attLoss += p * fx.attLoss;
      }
    }
    const daysToTake = drop > 0 ? Math.ceil(c.control / drop) : Infinity;
    const orgDays = Math.max(0, Math.floor((g.org - CFG.ARMY.haltOrg) / orgLoss));
    return { att, def, est, pWin, drop, daysToTake, orgDays, attLossDay: attLoss, ratio: att.total / Math.max(1, def.total), exact: est.exact, divs: g.divs, org: g.org };
  },

  /* --- Наступление ИИ на землю державы игрока (мгновенный удар) --- */
  resolveEnemyOffensive(src, target) {
    const Y = target.ctrl, N = Game.c(src.ctrl);
    const committed = Game.garrison(src) * 0.7;       // наступают силы, стоящие в соседнем регионе
    const sea = Regions.isSea(src.id, target.id);      // высадка через пролив вдвое слабее
    const aPow0 = committed * CFG.ENEMY_DIV_DEF * (FACTION_DEF[N.faction] || 1) * Game.diff.aiDef * Game.aiTech(N) *
      (N.sab ? 1 - N.sab : 1) * (sea ? 0.5 : 1);
    const def = this.powerDefense(target, Y);
    const defenders = def.divs;
    const aDice = U.roll2d6(), dDice = U.roll2d6();
    const aPow = aPow0 * this.rollMult(aDice[0] + aDice[1]);
    const dPow = def.total * this.rollMult(dDice[0] + dDice[1]);
    const ratio = aPow / Math.max(1, dPow);
    const capital = target.id === Game.capitalRegion(Y);

    let controlDrop = 0, playerLost = 0, enemyLost = 0;
    if (ratio >= 1) {
      controlDrop = Math.round((10 + 25 * Math.min(ratio - 1, 1.5)) * (capital ? 0.5 : 1));
      playerLost = defenders * U.clamp(0.12 * ratio, 0.03, 0.35);
      enemyLost = committed * U.clamp(0.1 / ratio, 0.03, 0.2);
    } else {
      playerLost = defenders * 0.04;
      enemyLost = committed * U.clamp(0.2 / Math.max(ratio, 0.2), 0.08, 0.45);
    }
    return { src, target, ratio, aPow, dPow, aDice, dDice, defenders, sea, controlDrop, playerLost, enemyLost: Math.round(enemyLost * 10) / 10 };
  }
};
