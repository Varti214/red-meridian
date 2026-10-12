'use strict';
/* ============================================================
   СОБЫТИЯ И МИРОВЫЕ НОВОСТИ (сценарий 2018 года).

   EVENTS — события с выбором. Поля:
     date    — наступит не раньше этой даты (если выполнено условие cond);
     weight  — случайное событие (участвует в розыгрыше раз в 1–2 месяца);
     powers  — каким державам приходит (по умолчанию — всем);
     options — варианты для всех; opts — свои варианты у каждой державы { SOV, WST, AXS };
     world   — что меняется в мире один раз, когда событие наступило впервые;
     setup   — готовит контекст (ctx) для текста и вариантов.
   WORLD_NEWS — новости без выбора: просто случаются в свой день.
   RANDOM_NEWS — шаблоны случайных новостей о странах мира.
   ============================================================ */

/* Короткие помощники для эффектов */
const EV = {
  pop(id, ide, n) { const c = Game.c(id); if (c && c.pol) Game.shiftPop(c.pol, ide, n); },
  gov(id, ide, leader, how) { const c = Game.c(id); if (c && c.pol && c.ctrl === c.id) Game.setGov(c, ide, leader, how || 'event'); },
  ide(id) { const c = Game.c(id); const g = c && Game.gov(c); return g ? g.ide : null; },
  indep: id => Game.isIndependent(id),
  played: tag => Game.isPower(tag) && !Game.P(tag).out,
  // Нейтральная страна вступает в блок текущей державы с вероятностью p
  join(id, p = 1) {
    const c = Game.c(id);
    if (!c || c.ctrl !== c.id || c.faction !== 'NEU' || Game.tags().some(t => c.wars[t]) || !U.chance(p)) return false;
    Game.setFaction(id, POWERS[Game.cur].allyFaction);
    return true;
  },
  help(id) { const c = Game.c(id); if (c && c.pol) c.pol.helped[Game.cur] = Game.S.day; },
  divs(id, n) { const c = Game.c(id); if (c && c.ctrl === c.id) c.divs = Math.max(0, c.divs + n); },
  fac(id, n) { const c = Game.c(id); if (c && c.ctrl === c.id && !c.radioactive) c.factories = Math.max(0, c.factories + n); },
  myFac(n) { if (n >= 0) Game.addFactories(n); else { const c = Game.c(POWERS[Game.cur].capital); if (c && c.ctrl === Game.cur) c.factories = Math.max(0, c.factories + n); } },
  cb(id) {
    const c = Game.c(id);
    if (!c || c.inert || c.ctrl === Game.cur || Game.isAlly(c) || Game.atWar(c)) return;
    if (c.ctrl !== c.id && !Game.isPower(c.ctrl)) return;
    c.cb[Game.cur] = true;
    Bus.emit('mapDirty');
  },
  intel(id, n) { const c = Game.c(id); if (c) c.intel[Game.cur] = Math.min(100, Game.intel(c) + n); },
  spirit: (tag, id, name, fx, days, desc) => Game.addSpirit(tag, id, name, fx, days, desc),
  nuclear(days, rp) { if (!Game.boostResearch('nuclear', days)) Game.addRP(rp); },
  // Самая популярная оппозиционная идеология страны
  opposition(c) {
    const pol = Game.gov(c);
    return Object.entries(pol.pop).filter(([k]) => k !== pol.ide).sort((a, b) => b[1] - a[1])[0] || ['lib', 0];
  },
  // Случайная независимая страна по условию (для событий с «подставной» целью)
  randomCountry(pred) {
    const list = Game.list(c => c.ctrl === c.id && !c.inert && !c.radioactive && c.pol && !Game.isPower(c.ctrl) && pred(c));
    return list.length ? U.pick(list) : null;
  }
};

const EVENTS = [
  /* ===================== 2018 ===================== */
  {
    id: 'skripal', date: '2018-03-05', art: 'i-eye', cat: 'intel',
    title: 'Дело Скрипалей',
    text: 'В британском Солсбери отравлены бывший офицер ГРУ Сергей Скрипаль и его дочь. Лондон возлагает ответственность на Москву, союзники готовят массовую высылку дипломатов.',
    opts: {
      SOV: [
        { label: 'Отрицать причастность', tip: '+10 ПВ · напряжённость +3 · санкции продлены', fx: () => { Game.addPP(10); Game.addTension(3); EV.spirit('SOV', 'sanctions', 'Санкции Запада', { pp: -0.3, rp: -0.05 }, 720); } },
        { label: 'Предложить совместное расследование', tip: '−15 ПВ · напряжённость −2', fx: () => { Game.addPP(-15); Game.addTension(-2); } }
      ],
      WST: [
        { label: 'Выслать российских дипломатов', tip: '+10 ПВ · напряжённость +3 · разведданные по России +20', fx: () => { Game.addPP(10); Game.addTension(3); EV.intel('RUS', 20); } },
        { label: 'Ограничиться заявлением', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      AXS: [
        { label: 'Призвать стороны к сдержанности', tip: '+8 ПВ', fx: () => Game.addPP(8) },
        { label: 'Поддержать Москву', tip: '+12 ПВ · напряжённость +1', fx: () => { Game.addPP(12); Game.addTension(1); } }
      ]
    }
  },
  {
    id: 'armenia', date: '2018-04-23', art: 'i-flag', cat: 'dip',
    cond: () => EV.indep('ARM'),
    world: () => { if (EV.ide('ARM') === 'con') EV.gov('ARM', 'lib', 'Никол Пашинян', 'protest'); },
    title: 'Бархатная революция в Армении',
    text: 'После многодневных протестов в Ереване премьер Серж Саргсян уходит в отставку. Лидер улицы Никол Пашинян возглавляет правительство.',
    opts: {
      SOV: [
        { label: 'Работать с новой властью', tip: '+5 ПВ', fx: () => Game.addPP(5) },
        { label: 'Давить на Ереван', tip: '−15 ПВ · государственники в Армении +12%', fx: () => { Game.addPP(-15); EV.pop('ARM', 'auth', 12); EV.help('ARM'); } }
      ],
      WST: [
        { label: 'Поддержать демократию', tip: 'Либералы в Армении +8% · напряжённость +1', fx: () => { EV.pop('ARM', 'lib', 8); EV.help('ARM'); Game.addTension(1); } },
        { label: 'Не вмешиваться', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },
  {
    id: 'iran_deal', date: '2018-05-08', art: 'i-nuke', cat: 'alert',
    cond: () => EV.indep('IRN'),
    title: 'Ядерная сделка с Ираном',
    text: () => Game.cur === 'WST'
      ? 'Советники требуют выйти из ядерной сделки с Ираном и вернуть санкции. Европейские союзники умоляют сохранить договор.'
      : 'Вашингтон грозит выйти из ядерной сделки с Ираном и вернуть санкции. Тегеран обещает возобновить обогащение урана.',
    opts: {
      WST: [
        { label: 'Выйти из сделки', tip: '+15 ПВ · напряжённость +3 · повод для войны с Ираном', fx: () => { Game.addPP(15); Game.addTension(3); EV.cb('IRN'); } },
        { label: 'Сохранить сделку', tip: '−10 ПВ · напряжённость −3', fx: () => { Game.addPP(-10); Game.addTension(-3); } }
      ],
      SOV: [
        { label: 'Поддержать Тегеран', tip: '−15 ПВ · 30%: Иран вступает в ОДКБ', fx: () => { Game.addPP(-15); EV.help('IRN'); EV.join('IRN', 0.3); } },
        { label: 'Сохранить нейтралитет', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      AXS: [
        { label: 'Покупать иранскую нефть', tip: '+2 завода · 25%: Иран вступает в «Пояс и путь»', fx: () => { EV.myFac(2); EV.help('IRN'); EV.join('IRN', 0.25); } },
        { label: 'Соблюдать санкции', tip: '+5 ПВ · напряжённость −1', fx: () => { Game.addPP(5); Game.addTension(-1); } }
      ]
    }
  },
  {
    id: 'singapore', date: '2018-06-12', art: 'i-flag', cat: 'dip',
    cond: () => EV.indep('PRK'),
    title: 'Саммит в Сингапуре',
    text: () => `${Game.leaderOf('WST')} и Ким Чен Ын впервые встречаются лично. На кону — денуклеаризация Корейского полуострова.`,
    opts: {
      WST: [
        { label: 'Протянуть руку Пхеньяну', tip: '+10 ПВ · напряжённость −6', fx: () => { Game.addPP(10); Game.addTension(-6); } },
        { label: 'Сорвать саммит', tip: 'Напряжённость +3 · повод для войны с КНДР', fx: () => { Game.addTension(3); EV.cb('PRK'); } }
      ],
      AXS: [
        { label: 'Поддержать диалог', tip: '+5 ПВ · напряжённость −3', fx: () => { Game.addPP(5); Game.addTension(-3); } },
        { label: 'Укрепить союз с КНДР', tip: 'КНДР +3 дивизии · +10 ПВ', fx: () => { EV.divs('PRK', 3); Game.addPP(10); } }
      ],
      SOV: [
        { label: 'Предложить посредничество', tip: '+10 ПВ · напряжённость −2', fx: () => { Game.addPP(10); Game.addTension(-2); } }
      ]
    }
  },
  {
    id: 'worldcup', date: '2018-06-14', art: 'i-globe', cat: 'success',
    title: 'Чемпионат мира по футболу',
    text: 'В Москве открывается чемпионат мира по футболу. Миллион болельщиков со всего света едут в одиннадцать российских городов.',
    opts: {
      SOV: [
        { label: 'Праздник для всего мира', tip: 'Напряжённость −4 · популярность власти +5%', fx: () => { Game.addTension(-4); Game.addPop('ruling', 5); } },
        { label: 'Пропагандистский триумф', tip: '+30 ПВ', fx: () => Game.addPP(30) }
      ],
      WST: [
        { label: 'Отправить делегацию', tip: '+5 ПВ · напряжённость −2', fx: () => { Game.addPP(5); Game.addTension(-2); } },
        { label: 'Дипломатический бойкот', tip: '+10 ПВ · напряжённость +1', fx: () => { Game.addPP(10); Game.addTension(1); } }
      ],
      AXS: [
        { label: 'Отправить делегацию', tip: '+5 ПВ · напряжённость −2', fx: () => { Game.addPP(5); Game.addTension(-2); } }
      ]
    }
  },
  {
    id: 'pension', date: '2018-06-16', art: 'i-mp', cat: 'info', powers: ['SOV'],
    title: 'Пенсионная реформа',
    text: 'Правительство предлагает поднять пенсионный возраст на пять лет. Бюджет сэкономит триллионы, но по стране прокатываются протесты.',
    options: [
      { label: 'Провести реформу', tip: '+3 завода · популярность власти −8%', fx: () => { EV.myFac(3); Game.addPop('ruling', -8); } },
      { label: 'Смягчить реформу', tip: '+1 завод · −15 ПВ · популярность власти −3%', fx: () => { EV.myFac(1); Game.addPP(-15); Game.addPop('ruling', -3); } },
      { label: 'Отказаться от реформы', tip: '−25 ПВ · популярность власти +3%', fx: () => { Game.addPP(-25); Game.addPop('ruling', 3); } }
    ]
  },
  {
    id: 'tradewar', date: '2018-07-06', art: 'i-factory', cat: 'alert',
    title: 'Торговая война',
    text: 'США вводят пошлины на китайские товары на сотни миллиардов долларов. Пекин обещает ответить зеркально. Рынки лихорадит.',
    opts: {
      WST: [
        { label: 'Пошлины на всё', tip: '+3 завода · напряжённость +3 · Китаю — «Торговая война» на год', fx: () => { EV.myFac(3); Game.addTension(3); EV.spirit('AXS', 'tradewar', 'Торговая война', { pp: -0.2, rp: -0.05 }, 365, 'Пошлины США бьют по экспорту.'); } },
        { label: 'Сделка «первой фазы»', tip: '−10 ПВ · напряжённость −2', fx: () => { Game.addPP(-10); Game.addTension(-2); } }
      ],
      AXS: [
        { label: 'Ответные пошлины', tip: '+15 ПВ · напряжённость +2 · США — «Торговая война» на год', fx: () => { Game.addPP(15); Game.addTension(2); EV.spirit('WST', 'tradewar', 'Торговая война', { pp: -0.2 }, 365, 'Фермеры теряют китайский рынок.'); } },
        { label: 'Пойти на уступки', tip: '−2 завода · напряжённость −3', fx: () => { EV.myFac(-2); Game.addTension(-3); } }
      ],
      SOV: [
        { label: 'Развернуть экономику на Восток', tip: '+2 завода', fx: () => EV.myFac(2) },
        { label: 'Выжидать', tip: '+8 ПВ', fx: () => Game.addPP(8) }
      ]
    }
  },
  {
    id: 'midterms', date: '2018-11-06', art: 'i-flag', cat: 'dip', powers: ['WST'], noNews: true,
    setup: () => ({ lost: (Game.powerGov('WST').pop[Game.powerIde('WST')] || 0) + U.rand(-4, 4) < 44 }),
    title: 'Промежуточные выборы',
    text: ctx => ctx.lost
      ? 'Оппозиция берёт Палату представителей. Каждый бюджет и каждое назначение теперь будут даваться с боем.'
      : 'Партия президента удерживает обе палаты Конгресса. У Белого дома развязаны руки.',
    options: [
      { label: 'Продолжать курс', tip: 'Итог зависит от популярности партии власти', fx: ctx => {
        if (ctx.lost) EV.spirit('WST', 'divided', 'Разделённый Конгресс', { pp: -0.3 }, 730, 'Оппозиция контролирует Палату представителей.');
        else Game.addPP(30);
      } }
    ]
  },
  {
    id: 'kerch', date: '2018-11-25', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('UKR'),
    title: 'Инцидент в Керченском проливе',
    text: 'Пограничники задерживают три корабля ВМС Украины, пытавшихся пройти в Азовское море. Киев вводит военное положение.',
    opts: {
      SOV: [
        { label: 'Задержать экипажи', tip: '+15 ПВ · напряжённость +3 · Россия — Украина +8', fx: () => { Game.addPP(15); Game.addTension(3); EV.pop('UKR', 'nat', 5); Game.addRUUA(8); } },
        { label: 'Вернуть корабли', tip: '−10 ПВ · напряжённость −2 · Россия — Украина −5', fx: () => { Game.addPP(-10); Game.addTension(-2); Game.addRUUA(-5); } }
      ],
      UA: [
        { label: 'Ввести военное положение', tip: '+20 ПВ · популярность власти +3% · Россия — Украина +5 · доверие Запада +3', fx: () => { Game.addPP(20); Game.addPop('ruling', 3); Game.addRUUA(5); Game.addUAW(3); } },
        { label: 'Дипломатический протест', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      WST: [
        { label: 'Новые санкции против Москвы', tip: 'Напряжённость +2 · России продлены санкции', fx: () => { Game.addTension(2); EV.spirit('SOV', 'sanctions', 'Санкции Запада', { pp: -0.3, rp: -0.05 }, 540); } },
        { label: 'Призвать к сдержанности', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },
  {
    id: 'huawei', date: '2018-12-01', art: 'i-eye', cat: 'intel',
    title: 'Арест в Ванкувере',
    text: 'По запросу США в Канаде арестована финансовый директор Huawei Мэн Ваньчжоу. Пекин называет это политическим заложничеством.',
    opts: {
      AXS: [
        { label: 'Ответные меры', tip: '+15 ПВ · напряжённость +2', fx: () => { Game.addPP(15); Game.addTension(2); } },
        { label: 'Тихая дипломатия', tip: '−10 ПВ · напряжённость −1', fx: () => { Game.addPP(-10); Game.addTension(-1); } }
      ],
      WST: [
        { label: 'Запретить Huawei в сетях 5G', tip: '+40 ОИ · напряжённость +2 · Китаю −5% ОИ на год', fx: () => { Game.addRP(40); Game.addTension(2); EV.spirit('AXS', 'chipban', 'Технологическая блокада', { rp: -0.05 }, 365); } },
        { label: 'Не обострять', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },

  /* ===================== 2019 ===================== */
  {
    id: 'venezuela', date: '2019-01-23', art: 'i-flag', cat: 'dip',
    cond: () => EV.indep('VEN') && EV.ide('VEN') === 'soc',
    title: 'Двоевластие в Венесуэле',
    text: 'Глава парламента Хуан Гуайдо провозглашает себя временным президентом Венесуэлы. Николас Мадуро называет это попыткой переворота.',
    opts: {
      WST: [
        { label: 'Признать Гуайдо', tip: 'Либералы в Венесуэле +12% · 30%: Гуайдо получает власть · напряжённость +2',
          fx: () => { EV.pop('VEN', 'lib', 12); EV.help('VEN'); Game.addTension(2); if (U.chance(0.3)) EV.gov('VEN', 'lib', 'Хуан Гуайдо', 'protest'); } },
        { label: 'Не вмешиваться', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      SOV: [
        { label: 'Поддержать Мадуро', tip: '−20 ПВ · социалисты в Венесуэле +10% · 40%: Венесуэла вступает в ОДКБ',
          fx: () => { Game.addPP(-20); EV.pop('VEN', 'soc', 10); EV.help('VEN'); EV.join('VEN', 0.4); } },
        { label: 'Нейтралитет', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      AXS: [
        { label: 'Кредиты Каракасу', tip: '−15 ПВ · социалисты +6% · 30%: Венесуэла вступает в «Пояс и путь»',
          fx: () => { Game.addPP(-15); EV.pop('VEN', 'soc', 6); EV.help('VEN'); EV.join('VEN', 0.3); } },
        { label: 'Нейтралитет', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },
  {
    id: 'inf', date: '2019-02-01', art: 'i-nuke', cat: 'alert',
    title: 'Конец договора о ракетах',
    text: 'США объявляют о выходе из Договора о ракетах средней и меньшей дальности. Через полгода договор 1987 года прекратит действие.',
    opts: {
      WST: [
        { label: 'Выйти из договора', tip: 'Ядерная ветка быстрее на 20 дней (или +60 ОИ) · напряжённость +4', fx: () => { EV.nuclear(20, 60); Game.addTension(4); } },
        { label: 'Остаться в договоре', tip: '+10 ПВ · напряжённость −2', fx: () => { Game.addPP(10); Game.addTension(-2); } }
      ],
      SOV: [
        { label: 'Зеркальный ответ', tip: 'Ядерная ветка быстрее на 20 дней (или +60 ОИ) · напряжённость +3', fx: () => { EV.nuclear(20, 60); Game.addTension(3); } },
        { label: 'Призвать к переговорам', tip: '+10 ПВ · напряжённость −2', fx: () => { Game.addPP(10); Game.addTension(-2); } }
      ],
      AXS: [
        { label: 'Нарастить ракетные силы', tip: 'Ядерная ветка быстрее на 15 дней (или +40 ОИ)', fx: () => EV.nuclear(15, 40) },
        { label: 'Остаться в стороне', tip: '+8 ПВ', fx: () => Game.addPP(8) }
      ]
    }
  },
  {
    id: 'hongkong', date: '2019-06-09', art: 'i-flag', cat: 'alert',
    cond: () => EV.played('AXS') || EV.indep('CHN'),
    title: 'Протесты в Гонконге',
    text: 'Сотни тысяч человек выходят на улицы Гонконга против закона об экстрадиции в материковый Китай. Протесты не утихают неделями.',
    opts: {
      AXS: [
        { label: 'Жёсткий курс', tip: '+20 ПВ · напряжённость +2 · либералы в Китае −3%', fx: () => { Game.addPP(20); Game.addTension(2); Game.addPop('lib', -3); } },
        { label: 'Уступить протестующим', tip: '−15 ПВ · либералы в Китае +5% · напряжённость −2', fx: () => { Game.addPP(-15); Game.addPop('lib', 5); Game.addTension(-2); } }
      ],
      WST: [
        { label: 'Поддержать протестующих', tip: '+10 ПВ · либералы в Китае +4% · напряжённость +2', fx: () => { Game.addPP(10); EV.pop('CHN', 'lib', 4); Game.addTension(2); } },
        { label: 'Не вмешиваться', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      SOV: [
        { label: 'Это внутреннее дело Китая', tip: '+8 ПВ', fx: () => Game.addPP(8) }
      ]
    }
  },
  {
    id: 'powersiberia', date: '2019-12-02', art: 'i-factory', cat: 'success',
    title: '«Сила Сибири»',
    text: 'Запущен газопровод «Сила Сибири»: якутский газ впервые идёт в Китай по трубе длиной три тысячи километров.',
    opts: {
      SOV: [{ label: 'Газ пошёл!', tip: '+3 завода · +10 ПВ', fx: () => { EV.myFac(3); Game.addPP(10); } }],
      AXS: [{ label: 'Энергия для промышленности', tip: '+2 завода', fx: () => EV.myFac(2) }]
    }
  },
  {
    id: 'nordstream', date: '2019-12-20', art: 'i-factory', cat: 'dip',
    title: '«Северный поток — 2»',
    text: 'Конгресс США вводит санкции против газопровода «Северный поток — 2». Укладка труб на дне Балтики останавливается.',
    opts: {
      SOV: [
        { label: 'Достроить своими силами', tip: '−25 ПВ · +3 завода', fx: () => { Game.addPP(-25); EV.myFac(3); } },
        { label: 'Заморозить проект', tip: '+10 ПВ · −1 завод', fx: () => { Game.addPP(10); EV.myFac(-1); } }
      ],
      WST: [
        { label: 'Санкции против газопровода', tip: '+10 ПВ · России −1 завод · напряжённость +2', fx: () => { Game.addPP(10); EV.fac('RUS', -1); if (Game.isPower('SOV')) { const c = Game.c('RUS'); if (c.ctrl === 'SOV') c.factories = Math.max(0, c.factories - 1); } Game.addTension(2); } },
        { label: 'Не мешать европейцам', tip: '+5 ПВ · напряжённость −1', fx: () => { Game.addPP(5); Game.addTension(-1); } }
      ]
    }
  },

  /* ===================== 2020 ===================== */
  {
    id: 'soleimani', date: '2020-01-03', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('IRN'),
    title: 'Генерал Сулеймани',
    text: () => Game.cur === 'WST'
      ? 'Разведка докладывает: командующий силами «Кудс» Касем Сулеймани прилетает в Багдад. Беспилотник готов нанести удар.'
      : 'Американский беспилотник наносит удар у аэропорта Багдада: погиб командующий силами «Кудс» Касем Сулеймани. Иран обещает отомстить.',
    opts: {
      WST: [
        { label: 'Нанести удар', tip: '+15 ПВ · напряжённость +5 · теократы в Иране +6%', fx: () => { Game.addPP(15); Game.addTension(5); EV.pop('IRN', 'theo', 6); } },
        { label: 'Отменить операцию', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      SOV: [{ label: 'Осудить удар', tip: '+8 ПВ · разведданные по Ирану +20', fx: () => { Game.addPP(8); EV.intel('IRN', 20); EV.help('IRN'); } }],
      AXS: [{ label: 'Призвать к сдержанности', tip: '+8 ПВ', fx: () => Game.addPP(8) }]
    }
  },
  {
    id: 'covid', date: '2020-01-23', art: 'i-tension', cat: 'alert',
    world: () => Game.eachCountry(c => { if (c.ctrl === c.id && !Game.isPower(c.ctrl)) c.divs *= 0.95; }),
    title: 'Пандемия коронавируса',
    text: 'В Ухане вводится карантин: новый коронавирус распространяется по миру. Больницы переполнены, границы закрываются одна за другой.',
    options: [
      { label: 'Жёсткий локдаун', tip: '«Пандемия»: −0,4 ПВ и −20% призыва на 150 дней · популярность власти +4%',
        fx: () => { EV.spirit(Game.cur, 'covid', 'Пандемия', { pp: -0.4, mpMult: -0.2 }, 150, 'Карантин, закрытые границы, пустые улицы.'); Game.addPop('ruling', 4); } },
      { label: 'Сохранить экономику открытой', tip: '«Пандемия»: −30% призыва и −5% ОИ на 300 дней · популярность власти −4%',
        fx: () => { EV.spirit(Game.cur, 'covid', 'Пандемия', { mpMult: -0.3, rp: -0.05 }, 300, 'Больницы переполнены.'); Game.addPop('ruling', -4); } },
      { label: 'Ставка на свою вакцину', tip: '−80 ОИ · «Пандемия»: −0,3 ПВ и −15% призыва на 200 дней',
        fx: () => { Game.addRP(-80); EV.spirit(Game.cur, 'covid', 'Пандемия', { pp: -0.3, mpMult: -0.15 }, 200, 'Учёные работают над вакциной.'); } }
    ]
  },
  {
    id: 'oilwar', date: '2020-03-06', art: 'i-factory', cat: 'alert',
    title: 'Нефтяная война',
    text: 'Переговоры ОПЕК+ в Вене провалились. Саудовская Аравия обрушивает цены: нефть дешевеет на треть за один день.',
    opts: {
      SOV: [
        { label: 'Не сокращать добычу', tip: '+15 ПВ · «Дешёвая нефть»: −0,3 ПВ в день на 180 дней', fx: () => { Game.addPP(15); EV.spirit('SOV', 'cheapoil', 'Дешёвая нефть', { pp: -0.3 }, 180); } },
        { label: 'Договориться с Эр-Риядом', tip: '−10 ПВ · +2 завода', fx: () => { Game.addPP(-10); EV.myFac(2); } }
      ],
      WST: [
        { label: 'Спасать сланцевую отрасль', tip: '−20 ПВ · +2 завода', fx: () => { Game.addPP(-20); EV.myFac(2); } },
        { label: 'Пусть рынок решает', tip: '+10 ПВ · −1 завод', fx: () => { Game.addPP(10); EV.myFac(-1); } }
      ],
      AXS: [
        { label: 'Заполнить резервы дешёвой нефтью', tip: '+3 завода', fx: () => EV.myFac(3) }
      ]
    }
  },
  {
    id: 'galwan', date: '2020-06-15', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('IND'),
    title: 'Столкновение в долине Галван',
    text: 'В Гималаях китайские и индийские военные сходятся в рукопашной на спорной границе. Есть погибшие с обеих сторон.',
    opts: {
      AXS: [
        { label: 'Нарастить силы на границе', tip: 'Повод для войны с Индией · напряжённость +3', fx: () => { EV.cb('IND'); Game.addTension(3); } },
        { label: 'Деэскалация', tip: '+10 ПВ · напряжённость −3', fx: () => { Game.addPP(10); Game.addTension(-3); } }
      ],
      WST: [
        { label: 'Поддержать Индию', tip: 'Разведданные по Индии +20 · 20%: Индия вступает в НАТО', fx: () => { EV.intel('IND', 20); EV.help('IND'); EV.join('IND', 0.2); } },
        { label: 'Нейтралитет', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      SOV: [
        { label: 'Посредничество', tip: '+10 ПВ · напряжённость −2 · 15%: Индия вступает в ОДКБ', fx: () => { Game.addPP(10); Game.addTension(-2); EV.help('IND'); EV.join('IND', 0.15); } }
      ]
    }
  },
  {
    id: 'belarus', date: '2020-08-10', art: 'i-flag', cat: 'alert',
    cond: () => EV.indep('BLR') && ['auth', 'nat', 'com'].includes(EV.ide('BLR')),
    title: 'Протесты в Беларуси',
    text: () => `После президентских выборов в Беларуси начинаются крупнейшие в её истории протесты. Оппозиция не признаёт победу: ${Game.leaderLabel(Game.c('BLR').pol)}.`,
    opts: {
      SOV: [
        { label: 'Поддержать Минск', tip: '−20 ПВ · государственники в Беларуси +12%', fx: () => { Game.addPP(-20); EV.pop('BLR', 'auth', 12); EV.help('BLR'); } },
        { label: 'Ставка на оппозицию', tip: 'Либералы в Беларуси +10% · 40%: власть меняется', fx: () => { EV.pop('BLR', 'lib', 10); EV.help('BLR'); if (U.chance(0.4)) EV.gov('BLR', 'lib', 'Светлана Тихановская', 'protest'); } },
        { label: 'Интеграция в Союзное государство', tip: '−40 ПВ · если Беларусь в ОДКБ — она входит в состав России',
          fx: () => { const c = Game.c('BLR'); Game.addPP(-40); if (c && Game.isAlly(c)) { Game.annexNation(c, Game.cur, { peaceful: true }); Game.news('Союзное государство', 'Беларусь входит в состав России.', 'BLR'); } } }
      ],
      WST: [
        { label: 'Санкции против Минска', tip: 'Либералы в Беларуси +6% · напряжённость +1', fx: () => { EV.pop('BLR', 'lib', 6); EV.help('BLR'); Game.addTension(1); } },
        { label: 'Не вмешиваться', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },
  {
    id: 'karabakh', date: '2020-09-27', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('ARM') && EV.indep('AZE'),
    world: () => { EV.divs('ARM', -2); EV.divs('AZE', -1); },
    title: 'Война в Нагорном Карабахе',
    text: 'На линии соприкосновения в Нагорном Карабахе начинается полномасштабная война между Арменией и Азербайджаном. Турция открыто поддерживает Баку.',
    opts: {
      SOV: [
        { label: 'Перемирие и миротворцы', tip: '−15 ПВ · напряжённость −2 · разведданные по Кавказу', fx: () => { Game.addPP(-15); Game.addTension(-2); EV.intel('ARM', 40); EV.intel('AZE', 40); EV.help('AZE'); } },
        { label: 'Поддержать Армению', tip: 'Армения +4 дивизии · напряжённость +2 · повод для войны с Азербайджаном', fx: () => { EV.divs('ARM', 4); Game.addTension(2); EV.cb('AZE'); } },
        { label: 'Не вмешиваться', tip: '+5 ПВ · либералы в Армении −6%', fx: () => { Game.addPP(5); EV.pop('ARM', 'lib', -6); } }
      ],
      WST: [
        { label: 'Призвать к миру', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },

  /* ===================== 2021 ===================== */
  {
    id: 'myanmar', date: '2021-02-01', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('MMR'),
    world: () => { if (IDEOLOGIES[EV.ide('MMR')].group === 'dem') EV.gov('MMR', 'auth', 'Мин Аун Хлайн', 'coup'); },
    title: 'Переворот в Мьянме',
    text: 'Армия Мьянмы арестовывает Аун Сан Су Чжи и объявляет чрезвычайное положение. Власть переходит к главнокомандующему Мин Аун Хлайну.',
    opts: {
      AXS: [
        { label: 'Признать военных', tip: '+5 ПВ · 35%: Мьянма вступает в «Пояс и путь»', fx: () => { Game.addPP(5); EV.help('MMR'); EV.join('MMR', 0.35); } },
        { label: 'Призвать к диалогу', tip: 'Напряжённость −1', fx: () => Game.addTension(-1) }
      ],
      WST: [
        { label: 'Санкции против хунты', tip: 'Либералы в Мьянме +8% · напряжённость +1', fx: () => { EV.pop('MMR', 'lib', 8); EV.help('MMR'); Game.addTension(1); } },
        { label: 'Не вмешиваться', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      SOV: [
        { label: 'Военное сотрудничество', tip: '+10 ПВ · 20%: Мьянма вступает в ОДКБ', fx: () => { Game.addPP(10); EV.help('MMR'); EV.join('MMR', 0.2); } }
      ]
    }
  },
  {
    id: 'kabul', date: '2021-08-15', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('AFG'),
    world: () => { if (!EV.played('WST') && IDEOLOGIES[EV.ide('AFG')].group === 'dem') EV.gov('AFG', 'theo', 'Хайбатулла Ахундзада', 'coup'); },
    title: 'Падение Кабула',
    text: 'Талибы стремительно наступают на Кабул. Правительство Афганистана на грани краха, у аэропорта — толпы людей.',
    opts: {
      WST: [
        { label: 'Вывести войска', tip: 'Талибы приходят к власти · напряжённость −2', fx: () => { EV.gov('AFG', 'theo', 'Хайбатулла Ахундзада', 'coup'); Game.addTension(-2); } },
        { label: 'Остаться в Афганистане', tip: '«Афганская война»: −0,3 ПВ в день на год · Афганистан +6 дивизий',
          fx: () => { EV.spirit('WST', 'afghan', 'Афганская война', { pp: -0.3 }, 365, 'Самая долгая война в истории США продолжается.'); EV.divs('AFG', 6); EV.help('AFG'); } }
      ],
      SOV: [
        { label: 'Контакты с талибами', tip: '+5 ПВ · разведданные по Афганистану +30', fx: () => { Game.addPP(5); EV.intel('AFG', 30); } },
        { label: 'Укрепить границы союзников', tip: 'Таджикистан +3 дивизии', fx: () => EV.divs('TJK', 3) }
      ],
      AXS: [
        { label: 'Инвестиции в рудники', tip: '+1 завод · разведданные по Афганистану +20', fx: () => { EV.myFac(1); EV.intel('AFG', 20); } }
      ]
    }
  },
  {
    id: 'aukus', date: '2021-09-15', art: 'i-shield', cat: 'mil',
    title: 'AUKUS',
    text: 'Австралия, Великобритания и США объявляют о военном союзе AUKUS: Канберра получит атомные подводные лодки.',
    opts: {
      WST: [
        { label: 'Подписать AUKUS', tip: 'Австралия +3 дивизии и +2 завода · напряжённость +2', fx: () => { EV.divs('AUS', 3); EV.fac('AUS', 2); Game.addTension(2); } },
        { label: 'Отложить', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      AXS: [
        { label: 'Осудить «блоковое мышление»', tip: '+10 ПВ · напряжённость +2', fx: () => { Game.addPP(10); Game.addTension(2); } },
        { label: 'Нарастить флот', tip: '+50 ОИ', fx: () => Game.addRP(50) }
      ]
    }
  },
  {
    id: 'ukraine_crisis', date: '2021-11-10', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('UKR') && !Game.tags().some(t => Game.c('UKR').wars[t]),
    title: 'Кризис вокруг Украины',
    text: 'Спутники фиксируют концентрацию войск у границ Украины. Мир обсуждает возможность большой войны в Европе.',
    opts: {
      SOV: [
        { label: 'Потребовать гарантий безопасности', tip: '+20 ПВ · повод для войны с Украиной · напряжённость +6 · Россия — Украина +20', fx: () => { Game.addPP(20); EV.cb('UKR'); Game.addTension(6); Game.addRUUA(20); } },
        { label: 'Поддержать пророссийские партии', tip: '−20 ПВ · «Оппозиционная платформа» +10%', fx: () => { Game.addPP(-20); EV.pop('UKR', 'auth', 10); EV.help('UKR'); } },
        { label: 'Деэскалация', tip: '+2 завода · напряжённость −5 · Россия — Украина −15', fx: () => { EV.myFac(2); Game.addTension(-5); Game.addRUUA(-15); } }
      ],
      UA: [
        { label: 'Мобилизация резервистов', tip: '+6 бригад · Россия — Украина +5', fx: () => { Game.addDivs(6); Game.addRUUA(5); } },
        { label: 'Переговоры с Москвой', tip: '−15 ПВ · Россия — Украина −10', fx: () => { Game.addPP(-15); Game.addRUUA(-10); } },
        { label: 'Просить оружие у Запада', tip: 'Оборона +10% на год · Россия — Украина +8 · доверие Запада +6', fx: () => { EV.spirit('UA', 'aid', 'Западная помощь', { defense: 0.1 }, 365); Game.addRUUA(8); Game.addUAW(6); } }
      ],
      WST: [
        { label: 'Поставки оружия Киеву', tip: 'Украина +4 дивизии · напряжённость +3 · доверие к Киеву +5 · 15%: Украина вступает в НАТО', fx: () => { EV.divs('UKR', 4); Game.addTension(3); EV.help('UKR'); EV.join('UKR', 0.15); Game.addUAW(5); } },
        { label: 'Дипломатия', tip: 'Напряжённость −3', fx: () => Game.addTension(-3) }
      ],
      AXS: [
        { label: 'Нейтралитет', tip: '+10 ПВ', fx: () => Game.addPP(10) }
      ]
    }
  },

  /* ===================== РОССИЯ И УКРАИНА ===================== */
  {
    id: 'ua_tomos', date: '2019-01-05', art: 'i-flag', cat: 'success', powers: ['UA', 'SOV'],
    cond: () => EV.indep('UKR') || EV.played('UA'),
    title: 'Томос',
    text: 'Вселенский патриарх подписывает томос об автокефалии Православной церкви Украины. Москва называет это расколом.',
    opts: {
      UA: [
        { label: 'Торжественная церемония', tip: '+20 ПВ · популярность власти +5% · Россия — Украина +5', fx: () => { Game.addPP(20); Game.addPop('ruling', 5); Game.addRUUA(5); } },
        { label: 'Без политики', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ],
      SOV: [
        { label: 'Осудить раскол', tip: '+10 ПВ · Россия — Украина +3', fx: () => { Game.addPP(10); Game.addRUUA(3); } },
        { label: 'Промолчать', tip: '+3 ПВ', fx: () => Game.addPP(3) }
      ]
    }
  },
  {
    id: 'prisoners', date: '2019-09-07', art: 'i-flag', cat: 'dip', powers: ['UA', 'SOV'],
    cond: () => !Game.ruuaWar(),
    title: 'Обмен пленными «35 на 35»',
    text: 'Россия и Украина впервые за годы обмениваются удерживаемыми: среди освобождённых — моряки из Керченского пролива.',
    options: [
      { label: 'Провести обмен', tip: 'Россия — Украина −8 · +10 ПВ', fx: () => { Game.addRUUA(-8); Game.addPP(10); } },
      { label: 'Затянуть переговоры', tip: '+5 ПВ · Россия — Украина +3', fx: () => { Game.addPP(5); Game.addRUUA(3); } }
    ]
  },
  {
    id: 'normandy', date: '2019-12-09', art: 'i-flag', cat: 'dip', powers: ['UA', 'SOV'],
    cond: () => !Game.ruuaWar(),
    title: 'Нормандский саммит в Париже',
    text: () => `Впервые за три года лидеры России, Украины, Франции и Германии садятся за один стол. ${Game.leaderOf('SOV')} и ${Game.isPower('UA') ? Game.leaderOf('UA') : Game.leaderLabel(Game.c('UKR').pol)} обсуждают Донбасс.`,
    opts: {
      SOV: [
        { label: 'Договориться о перемирии', tip: 'Россия — Украина −15 · напряжённость −3', fx: () => { Game.addRUUA(-15); Game.addTension(-3); } },
        { label: 'Жёсткая позиция', tip: '+15 ПВ · Россия — Украина +5', fx: () => { Game.addPP(15); Game.addRUUA(5); } }
      ],
      UA: [
        { label: 'Пойти на компромисс', tip: 'Россия — Украина −15 · популярность власти −4% · доверие Запада +4', fx: () => { Game.addRUUA(-15); Game.addPop('ruling', -4); Game.addUAW(4); } },
        { label: 'Никаких уступок', tip: 'Россия — Украина +5 · популярность власти +3%', fx: () => { Game.addRUUA(5); Game.addPop('ruling', 3); } }
      ]
    }
  },
  {
    id: 'ceasefire', date: '2020-07-27', art: 'i-shield', cat: 'dip', powers: ['UA', 'SOV'],
    cond: () => !Game.ruuaWar(),
    title: 'Полное перемирие на Донбассе',
    text: 'Контактная группа договаривается о полном и всеобъемлющем прекращении огня. Впервые за шесть лет на линии соприкосновения тихо.',
    options: [
      { label: 'Соблюдать перемирие', tip: 'Россия — Украина −10', fx: () => Game.addRUUA(-10) },
      { label: 'Использовать паузу для перегруппировки', tip: 'Организация армий 100% · Россия — Украина +3', fx: () => { Game.setArmyOrg(100); Game.addRUUA(3); } }
    ]
  },
  {
    id: 'r_shelling', weight: 3, art: 'i-swords', cat: 'alert', powers: ['UA', 'SOV'],
    cond: () => !Game.ruuaWar() && !!Game.ruuaSides(),
    title: 'Обстрел на линии соприкосновения',
    text: 'Под Авдеевкой и Горловкой снова гремит артиллерия. Стороны обвиняют друг друга в нарушении перемирия.',
    opts: {
      UA: [
        { label: 'Ответный огонь', tip: '+10 ПВ · Россия — Украина +6', fx: () => { Game.addPP(10); Game.addRUUA(6); } },
        { label: 'Соблюдать режим тишины', tip: 'Россия — Украина −3 · популярность власти −2%', fx: () => { Game.addRUUA(-3); Game.addPop('ruling', -2); } }
      ],
      SOV: [
        { label: 'Предупредить Киев', tip: '+10 ПВ · Россия — Украина +4', fx: () => { Game.addPP(10); Game.addRUUA(4); } },
        { label: 'Призвать к перемирию', tip: 'Россия — Украина −4', fx: () => Game.addRUUA(-4) }
      ]
    }
  },
  {
    id: 'r_drills_ua', weight: 2, art: 'i-div', cat: 'mil', powers: ['SOV'],
    cond: () => !Game.ruuaWar() && !!Game.ruuaSides(),
    title: 'Учения у границ Украины',
    text: 'Генштаб предлагает крупные учения в Ростовской и Брянской областях. Это сигнал Киеву — и Западу.',
    options: [
      { label: 'Провести учения', tip: 'Организация армий 100% · Россия — Украина +8 · напряжённость +2', fx: () => { Game.setArmyOrg(100); Game.addRUUA(8); Game.addTension(2); } },
      { label: 'Отменить', tip: '+5 ПВ · Россия — Украина −3', fx: () => { Game.addPP(5); Game.addRUUA(-3); } }
    ]
  },
  {
    id: 'ua_imf', weight: 2, art: 'i-pp', cat: 'info', powers: ['UA'],
    title: 'Транш МВФ',
    text: 'Международный валютный фонд готов выделить кредит, но требует поднять тарифы на газ и провести судебную реформу.',
    options: [
      { label: 'Принять условия', tip: '+3 завода · популярность власти −4% · доверие Запада +8', fx: () => { EV.myFac(3); Game.addPop('ruling', -4); Game.addUAW(8); } },
      { label: 'Отказаться', tip: '+10 ПВ', fx: () => Game.addPP(10) }
    ]
  },
  {
    id: 'ua_oligarchs', weight: 2, art: 'i-eye', cat: 'info', powers: ['UA'],
    title: 'Олигархи против реформ',
    text: 'Владельцы телеканалов и заводов блокируют реформы в Раде. Можно бросить им вызов — или договориться.',
    options: [
      { label: 'Деолигархизация', tip: '−25 ПВ · убрать дух «Коррупция» · популярность власти +4% · доверие Запада +8', fx: () => { Game.addPP(-25); Game.removeSpirit('UA', 'corruption'); Game.addPop('ruling', 4); Game.addUAW(8); } },
      { label: 'Договориться', tip: '+15 ПВ · доверие Запада −4', fx: () => { Game.addPP(15); Game.addUAW(-4); } }
    ]
  },
  {
    id: 'ua_volunteers', weight: 2, art: 'i-mp', cat: 'mil', powers: ['UA'],
    title: 'Добровольческие батальоны',
    text: 'Добровольцы просят включить их в состав ВСУ и выдать тяжёлое вооружение.',
    options: [
      { label: 'Включить в ВСУ', tip: '+4 бригады · националисты +3%', fx: () => { Game.addDivs(4); Game.addPop('nat', 3); } },
      { label: 'Распустить', tip: '+10 ПВ · Россия — Украина −3', fx: () => { Game.addPP(10); Game.addRUUA(-3); } }
    ]
  },

  /* ===================== 2022–2023 ===================== */
  {
    id: 'kazakhstan', date: '2022-01-02', art: 'i-flag', cat: 'alert',
    cond: () => EV.indep('KAZ'),
    title: 'Январские события в Казахстане',
    text: 'Подорожание газа выводит на улицы тысячи людей. Беспорядки охватывают Алматы и другие крупные города.',
    opts: {
      SOV: [
        { label: 'Ввести миротворцев ОДКБ', tip: '−15 ПВ · государственники в Казахстане +10%', fx: () => { Game.addPP(-15); EV.pop('KAZ', 'auth', 10); EV.help('KAZ'); } },
        { label: 'Не вмешиваться', tip: 'Либералы в Казахстане +8%', fx: () => EV.pop('KAZ', 'lib', 8) }
      ],
      AXS: [
        { label: 'Предложить помощь', tip: '+5 ПВ · 15%: Казахстан вступает в «Пояс и путь» (если нейтрален)', fx: () => { Game.addPP(5); EV.help('KAZ'); EV.join('KAZ', 0.15); } }
      ],
      WST: [
        { label: 'Призвать к сдержанности', tip: '+5 ПВ', fx: () => Game.addPP(5) }
      ]
    }
  },
  {
    id: 'taiwan', date: '2022-08-02', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('TWN'),
    title: 'Тайваньский кризис',
    text: 'Спикер Палаты представителей США прилетает на Тайвань. Пекин объявляет масштабные учения с блокадой острова.',
    opts: {
      AXS: [
        { label: 'Учения с блокадой острова', tip: 'Повод для войны с Тайванем · напряжённость +5', fx: () => { EV.cb('TWN'); Game.addTension(5); } },
        { label: 'Ограничиться протестом', tip: '+10 ПВ', fx: () => Game.addPP(10) }
      ],
      WST: [
        { label: 'Поддержать Тайбэй', tip: 'Тайвань +3 дивизии · напряжённость +3 · 25%: Тайвань вступает в НАТО', fx: () => { EV.divs('TWN', 3); Game.addTension(3); EV.help('TWN'); EV.join('TWN', 0.25); } },
        { label: 'Снизить градус', tip: 'Напряжённость −2', fx: () => Game.addTension(-2) }
      ],
      SOV: [
        { label: 'Поддержать Пекин', tip: '+8 ПВ', fx: () => Game.addPP(8) }
      ]
    }
  },
  {
    id: 'congress20', date: '2022-10-16', art: 'i-flag', cat: 'dip', powers: ['AXS'],
    title: 'XX съезд партии',
    text: () => `Открывается XX съезд Коммунистической партии Китая. Делегаты решают, как будет устроена власть в следующие пять лет. Лидер страны — ${Game.leaderOf('AXS')}.`,
    options: [
      { label: 'Консолидация власти', tip: '«Ядро партии»: +0,5 ПВ в день на год · популярность власти +5%', fx: () => { EV.spirit('AXS', 'core', 'Ядро партии', { pp: 0.5 }, 365); Game.addPop('ruling', 5); } },
      { label: 'Коллективное руководство', tip: '«Коллективное руководство»: +10% ОИ на год · напряжённость −2', fx: () => { EV.spirit('AXS', 'collective', 'Коллективное руководство', { rp: 0.1 }, 365); Game.addTension(-2); } }
    ]
  },
  {
    id: 'brics', date: '2023-08-22', art: 'i-globe', cat: 'dip',
    title: 'Расширение БРИКС',
    text: 'Саммит БРИКС в Йоханнесбурге приглашает в объединение Иран, Египет, Эфиопию, Саудовскую Аравию, ОАЭ и Аргентину.',
    opts: {
      SOV: [{ label: 'Ставка на БРИКС', tip: '+15 ПВ · каждая приглашённая страна: 12% вступить в ОДКБ', fx: () => { Game.addPP(15); ['IRN', 'EGY', 'ETH', 'SAU', 'ARE', 'ARG'].forEach(id => { EV.help(id); EV.join(id, 0.12); }); } }],
      AXS: [{ label: 'Ставка на БРИКС', tip: '+15 ПВ · каждая приглашённая страна: 12% вступить в «Пояс и путь»', fx: () => { Game.addPP(15); ['IRN', 'EGY', 'ETH', 'SAU', 'ARE', 'ARG'].forEach(id => { EV.help(id); EV.join(id, 0.12); }); } }],
      WST: [{ label: 'Укрепить «Большую семёрку»', tip: '+10 ПВ', fx: () => Game.addPP(10) }]
    }
  },
  {
    id: 'mideast', date: '2023-10-07', art: 'i-swords', cat: 'alert',
    cond: () => EV.indep('ISR'),
    title: 'Война на Ближнем Востоке',
    text: 'Боевики ХАМАС наносят удар по югу Израиля. Израиль объявляет войну и начинает операцию в секторе Газа.',
    opts: {
      WST: [
        { label: 'Полная поддержка Израиля', tip: 'Израиль +3 дивизии · напряжённость +3 · теократы в Иране +5%', fx: () => { EV.divs('ISR', 3); Game.addTension(3); EV.pop('IRN', 'theo', 5); } },
        { label: 'Призвать к прекращению огня', tip: '−10 ПВ · напряжённость −3', fx: () => { Game.addPP(-10); Game.addTension(-3); } }
      ],
      SOV: [{ label: 'Призвать к перемирию', tip: '+10 ПВ · разведданные по региону +15', fx: () => { Game.addPP(10); ['ISR', 'IRN', 'EGY', 'SYR', 'JOR', 'LBN'].forEach(id => EV.intel(id, 15)); } }],
      AXS: [{ label: 'Предложить мирный план', tip: '+10 ПВ · напряжённость −1', fx: () => { Game.addPP(10); Game.addTension(-1); } }]
    }
  },

  /* ===================== СЛУЧАЙНЫЕ СОБЫТИЯ ===================== */
  {
    id: 'r_protests', weight: 3, art: 'i-flag', cat: 'alert',
    cond: () => (Game.powerGov().pop[Game.powerIde()] || 0) < 50,
    title: 'Протесты в столице',
    text: () => `На улицы города ${POWERS[Game.cur].capitalName} выходят десятки тысяч человек. Требования — от отставки правительства до досрочных выборов.`,
    options: [
      { label: 'Разогнать', tip: '+10 ПВ · популярность власти −3% · напряжённость +1', fx: () => { Game.addPP(10); Game.addPop('ruling', -3); Game.addTension(1); } },
      { label: 'Диалог с оппозицией', tip: '−15 ПВ · популярность власти +4%', fx: () => { Game.addPP(-15); Game.addPop('ruling', 4); } },
      { label: 'Объявить реформы', tip: '−30 ПВ · популярность власти +7%', fx: () => { Game.addPP(-30); Game.addPop('ruling', 7); } }
    ]
  },
  {
    id: 'r_scandal', weight: 2, art: 'i-eye', cat: 'info',
    title: 'Коррупционный скандал',
    text: 'Журналисты публикуют расследование о дворцах, яхтах и офшорах высокопоставленных чиновников. Видео набирает десятки миллионов просмотров.',
    options: [
      { label: 'Отправить министров в отставку', tip: '−20 ПВ · популярность власти +2%', fx: () => { Game.addPP(-20); Game.addPop('ruling', 2); } },
      { label: 'Отрицать всё', tip: 'Популярность власти −5%', fx: () => Game.addPop('ruling', -5) }
    ]
  },
  {
    id: 'r_cyber', weight: 2, art: 'i-eye', cat: 'intel',
    title: 'Кибератака на энергосистему',
    text: 'Хакеры отключили подстанции в нескольких регионах. Следы ведут за рубеж.',
    options: [
      { label: 'Нанести ответный удар', tip: '+10 ПВ · напряжённость +2 · разведданные по соперникам +15',
        fx: () => { Game.addPP(10); Game.addTension(2); POWERS[Game.cur].rivals.forEach(id => EV.intel(id, 15)); } },
      { label: 'Укрепить киберзащиту', tip: '−15 ПВ · +40 ОИ', fx: () => { Game.addPP(-15); Game.addRP(40); } }
    ]
  },
  {
    id: 'r_ai', weight: 2, art: 'i-rp', cat: 'sci',
    title: 'Прорыв в искусственном интеллекте',
    text: 'Национальная лаборатория представляет нейросеть, которая опережает зарубежных конкурентов.',
    options: [
      { label: 'Отдать военным', tip: '+70 ОИ', fx: () => Game.addRP(70) },
      { label: 'Отдать промышленности', tip: '+2 завода', fx: () => EV.myFac(2) }
    ]
  },
  {
    id: 'r_migrants', weight: 2, art: 'i-mp', cat: 'info',
    title: 'Миграционный кризис',
    text: 'Тысячи мигрантов скопились на границе. Националисты требуют закрыть страну, правозащитники — принять людей.',
    options: [
      { label: 'Закрыть границу', tip: '+10 ПВ · националисты +5%', fx: () => { Game.addPP(10); Game.addPop('nat', 5); } },
      { label: 'Принять мигрантов', tip: '−15 ПВ · +80 тыс. призывников · либералы +3%', fx: () => { Game.addPP(-15); Game.addMP(80); Game.addPop('lib', 3); } }
    ]
  },
  {
    id: 'r_drones', weight: 2, art: 'i-div', cat: 'mil',
    title: 'Испытания ударных дронов',
    text: 'Оборонный концерн представляет дешёвый ударный беспилотник. Военные хотят тысячи, экспортёры — контракты за рубежом.',
    options: [
      { label: 'Массовое производство', tip: '−20 ПВ · «Дроновая армия»: атака +5% на год', fx: () => { Game.addPP(-20); EV.spirit(Game.cur, 'drones', 'Дроновая армия', { attackBonus: 0.05 }, 365); } },
      { label: 'Продать за рубеж', tip: '+25 ПВ', fx: () => Game.addPP(25) }
    ]
  },
  {
    id: 'r_space', weight: 1, art: 'i-rp', cat: 'sci',
    title: 'Космический запуск',
    text: 'Новая ракета выводит на орбиту группировку военных и гражданских спутников.',
    options: [
      { label: 'Трубить о победе', tip: '+20 ПВ · популярность власти +2%', fx: () => { Game.addPP(20); Game.addPop('ruling', 2); } },
      { label: 'Спутники для науки', tip: '+50 ОИ', fx: () => Game.addRP(50) }
    ]
  },
  {
    id: 'r_disaster', weight: 2, art: 'i-tension', cat: 'alert',
    title: 'Стихийное бедствие',
    text: () => ({ SOV: 'Лесные пожары в Сибири охватили миллионы гектаров.', WST: 'Ураган обрушился на побережье Мексиканского залива.', AXS: 'Наводнения на Янцзы затопили промышленные районы.' }[Game.cur] || 'Стихия разрушает города и дороги.') + ' Нужны деньги и люди.',
    options: [
      { label: 'Бросить все силы на ликвидацию', tip: '−20 ПВ · популярность власти +2%', fx: () => { Game.addPP(-20); Game.addPop('ruling', 2); } },
      { label: 'Справятся сами', tip: '−1 завод · популярность власти −3%', fx: () => { EV.myFac(-1); Game.addPop('ruling', -3); } }
    ]
  },
  {
    id: 'r_debt', weight: 2, art: 'i-pp', cat: 'dip',
    cond: () => !!EV.randomCountry(c => c.faction === 'NEU' && c.factories <= 6),
    setup: () => ({ target: EV.randomCountry(c => c.faction === 'NEU' && c.factories <= 6).id }),
    title: 'Угроза дефолта',
    text: ctx => `${Game.c(ctx.target).name} на грани дефолта и просит экстренный кредит. Кто даст деньги — получит друга.`,
    options: [
      { label: 'Выдать кредит', tip: '−30 ПВ · 35%: страна вступает в наш блок', fx: ctx => { Game.addPP(-30); EV.help(ctx.target); EV.join(ctx.target, 0.35); } },
      { label: 'Отказать', tip: '+5 ПВ', fx: () => Game.addPP(5) }
    ]
  },
  {
    id: 'r_arms', weight: 2, art: 'i-div', cat: 'dip',
    cond: () => !!EV.randomCountry(c => c.faction === 'NEU'),
    setup: () => ({ target: EV.randomCountry(c => c.faction === 'NEU').id }),
    title: 'Оружейный контракт',
    text: ctx => `${Game.c(ctx.target).name} хочет закупить у нас крупную партию вооружений: танки, ПВО, беспилотники.`,
    options: [
      { label: 'Подписать контракт', tip: '+20 ПВ · страна +2 дивизии · разведданные +30', fx: ctx => { Game.addPP(20); EV.divs(ctx.target, 2); EV.intel(ctx.target, 30); EV.help(ctx.target); } },
      { label: 'Отказать', tip: 'Напряжённость −1', fx: () => Game.addTension(-1) }
    ]
  },
  {
    id: 'r_plot', weight: 2, art: 'i-swords', cat: 'intel',
    cond: () => !!EV.randomCountry(c => c.pol.ide !== Game.powerIde() && (c.pol.pop[Game.powerIde()] || 0) >= 15 && !Game.isAlly(c)),
    setup: () => ({ target: EV.randomCountry(c => c.pol.ide !== Game.powerIde() && (c.pol.pop[Game.powerIde()] || 0) >= 15 && !Game.isAlly(c)).id }),
    title: 'Заговор единомышленников',
    text: ctx => {
      const c = Game.c(ctx.target), I = IDEOLOGIES[Game.powerIde()];
      return `${c.name}: генералы и политики, близкие к партии «${I.name}», готовы взять власть. Они просят денег и гарантий.`;
    },
    options: [
      { label: 'Поддержать заговорщиков', tip: '−25 ПВ · 45%: к власти приходят наши единомышленники',
        fx: ctx => {
          Game.addPP(-25);
          const c = Game.c(ctx.target), ide = Game.powerIde();
          if (!c || c.ctrl !== c.id) return;
          EV.help(c.id);
          if (U.chance(0.45)) {
            Game.news(`Переворот: ${c.name}`, `Власть переходит к партии «${IDEOLOGIES[ide].name}».`, c.id, 'elections');
            Game.setGov(c, ide, c.pol.cands[ide] || null, 'coup');
          } else { Game.addTension(3); Game.news(`Заговор раскрыт: ${c.name}`, 'Заговорщики арестованы.', c.id, 'elections'); }
        } },
      { label: 'Предупредить правительство', tip: '+5 ПВ · разведданные +20', fx: ctx => { Game.addPP(5); EV.intel(ctx.target, 20); EV.help(ctx.target); } }
    ]
  },
  {
    id: 'r_strike', weight: 1, art: 'i-factory', cat: 'info',
    title: 'Всеобщая забастовка',
    text: 'Профсоюзы останавливают заводы и транспорт: инфляция съела зарплаты.',
    options: [
      { label: 'Поднять зарплаты', tip: '−20 ПВ · социалисты +3%', fx: () => { Game.addPP(-20); Game.addPop('soc', 3); } },
      { label: 'Не уступать', tip: '−1 завод · популярность власти −2%', fx: () => { EV.myFac(-1); Game.addPop('ruling', -2); } }
    ]
  },
  {
    id: 'r_defector', weight: 2, art: 'i-eye', cat: 'intel',
    title: 'Перебежчик',
    setup: () => ({ rival: U.pick(POWERS[Game.cur].rivals) }),
    text: ctx => `Офицер разведки (${Game.c(ctx.rival).name}) просит убежища. При нём — флешки с документами.`,
    options: [
      { label: 'Выжать всё до капли', tip: 'Разведданные по сопернику 100%', fx: ctx => { const c = Game.c(ctx.rival); if (c) c.intel[Game.cur] = 100; } },
      { label: 'Обменять на наших агентов', tip: '+10 ПВ · напряжённость −3', fx: () => { Game.addPP(10); Game.addTension(-3); } }
    ]
  },

  /* --- Свои случайные события держав --- */
  {
    id: 's_arctic', powers: ['SOV'], weight: 2, art: 'i-factory', cat: 'success',
    title: 'Арктический шельф',
    text: 'Геологи подтверждают гигантские запасы газа на Ямале и в Карском море. Нужны инвестиции и ледоколы.',
    options: [
      { label: 'Вложиться в «Арктик СПГ»', tip: '−15 ПВ · +3 завода', fx: () => { Game.addPP(-15); EV.myFac(3); } },
      { label: 'Северный морской путь', tip: '+15 ПВ · +1 завод', fx: () => { Game.addPP(15); EV.myFac(1); } }
    ]
  },
  {
    id: 'w_shutdown', powers: ['WST'], weight: 2, art: 'i-flag', cat: 'info',
    title: 'Шатдаун',
    text: 'Конгресс не принял бюджет: федеральные ведомства закрываются, сотни тысяч служащих остаются без зарплаты.',
    options: [
      { label: 'Не уступать по бюджету', tip: '+10 ПВ · популярность власти −3%', fx: () => { Game.addPP(10); Game.addPop('ruling', -3); } },
      { label: 'Компромисс с оппозицией', tip: '−15 ПВ', fx: () => Game.addPP(-15) }
    ]
  },
  {
    id: 'w_silicon', powers: ['WST'], weight: 2, art: 'i-rp', cat: 'sci',
    title: 'Кремниевая долина',
    text: 'Технологические гиганты предлагают Пентагону облачные сервисы и ИИ — за большие контракты.',
    options: [
      { label: 'Контракт с Пентагоном', tip: '−20 ПВ · +80 ОИ', fx: () => { Game.addPP(-20); Game.addRP(80); } },
      { label: 'Налоговые льготы', tip: '+2 завода', fx: () => EV.myFac(2) }
    ]
  },
  {
    id: 'a_beltforum', powers: ['AXS'], weight: 2, art: 'i-globe', cat: 'dip',
    cond: () => !!EV.randomCountry(c => c.faction === 'NEU'),
    setup: () => ({ target: EV.randomCountry(c => c.faction === 'NEU').id }),
    title: 'Форум «Пояса и пути»',
    text: ctx => `${Game.c(ctx.target).name} просит профинансировать порт, железную дорогу и электростанцию.`,
    options: [
      { label: 'Профинансировать', tip: '−25 ПВ · 30%: страна вступает в «Пояс и путь»', fx: ctx => { Game.addPP(-25); EV.help(ctx.target); EV.join(ctx.target, 0.3); } },
      { label: 'Сэкономить', tip: '+5 ПВ', fx: () => Game.addPP(5) }
    ]
  },
  {
    id: 'a_demography', powers: ['AXS'], weight: 1, art: 'i-mp', cat: 'info',
    cond: () => (Game.P().spirits || []).some(s => s.id === 'aging'),
    title: 'Демографический спад',
    text: 'Рождаемость падает третий год подряд. Министерства предлагают разные рецепты.',
    options: [
      { label: 'Отменить ограничения рождаемости', tip: '−20 ПВ · убрать «Старение населения»', fx: () => { Game.addPP(-20); Game.removeSpirit(Game.cur, 'aging'); } },
      { label: 'Ставка на роботизацию', tip: '+40 ОИ', fx: () => Game.addRP(40) }
    ]
  }
];

/* ---------------- Мировые новости по датам (без выбора) ---------------- */
const WORLD_NEWS = [
  { id: 'olympics', date: '2018-02-09', cid: 'KOR', title: 'Олимпиада в Пхёнчхане',
    text: 'Спортсмены КНДР и Южной Кореи выходят на открытие под одним флагом.', fx: () => Game.addTension(-1) },
  { id: 'zuma', date: '2018-02-14', cid: 'ZAF', title: 'Отставка Джейкоба Зумы',
    text: 'Президент ЮАР уходит под давлением партии. Главой государства становится Сирил Рамафоса.',
    cond: () => EV.indep('ZAF') && EV.ide('ZAF') === 'soc', fx: () => { const c = Game.c('ZAF'); c.pol.succUsed = true; EV.gov('ZAF', 'soc', 'Сирил Рамафоса', 'succession'); } },
  { id: 'syriastrike', date: '2018-04-14', cid: 'SYR', title: 'Удар по Сирии',
    text: 'США, Великобритания и Франция наносят ракетный удар по объектам в Сирии.', fx: () => Game.addTension(2) },
  { id: 'cuba', date: '2018-04-19', cid: 'CUB', title: 'Новый лидер Кубы',
    text: 'Мигель Диас-Канель сменяет Рауля Кастро на посту главы государства.',
    cond: () => EV.indep('CUB') && EV.ide('CUB') === 'com', fx: () => { Game.c('CUB').pol.succUsed = true; EV.gov('CUB', 'com', 'Мигель Диас-Канель', 'succession'); } },
  { id: 'abiy', date: '2018-04-02', cid: 'ETH', title: 'Эфиопия: новый премьер',
    text: 'Премьер-министром Эфиопии становится реформатор Абий Ахмед.',
    cond: () => EV.indep('ETH'), fx: () => { Game.c('ETH').pol.succUsed = true; EV.gov('ETH', EV.ide('ETH'), 'Абий Ахмед', 'succession'); } },
  { id: 'crimeabridge', date: '2018-05-15', cid: 'RUS', title: 'Открыт Крымский мост',
    text: 'По мосту через Керченский пролив пошли первые автомобили.' },
  { id: 'sanchez', date: '2018-06-01', cid: 'ESP', title: 'Испания: вотум недоверия',
    text: 'Парламент отправляет в отставку правительство Мариано Рахоя. Премьером становится социалист Педро Санчес.',
    cond: () => EV.indep('ESP') && EV.ide('ESP') === 'con', fx: () => EV.gov('ESP', 'soc', 'Педро Санчес', 'event') },
  { id: 'lira', date: '2018-08-10', cid: 'TUR', title: 'Обвал турецкой лиры',
    text: 'Лира теряет пятую часть стоимости за день. Инвесторы бегут с развивающихся рынков.', fx: () => EV.fac('TUR', -1) },
  { id: 'morrison', date: '2018-08-24', cid: 'AUS', title: 'Австралия: смена премьера',
    text: 'Партия смещает Малкольма Тёрнбулла. Премьер-министром становится Скотт Моррисон.',
    cond: () => EV.indep('AUS') && EV.ide('AUS') === 'con', fx: () => { Game.c('AUS').pol.succUsed = true; EV.gov('AUS', 'con', 'Скотт Моррисон', 'succession'); } },
  { id: 'khashoggi', date: '2018-10-02', cid: 'SAU', title: 'Исчезновение журналиста',
    text: 'В консульстве Саудовской Аравии в Стамбуле пропадает журналист Джамаль Хашогги. Разгорается международный скандал.' },
  { id: 'tokayev', date: '2019-03-19', cid: 'KAZ', title: 'Транзит власти в Казахстане',
    text: 'Нурсултан Назарбаев уходит в отставку. Президентом становится Касым-Жомарт Токаев.',
    cond: () => EV.indep('KAZ') && Game.c('KAZ').pol.leader === 'Нурсултан Назарбаев', fx: () => { Game.c('KAZ').pol.succUsed = true; EV.gov('KAZ', EV.ide('KAZ'), 'Касым-Жомарт Токаев', 'succession'); } },
  { id: 'bouteflika', date: '2019-04-02', cid: 'DZA', title: 'Алжир: уход Бутефлики',
    text: 'После шести недель протестов президент Абдельазиз Бутефлика подаёт в отставку.',
    cond: () => EV.indep('DZA') && Game.c('DZA').pol.leader === 'Абдельазиз Бутефлика', fx: () => { EV.gov('DZA', EV.ide('DZA'), 'Абделькадер Бенсалах', 'protest'); EV.pop('DZA', 'lib', 6); } },
  { id: 'bashir', date: '2019-04-11', cid: 'SDN', title: 'Переворот в Судане',
    text: 'Военные свергают Омара аль-Башира, правившего тридцать лет.',
    cond: () => EV.indep('SDN') && Game.c('SDN').pol.leader === 'Омар аль-Башир', fx: () => EV.gov('SDN', 'auth', 'Абдель Фаттах аль-Бурхан', 'coup') },
  { id: 'notredame', date: '2019-04-15', cid: 'FRA', title: 'Пожар в соборе Парижской Богоматери',
    text: 'Огонь уничтожает шпиль и кровлю собора. Весь мир собирает деньги на восстановление.' },
  { id: 'johnson', date: '2019-07-24', cid: 'GBR', title: 'Новый премьер Великобритании',
    text: 'Тереза Мэй уходит после провала сделки по брекситу. Премьер-министром становится Борис Джонсон.',
    cond: () => EV.indep('GBR') && Game.c('GBR').pol.leader === 'Тереза Мэй', fx: () => { Game.c('GBR').pol.succUsed = true; EV.gov('GBR', 'con', 'Борис Джонсон', 'succession'); } },
  { id: 'oman', date: '2020-01-11', cid: 'OMN', title: 'Новый султан Омана',
    text: 'Умер султан Кабус, правивший полвека. Трон наследует Хайсам бен Тарик.',
    cond: () => EV.indep('OMN'), fx: () => EV.gov('OMN', EV.ide('OMN'), 'Хайсам бен Тарик', 'succession') },
  { id: 'brexit', date: '2020-01-31', cid: 'GBR', title: 'Брексит',
    text: 'Великобритания официально выходит из Европейского союза после 47 лет членства.', fx: () => EV.fac('GBR', -1) },
  { id: 'negativeoil', date: '2020-04-20', title: 'Нефть дешевле нуля',
    text: 'Впервые в истории фьючерсы на нефть WTI уходят в минус: хранилища переполнены.' },
  { id: 'vaccine', date: '2020-12-08', cid: 'GBR', title: 'Началась массовая вакцинация',
    text: 'В Великобритании сделана первая прививка от COVID-19 в рамках массовой кампании. Пандемия идёт на спад.',
    fx: () => Game.tags().forEach(t => { const s = (Game.P(t).spirits || []).find(x => x.id === 'covid'); if (s) s.days = Math.min(s.days, 45); }) },
  { id: 'suez', date: '2021-03-23', cid: 'EGY', title: 'Суэцкий канал заблокирован',
    text: 'Контейнеровоз Ever Given сел на мель поперёк канала. Встали сотни судов, мировая торговля теряет миллиарды в день.' },
  { id: 'elizabeth', date: '2022-09-08', cid: 'GBR', title: 'Умерла королева Елизавета II',
    text: 'Королева правила 70 лет. На престол восходит Карл III.' },
  { id: 'chatgpt', date: '2022-11-30', title: 'Нейросети для всех',
    text: 'Чат-бот на большой языковой модели набирает сто миллионов пользователей за два месяца. Начинается гонка искусственного интеллекта.',
    fx: () => Game.tags().forEach(t => Game.as(t, () => Game.addRP(30))) },
  { id: 'quake2023', date: '2023-02-06', cid: 'TUR', title: 'Землетрясение в Турции и Сирии',
    text: 'Сильнейшее землетрясение разрушает города на юге Турции и севере Сирии.', fx: () => { EV.fac('TUR', -1); EV.pop('TUR', 'soc', 3); } }
];

/* ---------------- Случайные новости о странах мира ---------------- */
const RANDOM_NEWS = [
  { w: 3, cond: c => c.pop > 5e6, title: c => `${c.name}: экономический рост`,
    text: c => `Экономика растёт быстрее прогнозов. В строй вводятся новые предприятия.`, fx: c => { c.factories += 1; } },
  { w: 2, cond: c => c.factories >= 3, title: c => `${c.name}: рецессия`,
    text: () => 'Безработица растёт, рейтинг правительства падает.', fx: c => { c.factories -= 1; Game.shiftPop(c.pol, c.pol.ide, -3); } },
  { w: 3, title: c => `Протесты: ${c.name}`,
    text: c => { const o = EV.opposition(c); return `Десятки тысяч человек требуют перемен. Оппозиция (${IDEOLOGIES[o[0]].name.toLowerCase()}) набирает очки.`; },
    fx: c => { const o = EV.opposition(c); Game.shiftPop(c.pol, c.pol.ide, -4); Game.shiftPop(c.pol, o[0], 4); } },
  { w: 2, title: c => `Скандал в правительстве: ${c.name}`,
    text: () => 'Министр уходит в отставку на фоне коррупционного расследования.', fx: c => Game.shiftPop(c.pol, c.pol.ide, -2) },
  { w: 2, title: c => `Военные учения: ${c.name}`,
    text: () => 'Армия проводит крупнейшие за десятилетие манёвры у границ.', fx: c => { c.divs += 0.5; } },
  { w: 1, cond: c => c.factories >= 2, title: c => `Стихийное бедствие: ${c.name}`,
    text: () => 'Землетрясение и наводнения разрушают дороги и заводы.', fx: c => { c.factories -= 1; } },
  { w: 1, title: c => `${c.name}: открыто месторождение`,
    text: () => 'Геологи нашли крупное месторождение нефти и газа.', fx: c => { c.factories += 1; } },
  { w: 2, title: c => `${c.name}: рост националистов`,
    text: () => 'Националисты лидируют в соцсетях и на улицах.', fx: c => Game.shiftPop(c.pol, 'nat', 4) },
  { w: 2, title: c => `${c.name}: левый поворот`,
    text: () => 'Социалисты набирают популярность на фоне роста цен.', fx: c => Game.shiftPop(c.pol, 'soc', 4) },
  { w: 2, title: c => `${c.name}: молодёжь за реформы`,
    text: () => 'Студенты требуют свободных выборов и независимых судов.', fx: c => Game.shiftPop(c.pol, 'lib', 4) },
  { w: 1, cond: c => ['auth', 'nat', 'com'].includes(c.pol.ide), title: c => `${c.name}: курс на сильную власть`,
    text: () => 'Власти принимают законы против «иностранных агентов» и усиливают полицию.', fx: c => Game.shiftPop(c.pol, c.pol.ide, 3) },
  { w: 1, title: c => `Всеобщая забастовка: ${c.name}`,
    text: () => 'Профсоюзы останавливают транспорт и заводы.', fx: c => { Game.shiftPop(c.pol, 'soc', 2); Game.shiftPop(c.pol, c.pol.ide, -2); } },
  { w: 1, title: c => `${c.name} закупает вооружения`,
    text: () => 'Подписан крупный контракт на танки, ПВО и беспилотники.', fx: c => { c.divs += 1; } },
  { w: 1, cond: c => IDEOLOGIES[c.pol.ide].group === 'dem', title: c => `${c.name}: правительственный кризис`,
    text: () => 'Коалиция распалась, партии договариваются о новом кабинете.', fx: c => Game.shiftPop(c.pol, c.pol.ide, -2) },
  { w: 1, title: c => `${c.name}: поток беженцев`,
    text: () => 'Через границу идут десятки тысяч беженцев из соседних стран.', fx: c => Game.shiftPop(c.pol, 'nat', 2) },
  { w: 1, cond: c => c.pop > 2e7, title: c => `${c.name}: технологический бум`,
    text: () => 'Стартапы привлекают миллиардные инвестиции.', fx: c => { c.factories += 1; Game.shiftPop(c.pol, 'lib', 1); } }
];
