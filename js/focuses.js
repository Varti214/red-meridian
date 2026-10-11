'use strict';
/* ============================================================
   ДЕРЕВЬЯ НАЦИОНАЛЬНЫХ ФОКУСОВ — у каждой державы своё.
   Устройство дерева (как в HOI4):
     ряд 0 — стартовый фокус;
     ряд 1 — общие фокусы (доступны при любом курсе);
     ряд 2 — ВЫБОР КУРСА: три взаимоисключающих пути;
     ряды 3–4 — ветка выбранного курса;
     ряд 5 — завершающий фокус курса.
   x — колонка (0–8), y — ряд (0–5).

   Эффекты fx:
     постоянные бонусы: pp, rp, attackBonus, defense, org, loss, train, mpMult, spyCost, spyChance,
       spyTension, intelKeep, justify, influence, tensionDecay, nucCost, nucDays, factoryEvery, amph;
     разовые: addFactories, addMP, addDivs, addPP, tension,
       claims — повод для войны (список стран или 'neighbors' — все соседи),
       allies — неприсоединившиеся страны вступают в наш блок,
       annex — союзники мирно входят в состав державы,
       army — новая армия { name, divs }.
   ============================================================ */

const FOCUS_TREES = {
  SOV: [
    { id: 's_root', x: 4, y: 0, days: 35, req: [], name: 'Курс Громова', fx: { pp: 0.5 },
      desc: 'Новый Генсек укрепляет вертикаль власти. +0,5 ПВ в день.' },
    { id: 's_plan', x: 1, y: 1, days: 50, req: ['s_root'], name: 'Пятилетка ускорения', fx: { addFactories: 5 },
      desc: '+5 заводов немедленно.' },
    { id: 's_mobil', x: 4, y: 1, days: 50, req: ['s_root'], name: 'Всеобщая мобилизация', fx: { addMP: 400, mpMult: 0.3 },
      desc: '+400 тыс. призывников, прирост призыва +30%.' },
    { id: 's_kgb', x: 7, y: 1, days: 45, req: ['s_root'], name: 'Комитет госбезопасности', fx: { spyCost: 0.3, spyChance: 0.15 },
      desc: 'Тайные операции дешевле на 30%, успех +15%.' },

    { id: 's_order', x: 1, y: 2, days: 40, req: ['s_root'], excl: ['s_tech', 's_comintern'], name: 'Партия порядка', path: 'Военный курс',
      fx: { attackBonus: 0.05, pp: 0.3 }, desc: 'Старая гвардия у руля. +5% к атаке, +0,3 ПВ в день.' },
    { id: 's_tech', x: 4, y: 2, days: 40, req: ['s_root'], excl: ['s_order', 's_comintern'], name: 'Совет технократов', path: 'Курс реформ',
      fx: { rp: 0.1 }, desc: 'Инженеры и учёные получают власть. +10% ОИ.' },
    { id: 's_comintern', x: 7, y: 2, days: 40, req: ['s_root'], excl: ['s_order', 's_tech'], name: 'Коминтерновцы', path: 'Курс экспансии',
      fx: { influence: 0.3 }, desc: 'Ставка на мировую революцию. Влияние дешевле на 30%.' },

    { id: 's_purge', x: 0, y: 3, days: 45, req: ['s_order'], name: 'Чистка генштаба', fx: { org: 0.25, addPP: -20 },
      desc: 'Молодые командиры вместо осторожных стариков. Организация армий восстанавливается на 25% быстрее. −20 ПВ.' },
    { id: 's_fists', x: 2, y: 3, days: 50, req: ['s_order'], name: 'Стальные кулаки', fx: { attackBonus: 0.1 },
      desc: 'Танковые корпуса сводятся в ударные кулаки. +10% к атаке.' },
    { id: 's_deep', x: 0, y: 4, days: 60, req: ['s_purge'], name: 'Глубокая операция', fx: { attackBonus: 0.1, loss: 0.1 },
      desc: '+10% к атаке, потери в наступлении −10%.' },
    { id: 's_guards', x: 2, y: 4, days: 60, req: ['s_fists'], name: 'Гвардейские армии', fx: { army: { name: '1-я гвардейская армия', divs: 15 } },
      desc: 'Новая армия из 15 отборных дивизий у Москвы.' },
    { id: 's_hegemony', x: 1, y: 5, days: 90, req: ['s_deep', 's_guards'], name: 'Красная гегемония', fx: { pp: 1, defense: 0.15, addDivs: 10 },
      desc: '+1 ПВ в день, оборона армий +15%, +10 дивизий в резерв.' },

    { id: 's_sovnarhoz', x: 3, y: 3, days: 50, req: ['s_tech'], name: 'Совнархозы', fx: { addFactories: 3, factoryEvery: 25 },
      desc: '+3 завода и пассивный рост: +1 завод каждые 25 дней.' },
    { id: 's_akadem', x: 5, y: 3, days: 50, req: ['s_tech'], name: 'Академгородок', fx: { rp: 0.15 },
      desc: 'Научный город в Сибири. +15% ОИ.' },
    { id: 's_atom', x: 3, y: 4, days: 60, req: ['s_sovnarhoz'], name: 'Атомный приоритет', fx: { nucCost: 0.2, nucDays: 0.4 },
      desc: 'Ядерная ветка: −20% к стоимости, −40% ко времени.' },
    { id: 's_cyber', x: 5, y: 4, days: 60, req: ['s_akadem'], name: 'Кибернетика Госплана', fx: { rp: 0.15, train: 0.2 },
      desc: '+15% ОИ, дивизии обучаются на 20% быстрее.' },
    { id: 's_coexist', x: 4, y: 5, days: 90, req: ['s_atom', 's_cyber'], name: 'Мирное сосуществование', fx: { tensionDecay: 3, pp: 1, addFactories: 8 },
      desc: 'Напряжённость спадает втрое быстрее, +1 ПВ в день, +8 заводов.' },

    { id: 's_brothers', x: 6, y: 3, days: 50, req: ['s_comintern'], name: 'Помощь братским партиям', fx: { allies: ['SRB', 'FIN'] },
      desc: 'Югославия и Финляндия вступают в Коминтерн (если ещё нейтральны).' },
    { id: 's_south', x: 8, y: 3, days: 50, req: ['s_comintern'], name: 'Поход на юг', fx: { claims: ['TUR', 'IRN'] },
      desc: 'Повод для войны с Турцией и Ираном.' },
    { id: 's_interbrig', x: 6, y: 4, days: 60, req: ['s_brothers'], name: 'Интернациональные бригады', fx: { army: { name: 'Интернациональная армия', divs: 10 } },
      desc: 'Добровольцы со всего мира: новая армия из 10 дивизий.' },
    { id: 's_mideast', x: 8, y: 4, days: 60, req: ['s_south'], name: 'Ближневосточная политика', fx: { allies: ['EGY', 'SYR', 'IRQ'] },
      desc: 'Египет, Сирия и Ирак вступают в Коминтерн (если нейтральны).' },
    { id: 's_revolution', x: 7, y: 5, days: 90, req: ['s_interbrig', 's_mideast'], name: 'Мировая революция', fx: { justify: 0.4, attackBonus: 0.1, claims: 'neighbors' },
      desc: 'Повод для войны со всеми соседями, обоснование −40%, +10% к атаке.' }
  ],

  WST: [
    { id: 'w_root', x: 4, y: 0, days: 35, req: [], name: 'Курс Стэнтона', fx: { pp: 0.5 },
      desc: 'Президент берёт курс на противостояние двум угрозам. +0,5 ПВ в день.' },
    { id: 'w_economy', x: 1, y: 1, days: 50, req: ['w_root'], name: 'Военная экономика', fx: { addFactories: 6 },
      desc: '+6 заводов немедленно.' },
    { id: 'w_draft', x: 4, y: 1, days: 50, req: ['w_root'], name: 'Выборочная служба', fx: { addMP: 300, mpMult: 0.25 },
      desc: '+300 тыс. призывников, прирост призыва +25%.' },
    { id: 'w_cia', x: 7, y: 1, days: 45, req: ['w_root'], name: 'Центральное разведуправление', fx: { spyCost: 0.3, spyChance: 0.15 },
      desc: 'Тайные операции дешевле на 30%, успех +15%.' },

    { id: 'w_hawks', x: 1, y: 2, days: 40, req: ['w_root'], excl: ['w_newdeal', 'w_league'], name: 'Ястребы Пентагона', path: 'Военный курс',
      fx: { attackBonus: 0.05, pp: 0.3 }, desc: 'Генералы диктуют политику. +5% к атаке, +0,3 ПВ в день.' },
    { id: 'w_newdeal', x: 4, y: 2, days: 40, req: ['w_root'], excl: ['w_hawks', 'w_league'], name: 'Новый курс', path: 'Курс процветания',
      fx: { rp: 0.1, pp: 0.2 }, desc: 'Экономика и наука прежде всего. +10% ОИ, +0,2 ПВ в день.' },
    { id: 'w_league', x: 7, y: 2, days: 40, req: ['w_root'], excl: ['w_hawks', 'w_newdeal'], name: 'Лига демократий', path: 'Курс союзов',
      fx: { influence: 0.3 }, desc: 'Свободный мир против диктатур. Влияние дешевле на 30%.' },

    { id: 'w_airland', x: 0, y: 3, days: 50, req: ['w_hawks'], name: 'Воздушно-наземная операция', fx: { attackBonus: 0.1 },
      desc: 'Авиация прокладывает путь танкам. +10% к атаке.' },
    { id: 'w_marines', x: 2, y: 3, days: 50, req: ['w_hawks'], name: 'Морская пехота', fx: { amph: 0.25 },
      desc: 'Штрафы за форсирование проливов и десант снижены на 25 п.п.' },
    { id: 'w_rollback', x: 0, y: 4, days: 60, req: ['w_airland'], name: 'Отбрасывание', fx: { claims: ['PRK', 'VNM', 'CUB'], loss: 0.1 },
      desc: 'Повод для войны с КНДР, Вьетнамом и Кубой. Потери в наступлении −10%.' },
    { id: 'w_airborne', x: 2, y: 4, days: 60, req: ['w_marines'], name: 'Воздушно-десантный корпус', fx: { army: { name: '18-й воздушно-десантный корпус', divs: 12 } },
      desc: 'Новая армия из 12 дивизий.' },
    { id: 'w_pax', x: 1, y: 5, days: 90, req: ['w_rollback', 'w_airborne'], name: 'Pax Americana', fx: { pp: 1, defense: 0.15, addDivs: 10 },
      desc: '+1 ПВ в день, оборона армий +15%, +10 дивизий в резерв.' },

    { id: 'w_highways', x: 3, y: 3, days: 50, req: ['w_newdeal'], name: 'Межштатные автострады', fx: { addFactories: 4, factoryEvery: 25 },
      desc: '+4 завода и пассивный рост: +1 завод каждые 25 дней.' },
    { id: 'w_space', x: 5, y: 3, days: 50, req: ['w_newdeal'], name: 'Космическая гонка', fx: { rp: 0.15 },
      desc: '+15% ОИ.' },
    { id: 'w_atom', x: 3, y: 4, days: 60, req: ['w_highways'], name: 'Атомный приоритет', fx: { nucCost: 0.2, nucDays: 0.4 },
      desc: 'Ядерная ветка: −20% к стоимости, −40% ко времени.' },
    { id: 'w_computers', x: 5, y: 4, days: 60, req: ['w_space'], name: 'Электронные вычислители', fx: { rp: 0.15, train: 0.2 },
      desc: '+15% ОИ, дивизии обучаются на 20% быстрее.' },
    { id: 'w_plenty', x: 4, y: 5, days: 90, req: ['w_atom', 'w_computers'], name: 'Общество изобилия', fx: { addFactories: 10, pp: 1, tensionDecay: 2 },
      desc: '+10 заводов, +1 ПВ в день, напряжённость спадает вдвое быстрее.' },

    { id: 'w_marshall', x: 6, y: 3, days: 50, req: ['w_league'], name: 'План Маршалла-2', fx: { allies: ['SWE', 'CHE', 'FIN'], tension: -5 },
      desc: 'Швеция, Швейцария и Финляндия вступают в Западный блок (если нейтральны). Напряжённость −5.' },
    { id: 'w_americas', x: 8, y: 3, days: 50, req: ['w_league'], name: 'Межамериканский договор', fx: { allies: ['MEX', 'BRA', 'COL', 'VEN'] },
      desc: 'Мексика, Бразилия, Колумбия и Венесуэла вступают в блок (если нейтральны).' },
    { id: 'w_canada', x: 6, y: 4, days: 60, req: ['w_marshall'], name: 'Североамериканский союз', fx: { annex: ['CAN'] },
      desc: 'Канада мирно входит в состав США.' },
    { id: 'w_seato', x: 8, y: 4, days: 60, req: ['w_americas'], name: 'СЕАТО', fx: { allies: ['IDN', 'MYS', 'LKA', 'IND'] },
      desc: 'Индонезия, Малайя, Цейлон и Индия вступают в блок (если нейтральны).' },
    { id: 'w_freeworld', x: 7, y: 5, days: 90, req: ['w_canada', 'w_seato'], name: 'Свободный мир', fx: { justify: 0.4, pp: 1, claims: 'neighbors' },
      desc: 'Повод для войны со всеми соседями, обоснование −40%, +1 ПВ в день.' }
  ],

  AXS: [
    { id: 'a_root', x: 4, y: 0, days: 35, req: [], name: 'Курс фон Веделя', fx: { pp: 0.5 },
      desc: 'Рейхсканцлер собирает Рейх заново. +0,5 ПВ в день.' },
    { id: 'a_fouryear', x: 1, y: 1, days: 50, req: ['a_root'], name: 'Четырёхлетний план', fx: { addFactories: 5 },
      desc: '+5 заводов немедленно.' },
    { id: 'a_total', x: 4, y: 1, days: 50, req: ['a_root'], name: 'Тотальная мобилизация', fx: { addMP: 300, mpMult: 0.3 },
      desc: '+300 тыс. призывников, прирост призыва +30%.' },
    { id: 'a_abwehr', x: 7, y: 1, days: 45, req: ['a_root'], name: 'Абвер-II', fx: { spyCost: 0.3, spyChance: 0.15 },
      desc: 'Тайные операции дешевле на 30%, успех +15%.' },

    { id: 'a_wehr', x: 1, y: 2, days: 40, req: ['a_root'], excl: ['a_concert', 'a_neworder'], name: 'Возрождение вермахта', path: 'Военный курс',
      fx: { attackBonus: 0.05, pp: 0.3 }, desc: 'Генералы получают карт-бланш. +5% к атаке, +0,3 ПВ в день.' },
    { id: 'a_concert', x: 4, y: 2, days: 40, req: ['a_root'], excl: ['a_wehr', 'a_neworder'], name: 'Европейский концерт', path: 'Курс равновесия',
      fx: { rp: 0.1, tensionDecay: 2 }, desc: 'Рейх как опора европейского равновесия. +10% ОИ, напряжённость спадает вдвое быстрее.' },
    { id: 'a_neworder', x: 7, y: 2, days: 40, req: ['a_root'], excl: ['a_wehr', 'a_concert'], name: 'Новый порядок', path: 'Курс реванша',
      fx: { justify: 0.2 }, desc: 'Реванш за 1945-й. Обоснование войны −20%.' },

    { id: 'a_blitz', x: 0, y: 3, days: 50, req: ['a_wehr'], name: 'Блицкриг нового типа', fx: { attackBonus: 0.1, org: 0.25 },
      desc: '+10% к атаке, организация восстанавливается на 25% быстрее.' },
    { id: 'a_panzer', x: 2, y: 3, days: 50, req: ['a_wehr'], name: 'Панцерваффе', fx: { army: { name: '1-я танковая армия', divs: 15 } },
      desc: 'Новая армия из 15 танковых дивизий.' },
    { id: 'a_wall', x: 0, y: 4, days: 60, req: ['a_blitz'], name: 'Восточный вал', fx: { defense: 0.2 },
      desc: 'Оборона армий +20%.' },
    { id: 'a_luftwaffe', x: 2, y: 4, days: 60, req: ['a_panzer'], name: 'Люфтваффе-II', fx: { attackBonus: 0.05, loss: 0.15 },
      desc: '+5% к атаке, потери в наступлении −15%.' },
    { id: 'a_hegemony', x: 1, y: 5, days: 90, req: ['a_wall', 'a_luftwaffe'], name: 'Европейская гегемония', fx: { pp: 1, addDivs: 12 },
      desc: '+1 ПВ в день, +12 дивизий в резерв.' },

    { id: 'a_ruhr', x: 3, y: 3, days: 50, req: ['a_concert'], name: 'Рурское чудо', fx: { addFactories: 5, factoryEvery: 25 },
      desc: '+5 заводов и пассивный рост: +1 завод каждые 25 дней.' },
    { id: 'a_uranium', x: 5, y: 3, days: 50, req: ['a_concert'], name: 'Урановый приоритет', fx: { nucCost: 0.2, nucDays: 0.4 },
      desc: 'Ядерная ветка: −20% к стоимости, −40% ко времени.' },
    { id: 'a_customs', x: 3, y: 4, days: 60, req: ['a_ruhr'], name: 'Таможенный союз', fx: { allies: ['SWE', 'CHE', 'SRB'] },
      desc: 'Швеция, Швейцария и Югославия вступают в Пакт Оси (если нейтральны).' },
    { id: 'a_techno', x: 5, y: 4, days: 60, req: ['a_uranium'], name: 'Технократия', fx: { rp: 0.2, train: 0.2 },
      desc: '+20% ОИ, дивизии обучаются на 20% быстрее.' },
    { id: 'a_mittel', x: 4, y: 5, days: 90, req: ['a_customs', 'a_techno'], name: 'Срединная Европа', fx: { annex: ['HUN', 'HRV'], pp: 1 },
      desc: 'Венгрия и Хорватия мирно входят в Рейх. +1 ПВ в день.' },

    { id: 'a_iberia', x: 6, y: 3, days: 50, req: ['a_neworder'], name: 'Иберийский пакт', fx: { army: { name: 'Испанский легион', divs: 8 } },
      desc: 'Испанские добровольцы: новая армия из 8 дивизий.' },
    { id: 'a_danube', x: 8, y: 3, days: 50, req: ['a_neworder'], name: 'Дунайский вопрос', fx: { claims: ['CZE', 'POL'] },
      desc: 'Повод для войны с Чехословакией и Польшей.' },
    { id: 'a_balkans', x: 6, y: 4, days: 60, req: ['a_iberia'], name: 'Балканская кампания', fx: { claims: ['SRB', 'GRC', 'ROU'] },
      desc: 'Повод для войны с Югославией, Грецией и Румынией.' },
    { id: 'a_argentina', x: 8, y: 4, days: 60, req: ['a_danube'], name: 'Аргентинский мост', fx: { allies: ['CHL', 'PRY', 'BOL'] },
      desc: 'Чили, Парагвай и Боливия вступают в Пакт Оси (если нейтральны).' },
    { id: 'a_revanche', x: 7, y: 5, days: 90, req: ['a_balkans', 'a_argentina'], name: 'Реванш', fx: { justify: 0.4, attackBonus: 0.1, claims: 'neighbors' },
      desc: 'Повод для войны со всеми соседями, обоснование −40%, +10% к атаке.' }
  ]
};

// Плоский список всех фокусов (id уникальны благодаря префиксам s_/w_/a_)
const FOCUSES = [].concat(...Object.values(FOCUS_TREES));
// Разовые эффекты не попадают в постоянные бонусы
const FOCUS_ONCE = ['addFactories', 'addMP', 'addDivs', 'addPP', 'tension', 'claims', 'allies', 'annex', 'army', 'factories', 'mp'];
