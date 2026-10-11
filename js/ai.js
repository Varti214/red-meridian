'use strict';
/* ============================================================
   ИИ-ДИРЕКТОР: управляет всеми странами, за которые не играют люди.
   — растит гарнизоны (быстрее при высокой напряжённости и на войне);
   — объявляет оборонительную мобилизацию при напряжённости ≥ 50%;
   — ведёт наступления на приграничные земли держав, с которыми воюет;
   — присылает подкрепления союзникам и вступает в войны;
   — предлагает мир, когда устал от войны;
   — США (если за них не играет человек) могут ответить ядерным ударом.
   ============================================================ */

const AI = {
  daily() {
    const S = Game.S, t = S.tension, diff = Game.diff;
    const tags = Game.tags();

    Game.eachCountry(c => {
      if (Game.isPower(c.ctrl) || c.inert) return;

      // Саботаж со временем проходит
      if (c.sabDays > 0 && --c.sabDays <= 0) { c.sab = 0; c.sabDays = 0; }

      // Разведданные каждой державы устаревают
      for (const tag of tags) {
        if (Game.modsFor(tag).intelKeep || Game.isAlly(c, tag)) continue;
        const base = Game.baseIntel(c, tag);
        const v = c.intel[tag];
        if (v != null && v > base) c.intel[tag] = Math.max(base, v - 0.08);
      }

      if (c.radioactive) return;
      const atWar = tags.some(tag => c.wars[tag]);

      // Рост гарнизонов
      const bloc = BLOCS.includes(c.faction) && c.faction !== 'GUAM';
      let rate = c.factories * 0.0025 + 0.004;
      if (t >= 50 && bloc) rate *= 2;
      if (atWar) rate *= 1.6;
      rate *= diff.aiGrowth;
      const cap = c.baseDivs * (1 + (bloc ? t / 100 : t / 250)) + (atWar ? c.baseDivs * 0.5 + 2 : 0);
      if (c.divs < cap) c.divs = Math.min(cap, c.divs + rate);

      // Противник понемногу восстанавливает контроль над своей территорией
      if (c.control < 100) c.control = Math.min(100, c.control + 0.15);

      // Усталость от войны копится каждый день
      if (atWar && c.ctrl === c.id) c.warDays = (c.warDays || 0) + 1;

      // Крупные державы строят заводы
      if (c.major && c.ctrl === c.id && U.chance(0.004 * (t >= 50 ? 1.5 : 1))) c.factories += 1;
    });

    this.thresholds();
    this.offensives();
    this.spontaneousWars();
    this.peaceOffers();
    this.nuclearPosture();
  },

  // Какая ИИ-страна командует этой территорией (сама или оккупант)
  owner(c) { return c.ctrl === c.id ? c : Game.c(c.ctrl); },

  /* Пороги напряжённости — с «гистерезисом»: событие повторится,
     только если напряжённость сначала заметно упадёт */
  thresholds() {
    const S = Game.S, t = S.tension, F = S.flags;

    if (t >= 50 && !F.mob50) {
      F.mob50 = true;
      Game.eachCountry(c => {
        if (BLOCS.includes(c.faction) && c.ctrl === c.id && !c.radioactive) {
          c.divs = c.divs * 1.2 + 1;
          c.fort = Math.min(3, c.fort + 1);
        }
      });
      Game.log('alert', 'Оборонительная мобилизация', 'Блоки призывают резервистов и укрепляют границы: +20% дивизий у стран под управлением ИИ, +1 уровень укреплений.', null, null);
      Game.popup({
        id: 'sys_mob50', art: 'i-tension', cat: 'alert',
        title: 'Мир мобилизуется',
        text: 'Мировая напряжённость превысила 50%. Столицы объявляют оборонительную мобилизацию. Каждое наше движение теперь встречают сотни тысяч штыков.',
        options: [
          { label: 'Ответная мобилизация', tip: '−30 ПВ · +5 дивизий сразу · напряжённость +3', fx: () => { Game.addPP(-30); Game.addDivs(5); Game.addTension(3); } },
          { label: 'Сохранять спокойствие', tip: 'Напряжённость −3', fx: () => Game.addTension(-3) }
        ]
      }, {}, null);
    } else if (t < 40) F.mob50 = false;

    if (t >= 75 && !F.defcon2) {
      F.defcon2 = true;
      Game.eachCountry(c => { if (c.faction === 'WEST' && c.ctrl === c.id && !c.radioactive) c.divs *= 1.1; });
      const usa = Game.c('USA');
      if (usa && usa.ctrl === 'USA' && !usa.radioactive) usa.factories += 3;
      Game.log('alert', 'DEFCON 2', 'Стратегическая авиация переведена в повышенную боевую готовность.', null, null);
      Game.popup({
        id: 'sys_defcon', art: 'i-nuke', cat: 'alert',
        title: 'DEFCON 2',
        text: 'Бомбардировщики с ядерным оружием на борту круглосуточно патрулируют небо у границ. Одна ошибка — и начнётся конец света.',
        options: [
          { label: 'Привести войска в готовность', tip: 'Организация всех армий 100% · +10 ПВ · напряжённость +2', fx: () => { Game.setArmyOrg(100); Game.addPP(10); Game.addTension(2); } },
          { label: 'Снизить риторику', tip: '−15 ПВ · напряжённость −5', fx: () => { Game.addPP(-15); Game.addTension(-5); } }
        ]
      }, {}, null);
    } else if (t < 65) F.defcon2 = false;

    if (t >= 90 && !F.brink) {
      F.brink = true;
      Game.log('nuke', 'На грани', 'Мир в шаге от всеобщей ядерной войны. Любая провокация может стать последней.', null, null);
    } else if (t < 80) F.brink = false;
  },

  /* Наступления ИИ на приграничные земли держав, с которыми он воюет */
  offensives() {
    const S = Game.S;
    const aggr = 0.03 * (0.6 + S.tension / 100) * Game.diff.aiAggr;
    Game.eachCountry(src => {
      if (Game.isPower(src.ctrl) || src.divs < 1.5 || src.radioactive || src.inert) return;
      const k = this.owner(src);
      if (!k) return;
      const enemies = Object.keys(k.wars).filter(t => k.wars[t] && Game.isPower(t) && !Game.P(t).out);
      if (!enemies.length || !U.chance(aggr)) return;
      const targets = Geo.meta[src.id].neighbors.map(id => Game.c(id)).filter(c => c && enemies.includes(c.ctrl));
      if (!targets.length) return;
      const target = U.weightedPick(targets, t => (t.id === POWERS[t.ctrl].capital ? 0.5 : 1) + t.factories * 0.05);
      Game.enemyOffensive(src, target);
    });
  },

  /* При очень высокой напряжённости соседи сами нападают на державы чужих блоков */
  spontaneousWars() {
    const S = Game.S;
    if (S.tension < 80) return;
    for (const X of Game.alive()) {
      if (Game.fronts(X).filter(c => c.ctrl === c.id).length >= 4) continue;   // мир ждёт исхода уже идущих войн
      if (!U.chance(0.004 * Game.diff.aiAggr * (S.tension - 70) / 10)) continue;
      const hostile = BLOCS.filter(f => !POWERS[X].family.includes(f));
      const candidates = Object.values(S.countries).filter(c =>
        hostile.includes(c.faction) && c.ctrl === c.id && !c.wars[X] && !c.radioactive && c.divs >= 3 && Game.bordersPower(c.id, X));
      if (!candidates.length) continue;
      const c = U.weightedPick(candidates, c => c.divs);
      Game.aiDeclareWar(c.id, X, 'Мировая напряжённость достигла критической отметки');
    }
  },

  /* Реакция блока, когда держава X объявляет войну одному из его членов */
  onPlayerDeclares(target, X) {
    const S = Game.S;
    const fac = FACTIONS[target.faction];
    if (!fac || !fac.leader) return;
    const leader = Game.c(fac.leader);
    if (!leader || leader.id === target.id || leader.radioactive) return;

    // Лидер блока — живой игрок: просто предупреждаем его
    if (Game.isPower(leader.ctrl)) {
      if (leader.ctrl !== X) {
        Game.log('alert', 'Союзник атакован', `${POWERS[X].name} напали на нашего союзника: ${target.name}.`, target.id, leader.ctrl);
      }
      return;
    }
    if (leader.ctrl !== leader.id) return;

    const send = Math.min(leader.divs * 0.2, 8);
    if (send >= 1) {
      leader.divs -= send;
      target.divs += send;
      Game.log('alert', 'Экспедиционный корпус', `${leader.name} перебрасывает ${U.fmt(send, 0)} див. на помощь союзнику. Фронт: ${target.name}.`, target.id, X);
    }
    if (!leader.wars[X]) {
      const p = S.tension >= 75 ? 1 : S.tension / 150;
      if (U.chance(p)) Game.aiDeclareWar(leader.id, X, `Лидер блока «${fac.name}» выполняет союзнические обязательства`);
    }
  },

  /* Усталость от войны: затяжная война склоняет ИИ к миру на условиях статус-кво */
  peaceOffers() {
    const S = Game.S;
    for (const X of Game.alive()) {
      const key = 'nextPeaceOffer_' + X;
      if (S.day < (S.flags[key] || 0)) continue;
      for (const c of Game.fronts(X)) {
        if (c.ctrl !== c.id || c.radioactive || !c.wars[X]) continue;
        const p = 0.002 + (c.warDays || 0) / 365 * 0.004 + (c.control < 50 ? 0.004 : 0);
        if (!U.chance(p)) continue;
        S.flags[key] = S.day + 30;
        Game.log('dip', 'Мирное предложение', `Противник устал от войны и предлагает мир. Страна: ${c.name}.`, c.id, X);
        Game.popup({
          id: 'sys_peace_' + c.id, art: 'i-flag', cat: 'dip',
          title: 'Предложение о мире',
          text: `Война истощила обе стороны. Посол предлагает подписать мир на условиях статус-кво: оккупированные земли возвращаются прежним хозяевам. Сторона договора: ${c.name}.`,
          options: [
            { label: 'Принять мир', tip: 'Война окончена · напряжённость −5', fx: () => Game.makePeace(c, X) },
            { label: 'Продолжать войну', tip: 'Фронт остаётся активным', fx: () => {} }
          ]
        }, {}, X);
        break;
      }
    }
  },

  /* Ядерная доктрина США (если за них играет ИИ): первый удар — только по ядерной державе
     на грани войны и не больше двух раз за игру. Иначе игрок мог бы проиграть «ядерной зимой»,
     ни разу не нажав пуск. */
  nuclearPosture() {
    const S = Game.S;
    const usa = Game.c('USA');
    if (!usa || usa.ctrl !== 'USA' || usa.radioactive || S.tension < 95) return;
    for (const X of Game.alive()) {
      if (!usa.wars[X] || !Game.modsFor(X).nukes) continue;
      const k = 'aiFirstStrikes_' + X;
      if ((S.flags[k] || 0) >= 2 || !U.chance(0.004)) continue;
      S.flags[k] = (S.flags[k] || 0) + 1;
      this.enemyNuke(usa, X);
    }
  },

  enemyNuke(attacker, X) {
    if (!attacker || attacker.ctrl !== attacker.id || attacker.radioactive || !Game.isPower(X)) return;
    const S = Game.S, key = 'lastEnemyNuke_' + X;
    if (S.day - (S.flags[key] ?? -999) < 120) return;   // не чаще раза в 120 дней
    S.flags[key] = S.day;
    const cap = POWERS[X].capital;
    const targets = Game.lands(X).filter(c => c.id !== cap && !c.radioactive);
    const target = targets.length ? U.weightedPick(targets, c => 1 + c.factories) : null;
    if (!target) {
      Game.log('nuke', 'Перехват над столицей', `Система ПРО перехватила боеголовку. Удар нанесла держава: ${attacker.name}.`, cap, X);
      return;
    }
    Game.as(X, () => Game.applyNuclearDamage(target, false));
    S.tension = Math.min(100, S.tension + 10);
    Game.log('nuke', 'ЯДЕРНЫЙ УДАР', `Удар нанесла держава: ${attacker.name}. Цель: ${target.name}. Регион превращён в радиоактивную пустошь.`, target.id, null);
    Bus.emit('enemyNuke', { from: attacker.id, target: target.id, power: X });
    Game.popup({
      id: 'sys_enemy_nuke', art: 'i-nuke', cat: 'nuke',
      title: 'Ядерный удар по нашей территории',
      text: `Над территорией — ${target.name} — вспыхнуло второе солнце. Связь с местными властями потеряна. Ответственность лежит на тех, кто выбрал эскалацию.`,
      options: [{ label: 'Мы выстоим', tip: 'Регион потерял все заводы', fx: () => {} }]
    }, {}, X);
    Game.checkEnd();
  }
};
