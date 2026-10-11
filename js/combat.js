'use strict';
/* ============================================================
   БОЕВОЙ КАЛЬКУЛЯТОР
   Сила = база × множители × бросок 2d6.
   Бросок 2d6 даёт множитель от ×0,80 (сумма 2) до ×1,30 (сумма 12).
   Исход определяется отношением сил атакующего и обороняющегося.
   Обороняется либо ИИ-страна (своим гарнизоном), либо держава игрока —
   тогда её армия делится между всеми враждебными границами.
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

  /* --- Сила атаки текущей державы (Game.cur) --- */
  attackBreakdown(target, commit) {
    const P = Game.P(), m = Game.mods;
    const base = commit * CFG.DIV.attack;
    const lines = [{ label: `${commit} див. × ${CFG.DIV.attack}`, value: base }];
    let mult = 1;
    const add = (label, k) => {
      if (Math.abs(k - 1) < 0.001) return;
      lines.push({ label, mult: k });
      mult *= k;
    };
    add('Танковые технологии', m.attack);
    add('Военная доктрина', 1 + m.attackBonus);
    add(`Организация ${Math.round(P.org)}%`, 0.4 + 0.6 * P.org / 100);
    const sup = Game.supplyFactor(target.id);
    add(sup === 0.8 ? 'Форсирование пролива' : 'Десант без общей границы', sup);
    return { base, mult, total: base * mult, lines };
  },

  /* --- Оборона. divsOverride — для оценки по разведданным --- */
  defenseBreakdown(target, divsOverride) {
    const Y = Game.powerOf(target);
    if (Y && Y !== Game.cur) return this.powerDefense(target, Y, divsOverride);
    const S = Game.S;
    const divs = divsOverride != null ? divsOverride : target.divs;
    const divPart = divs * CFG.ENEMY_DIV_DEF;
    const militia = target.factories * 0.8 + 4;
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
    add('Доктрина: ' + FACTIONS[target.faction].name, FACTION_DEF[target.faction] || 1);
    add(`Укрепления ур. ${target.fort}`, 1 + 0.15 * target.fort);
    add('Саботаж', 1 - target.sab);
    add('Мобилизация (напряжённость ≥ 50%)', S.tension >= 50 && target.faction !== 'NEU' ? 1.1 : 1);
    add('Радиоактивное заражение', target.radioactive ? 0.4 : 1);
    add(`Контроль территории ${Math.round(target.control)}%`, 0.6 + 0.4 * target.control / 100);
    add('Военно-технический прогресс', Game.aiTech(target));
    add('Сложность', Game.diff.aiDef);
    return { base, mult, total: base * mult, lines, divs };
  },

  /* --- Оборона земли, которой владеет держава игрока Y --- */
  powerDefense(target, Y, divsOverride) {
    const PY = Game.P(Y), mY = Game.modsFor(Y);
    const defenders = divsOverride != null ? divsOverride : Game.powerDefenders(Y);
    const core = target.core === Y;
    const capital = target.id === POWERS[Y].capital;
    const divPart = defenders * CFG.DIV.defense;
    const militia = core ? target.factories * 1.5 + 10 : target.factories * 0.8 + 6;
    const base = divPart + militia;
    const lines = [
      { label: `${U.fmt(defenders, 1)} див. × ${CFG.DIV.defense}`, value: divPart },
      { label: core ? 'Ополчение родной земли' : 'Гарнизон и заводы', value: militia }
    ];
    let mult = 1;
    const add = (label, k) => {
      if (Math.abs(k - 1) < 0.001) return;
      lines.push({ label, mult: k });
      mult *= k;
    };
    add(`Укрепления ур. ${target.fort}`, 1 + 0.15 * target.fort);
    add(`Организация ${Math.round(PY.org)}%`, 0.55 + 0.45 * PY.org / 100);
    add('Бронетехника в обороне', 1 + (mY.attack - 1) * 0.5);
    add('Родные стены', core ? 1.25 : 1);
    add('Стратегическая глубина столицы', capital ? 1.5 : 1);
    add('Саботаж', 1 - target.sab);
    add('Радиоактивное заражение', target.radioactive ? 0.4 : 1);
    return { base, mult, total: base * mult, lines, divs: defenders, power: Y };
  },

  /* --- Точный расчёт шансов: перебираем все 36×36 комбинаций бросков --- */
  estimate(target, commit) {
    const att = this.attackBreakdown(target, commit);
    const est = Game.estDivs(target);
    const def = this.defenseBreakdown(target, est.mid);
    let pWin = 0, pBreak = 0;
    for (const [sa, pa] of Object.entries(U.DIST_2D6)) {
      for (const [sd, pd] of Object.entries(U.DIST_2D6)) {
        const r = (att.total * this.rollMult(+sa)) / (def.total * this.rollMult(+sd));
        if (r >= 1) pWin += pa * pd;
        if (r >= 2) pBreak += pa * pd;
      }
    }
    const ratio = att.total / def.total;
    const lossRate = U.clamp(0.22 / ratio, 0.04, 0.55) * (1 - Game.mods.loss);
    return { att, def, est, pWin, pBreak, ratio, expLoss: commit * lossRate, orgCost: this.orgCost(commit), exact: est.exact };
  },

  orgCost(commit) {
    const total = Math.max(1, Game.P().divs);
    return Math.round(8 + 30 * commit / total);
  },

  /* --- Наступление текущей державы --- */
  resolveAttack(target, commit) {
    const m = Game.mods;
    const att = this.attackBreakdown(target, commit);
    const def = this.defenseBreakdown(target);
    const aDice = U.roll2d6(), dDice = U.roll2d6();
    const aRoll = this.rollMult(aDice[0] + aDice[1]);
    const dRoll = this.rollMult(dDice[0] + dDice[1]);
    const aPow = att.total * aRoll;
    const dPow = def.total * dRoll;
    const ratio = aPow / dPow;
    const outcome = this.outcomeFor(ratio);
    const controlBefore = target.control;

    const pRate = U.clamp(0.22 / ratio, 0.04, 0.55) * (1 - m.loss);
    const playerLost = Math.min(commit, U.probRound(commit * pRate));
    const eRate = ratio >= 1 ? U.clamp(0.15 * ratio, 0.12, 0.65) : U.clamp(0.08 * ratio, 0.02, 0.1);
    const enemyLost = Math.round(def.divs * eRate * 10) / 10;

    // Продвижение фронта (крупные государства держатся дольше — см. Game.resilience)
    const resilience = def.power ? 1.5 : Game.resilience(target);
    let controlDrop = 0;
    if (ratio >= 1) controlDrop = Math.max(3, Math.round((12 + 22 * Math.min(ratio - 1, 2) + U.rand(0, 6)) / resilience));
    else if (ratio >= 0.75) controlDrop = Math.round(U.randi(1, 4) / resilience);

    // Трофеи: часть заводов вывозится в тыл
    const loot = ratio >= 1 && !target.radioactive ? Math.floor(target.factories * controlDrop / 100 * 0.35) : 0;

    return {
      kind: 'attack', by: Game.cur, defender: def.power || null,
      op: 'Операция «' + U.pick(OP_NAMES) + '»',
      date: Game.S.date,
      targetId: target.id, targetName: target.name,
      targetFaction: target.faction, targetColor: def.power ? POWERS[def.power].color : null,
      att: { divs: commit, lines: att.lines, base: att.base, mult: att.mult, dice: aDice, roll: aRoll, power: aPow },
      def: { divs: def.divs, lines: def.lines, base: def.base, mult: def.mult, dice: dDice, roll: dRoll, power: dPow },
      ratio, outcome,
      playerLost, playerMPLost: playerLost * CFG.DIV.mp + Math.round(commit * pRate * 4),
      enemyLost, controlBefore, controlDrop, resilience, loot,
      orgCost: this.orgCost(commit)
    };
  },

  /* --- Наступление ИИ на землю державы игрока --- */
  resolveEnemyOffensive(src, target) {
    const Y = target.ctrl;
    const committed = src.divs * 0.6;
    const sea = Geo.isSea(src.id, target.id);          // высадка через пролив вдвое слабее
    const aPow0 = committed * CFG.ENEMY_DIV_DEF * (FACTION_DEF[src.faction] || 1) * Game.diff.aiDef * Game.aiTech(src) *
      (src.sab ? 1 - src.sab : 1) * (sea ? 0.5 : 1);
    const def = this.powerDefense(target, Y);
    const defenders = def.divs;
    const aDice = U.roll2d6(), dDice = U.roll2d6();
    const aPow = aPow0 * this.rollMult(aDice[0] + aDice[1]);
    const dPow = def.total * this.rollMult(dDice[0] + dDice[1]);
    const ratio = aPow / Math.max(1, dPow);
    const capital = target.id === POWERS[Y].capital;
    const PY = Game.P(Y);

    let controlDrop = 0, playerLost = 0, enemyLost = 0;
    if (ratio >= 1) {
      controlDrop = Math.round((10 + 25 * Math.min(ratio - 1, 1.5)) * (capital ? 0.5 : 1));
      playerLost = Math.min(PY.divs, U.probRound(defenders * U.clamp(0.12 * ratio, 0.03, 0.35)));
      enemyLost = committed * U.clamp(0.1 / ratio, 0.03, 0.2);
    } else {
      playerLost = Math.min(PY.divs, U.probRound(defenders * 0.04));
      enemyLost = committed * U.clamp(0.2 / Math.max(ratio, 0.2), 0.08, 0.45);
    }
    return { src, target, ratio, aPow, dPow, aDice, dDice, defenders, sea, controlDrop, playerLost, enemyLost: Math.round(enemyLost * 10) / 10 };
  }
};
