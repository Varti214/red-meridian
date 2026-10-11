'use strict';
/* ============================================================
   ДЕРЕВЬЯ НАЦИОНАЛЬНЫХ ФОКУСОВ — у каждой державы своё.
   Устройство дерева (как в HOI4):
     ряд 0 — стартовый фокус;
     ряд 1 — общие фокусы (доступны при любом курсе);
     ряд 2 — ВЫБОР ПОЛИТИЧЕСКОГО ПУТИ: три взаимоисключающих варианта.
             Один сохраняет нынешнего лидера, два других приводят к власти
             другого человека и меняют идеологию страны (fx.gov);
     ряды 3–4 — ветка выбранного пути;
     ряд 5 — завершающий фокус пути.
   x — колонка (0–8), y — ряд (0–5).

   Эффекты fx:
     постоянные бонусы: pp, rp, attackBonus, defense, org, loss, train, mpMult, spyCost, spyChance,
       spyTension, intelKeep, justify, influence, tensionDecay, nucCost, nucDays, factoryEvery, amph;
     разовые: addFactories, addMP, addDivs, addPP, tension,
       gov — смена власти { ide, leader, title } (идеологии — в js/politics.js),
       pop — сдвиг популярности в своей стране { идеология: пункты },
       claims — повод для войны (список стран или 'neighbors' — все соседи),
       allies — неприсоединившиеся страны вступают в наш блок,
       annex — союзники мирно входят в состав державы,
       army — новая армия { name, divs }.
   ============================================================ */

const FOCUS_TREES = {
  SOV: [
    { id: 's_root', x: 4, y: 0, days: 35, req: [], name: 'Майские указы', fx: { pp: 0.5 },
      desc: 'Национальные проекты на шесть лет вперёд. +0,5 ПВ в день.' },
    { id: 's_import', x: 1, y: 1, days: 50, req: ['s_root'], name: 'Импортозамещение', fx: { addFactories: 5 },
      desc: 'Своё вместо западного. +5 заводов немедленно.' },
    { id: 's_army', x: 4, y: 1, days: 50, req: ['s_root'], name: 'Армия нового облика', fx: { addMP: 300, train: 0.15 },
      desc: '+300 тыс. призывников, дивизии обучаются на 15% быстрее.' },
    { id: 's_fsb', x: 7, y: 1, days: 45, req: ['s_root'], name: 'Укрепление спецслужб', fx: { spyCost: 0.3, spyChance: 0.15 },
      desc: 'Тайные операции и вмешательство дешевле на 30%, успех +15%.' },

    { id: 's_sovereign', x: 1, y: 2, days: 40, req: ['s_root'], excl: ['s_thaw', 's_red'], name: 'Суверенная демократия', path: 'Курс преемственности',
      fx: { gov: { ide: 'auth', leader: 'Владимир Путин', title: 'Президент России' }, pp: 0.3, pop: { auth: 8 } },
      desc: 'Владимир Путин остаётся у руля, вертикаль власти крепнет. +0,3 ПВ в день.' },
    { id: 's_thaw', x: 4, y: 2, days: 60, req: ['s_root'], excl: ['s_sovereign', 's_red'], name: 'Оттепель', path: 'Либеральный путь',
      fx: { gov: { ide: 'lib', leader: 'Алексей Навальный', title: 'Президент России' }, tensionDecay: 2, rp: 0.05 },
      desc: 'Досрочные выборы приводят к власти Алексея Навального. Идеология — либеральная демократия. Напряжённость спадает вдвое быстрее.' },
    { id: 's_red', x: 7, y: 2, days: 60, req: ['s_root'], excl: ['s_sovereign', 's_thaw'], name: 'Красный реванш', path: 'Левый поворот',
      fx: { gov: { ide: 'com', leader: 'Геннадий Зюганов', title: 'Председатель Совета министров' }, mpMult: 0.2 },
      desc: 'Коммунисты берут большинство, правительство возглавляет Геннадий Зюганов. Идеология — коммунизм. Призыв +20%.' },

    { id: 's_reset', x: 0, y: 3, days: 50, req: ['s_sovereign'], name: 'Обнуление сроков', fx: { pp: 0.4, pop: { auth: 10 } },
      desc: 'Новая конституция и новые сроки. +0,4 ПВ в день, популярность власти +10%.' },
    { id: 's_union', x: 2, y: 3, days: 60, req: ['s_sovereign'], name: 'Союзное государство', fx: { annex: ['BLR'] },
      desc: 'Беларусь мирно входит в состав России (если остаётся союзником по ОДКБ).' },
    { id: 's_eurasia', x: 0, y: 4, days: 60, req: ['s_reset'], name: 'Евразийский союз', fx: { allies: ['UZB', 'TKM', 'AZE', 'MNG', 'SRB', 'MDA'] },
      desc: 'Узбекистан, Туркмения, Азербайджан, Монголия, Сербия и Молдавия вступают в ОДКБ (если нейтральны).' },
    { id: 's_hyper', x: 2, y: 4, days: 60, req: ['s_union'], name: 'Гиперзвуковое оружие', fx: { nucCost: 0.2, nucDays: 0.4, attackBonus: 0.05 },
      desc: 'Ядерная ветка: −20% к стоимости, −40% ко времени. Атака +5%.' },
    { id: 's_greatpower', x: 1, y: 5, days: 90, req: ['s_eurasia', 's_hyper'], name: 'Великая держава', fx: { pp: 1, defense: 0.15, claims: ['UKR', 'GEO', 'MDA'] },
      desc: '+1 ПВ в день, оборона армий +15%, поводы для войны с Украиной, Грузией и Молдавией.' },

    { id: 's_detente', x: 3, y: 3, days: 50, req: ['s_thaw'], name: 'Перезагрузка с Западом', fx: { tension: -10, addFactories: 6 },
      desc: 'Санкции снимаются, инвестиции возвращаются. Напряжённость −10, +6 заводов.' },
    { id: 's_courts', x: 5, y: 3, days: 50, req: ['s_thaw'], name: 'Независимые суды', fx: { rp: 0.1, pp: 0.3, pop: { lib: 8 } },
      desc: 'Бизнес перестаёт бояться. +10% ОИ, +0,3 ПВ в день.' },
    { id: 's_federal', x: 3, y: 4, days: 60, req: ['s_detente'], name: 'Настоящий федерализм', fx: { addFactories: 4, factoryEvery: 25 },
      desc: 'Регионы оставляют себе налоги. +4 завода и +1 завод каждые 25 дней.' },
    { id: 's_europe', x: 5, y: 4, days: 60, req: ['s_courts'], name: 'Европейский выбор', fx: { allies: ['UKR', 'GEO', 'MDA', 'ARM', 'FIN', 'SRB'] },
      desc: 'Украина, Грузия, Молдавия, Армения, Финляндия и Сербия вступают в наш блок (если нейтральны).' },
    { id: 's_future', x: 4, y: 5, days: 90, req: ['s_federal', 's_europe'], name: 'Прекрасная Россия будущего', fx: { rp: 0.15, pp: 1, influence: 0.3 },
      desc: '+15% ОИ, +1 ПВ в день, влияние дешевле на 30%.' },

    { id: 's_nation', x: 6, y: 3, days: 50, req: ['s_red'], name: 'Национализация', fx: { addFactories: 8, addPP: -30 },
      desc: 'Сырьё и крупные заводы снова принадлежат государству. +8 заводов, −30 ПВ.' },
    { id: 's_gosplan', x: 8, y: 3, days: 50, req: ['s_red'], name: 'Госплан 2.0', fx: { factoryEvery: 20, train: 0.2 },
      desc: '+1 завод каждые 20 дней, обучение дивизий быстрее на 20%.' },
    { id: 's_brothers', x: 6, y: 4, days: 60, req: ['s_nation'], name: 'Союз братских народов', fx: { allies: ['UZB', 'TKM', 'MDA', 'UKR', 'GEO', 'AZE', 'MNG', 'CUB', 'VEN', 'VNM'] },
      desc: 'Бывшие республики и левые режимы вступают в наш блок (если нейтральны).' },
    { id: 's_redarmy', x: 8, y: 4, days: 60, req: ['s_gosplan'], name: 'Рабоче-крестьянская армия', fx: { army: { name: '1-я Краснознамённая армия', divs: 15 }, mpMult: 0.15 },
      desc: 'Новая армия из 15 дивизий, призыв +15%.' },
    { id: 's_ussr', x: 7, y: 5, days: 90, req: ['s_brothers', 's_redarmy'], name: 'Новый Союз', fx: { annex: ['BLR', 'KAZ', 'KGZ', 'TJK', 'ARM', 'UZB', 'TKM'], claims: ['UKR', 'GEO', 'MDA', 'EST', 'LVA', 'LTU', 'AZE'], pp: 1 },
      desc: 'Союзные республики Средней Азии, Кавказа и Беларусь входят в обновлённый Союз. Поводы для войны с остальными. +1 ПВ в день.' }
  ],

  WST: [
    { id: 'w_root', x: 4, y: 0, days: 35, req: [], name: 'Стратегия национальной безопасности', fx: { pp: 0.5 },
      desc: 'Эпоха соперничества великих держав. +0,5 ПВ в день.' },
    { id: 'w_tax', x: 1, y: 1, days: 50, req: ['w_root'], name: 'Налоговая реформа', fx: { addFactories: 6 },
      desc: '+6 заводов немедленно.' },
    { id: 'w_pentagon', x: 4, y: 1, days: 50, req: ['w_root'], name: 'Бюджет Пентагона', fx: { addMP: 250, defense: 0.05, train: 0.1 },
      desc: '+250 тыс. призывников, оборона +5%, обучение быстрее на 10%.' },
    { id: 'w_cyber', x: 7, y: 1, days: 45, req: ['w_root'], name: 'Киберкомандование', fx: { spyCost: 0.3, spyChance: 0.15 },
      desc: 'Тайные операции и вмешательство дешевле на 30%, успех +15%.' },

    { id: 'w_first', x: 1, y: 2, days: 40, req: ['w_root'], excl: ['w_liberal', 'w_bernie'], name: 'Америка прежде всего', path: 'Курс Трампа',
      fx: { gov: { ide: 'con', leader: 'Дональд Трамп', title: 'Президент США' }, pp: 0.3, attackBonus: 0.05, pop: { con: 6 } },
      desc: 'Дональд Трамп и республиканцы удерживают курс. +0,3 ПВ в день, атака +5%.' },
    { id: 'w_liberal', x: 4, y: 2, days: 60, req: ['w_root'], excl: ['w_first', 'w_bernie'], name: 'Америка вернулась', path: 'Демократы',
      fx: { gov: { ide: 'lib', leader: 'Джо Байден', title: 'Президент США' }, influence: 0.25, tensionDecay: 1.5 },
      desc: 'Импичмент и досрочная смена власти: президентом становится Джо Байден. Идеология — либеральная демократия. Влияние дешевле на 25%.' },
    { id: 'w_bernie', x: 7, y: 2, days: 60, req: ['w_root'], excl: ['w_first', 'w_liberal'], name: 'Политическая революция', path: 'Левый поворот',
      fx: { gov: { ide: 'soc', leader: 'Берни Сандерс', title: 'Президент США' }, rp: 0.1, pp: 0.2 },
      desc: 'Волна низовой мобилизации приводит в Белый дом Берни Сандерса. Идеология — социал-демократия. +10% ОИ.' },

    { id: 'w_wall', x: 0, y: 3, days: 50, req: ['w_first'], name: 'Стена на границе', fx: { defense: 0.1, pop: { con: 6 } },
      desc: 'Оборона армий +10%, популярность республиканцев +6%.' },
    { id: 'w_tariffs', x: 2, y: 3, days: 50, req: ['w_first'], name: 'Тарифная война', fx: { addFactories: 6, tension: 3 },
      desc: 'Производства возвращаются домой. +6 заводов, напряжённость +3.' },
    { id: 'w_space', x: 0, y: 4, days: 60, req: ['w_wall'], name: 'Космические силы', fx: { rp: 0.1, attackBonus: 0.05 },
      desc: 'Новый вид вооружённых сил. +10% ОИ, атака +5%.' },
    { id: 'w_pressure', x: 2, y: 4, days: 60, req: ['w_tariffs'], name: 'Максимальное давление', fx: { claims: ['IRN', 'VEN', 'PRK', 'CUB', 'SYR'], justify: 0.2 },
      desc: 'Поводы для войны с Ираном, Венесуэлой, КНДР, Кубой и Сирией. Обоснование −20%.' },
    { id: 'w_great', x: 1, y: 5, days: 90, req: ['w_space', 'w_pressure'], name: 'Великая Америка', fx: { pp: 1, defense: 0.1, addDivs: 10 },
      desc: '+1 ПВ в день, оборона +10%, +10 дивизий в резерв.' },

    { id: 'w_nato', x: 3, y: 3, days: 50, req: ['w_liberal'], name: 'Расширение НАТО', fx: { allies: ['SWE', 'FIN', 'UKR', 'GEO', 'MDA', 'MKD'] },
      desc: 'Швеция, Финляндия, Украина, Грузия, Молдавия и Северная Македония вступают в НАТО (если нейтральны).' },
    { id: 'w_infra', x: 5, y: 3, days: 50, req: ['w_liberal'], name: 'Инфраструктурный план', fx: { addFactories: 6, factoryEvery: 25 },
      desc: '+6 заводов и +1 завод каждые 25 дней.' },
    { id: 'w_democracies', x: 3, y: 4, days: 60, req: ['w_nato'], name: 'Саммит демократий', fx: { influence: 0.2, allies: ['IND', 'IDN', 'PHL', 'BRA', 'MEX', 'ARG', 'TWN'] },
      desc: 'Индия, Индонезия, Филиппины, Бразилия, Мексика, Аргентина и Тайвань вступают в блок (если нейтральны).' },
    { id: 'w_chips', x: 5, y: 4, days: 60, req: ['w_infra'], name: 'Закон о чипах', fx: { rp: 0.15, train: 0.1 },
      desc: '+15% ОИ, обучение дивизий быстрее на 10%.' },
    { id: 'w_order', x: 4, y: 5, days: 90, req: ['w_democracies', 'w_chips'], name: 'Порядок, основанный на правилах', fx: { pp: 1, justify: 0.3, addFactories: 6 },
      desc: '+1 ПВ в день, обоснование войны −30%, +6 заводов.' },

    { id: 'w_medicare', x: 6, y: 3, days: 50, req: ['w_bernie'], name: 'Медицина для всех', fx: { mpMult: 0.25, pop: { soc: 8 } },
      desc: 'Призыв +25%, популярность социалистов +8%.' },
    { id: 'w_greendeal', x: 8, y: 3, days: 50, req: ['w_bernie'], name: 'Зелёный новый курс', fx: { addFactories: 8, factoryEvery: 22 },
      desc: '+8 заводов и +1 завод каждые 22 дня.' },
    { id: 'w_peace', x: 6, y: 4, days: 60, req: ['w_medicare'], name: 'Конец бесконечных войн', fx: { tension: -10, tensionDecay: 2, defense: 0.1 },
      desc: 'Напряжённость −10 и спадает вдвое быстрее, оборона +10%.' },
    { id: 'w_unions', x: 8, y: 4, days: 60, req: ['w_greendeal'], name: 'Сила профсоюзов', fx: { pp: 0.5, train: 0.15 },
      desc: '+0,5 ПВ в день, обучение дивизий быстрее на 15%.' },
    { id: 'w_dream', x: 7, y: 5, days: 90, req: ['w_peace', 'w_unions'], name: 'Новая американская мечта', fx: { rp: 0.2, pp: 1, addFactories: 6 },
      desc: '+20% ОИ, +1 ПВ в день, +6 заводов.' }
  ],

  AXS: [
    { id: 'a_root', x: 4, y: 0, days: 35, req: [], name: 'Китайская мечта', fx: { pp: 0.5 },
      desc: 'Великое возрождение китайской нации к столетию КНР. +0,5 ПВ в день.' },
    { id: 'a_made', x: 1, y: 1, days: 50, req: ['a_root'], name: 'Сделано в Китае 2025', fx: { addFactories: 6, rp: 0.05 },
      desc: '+6 заводов, +5% ОИ.' },
    { id: 'a_pla', x: 4, y: 1, days: 50, req: ['a_root'], name: 'Реформа НОАК', fx: { addMP: 350, train: 0.15 },
      desc: 'Театры военных действий вместо военных округов. +350 тыс. призывников, обучение быстрее на 15%.' },
    { id: 'a_mss', x: 7, y: 1, days: 45, req: ['a_root'], name: 'Министерство госбезопасности', fx: { spyCost: 0.3, spyChance: 0.15 },
      desc: 'Тайные операции и вмешательство дешевле на 30%, успех +15%.' },

    { id: 'a_xi', x: 1, y: 2, days: 40, req: ['a_root'], excl: ['a_reform', 'a_hawks'], name: 'Новая эпоха', path: 'Курс Си',
      fx: { gov: { ide: 'com', leader: 'Си Цзиньпин', title: 'Председатель КНР' }, pp: 0.3, pop: { com: 6 } },
      desc: 'Си Цзиньпин остаётся у власти без ограничения сроков. +0,3 ПВ в день.' },
    { id: 'a_reform', x: 4, y: 2, days: 60, req: ['a_root'], excl: ['a_xi', 'a_hawks'], name: 'Партия реформ', path: 'Реформаторы',
      fx: { gov: { ide: 'soc', leader: 'Ли Кэцян', title: 'Председатель КНР' }, rp: 0.1, tensionDecay: 1.5 },
      desc: 'Пленум ЦК делает ставку на рыночные реформы, лидером страны становится Ли Кэцян. Идеология — социал-демократия. +10% ОИ.' },
    { id: 'a_hawks', x: 7, y: 2, days: 60, req: ['a_root'], excl: ['a_xi', 'a_reform'], name: 'Партия силы', path: 'Военные',
      fx: { gov: { ide: 'nat', leader: 'Чжан Юся', title: 'Председатель Центрального военного совета' }, attackBonus: 0.05, justify: 0.1 },
      desc: 'Генералы НОАК берут власть, страну возглавляет Чжан Юся. Идеология — национализм. Атака +5%.' },

    { id: 'a_bri', x: 0, y: 3, days: 50, req: ['a_xi'], name: 'Один пояс — один путь', fx: { allies: ['LKA', 'NPL', 'MMR', 'BGD', 'MNG', 'IRN'] },
      desc: 'Шри-Ланка, Непал, Мьянма, Бангладеш, Монголия и Иран вступают в блок (если нейтральны).' },
    { id: 'a_dual', x: 2, y: 3, days: 50, req: ['a_xi'], name: 'Двойная циркуляция', fx: { addFactories: 8 },
      desc: 'Опора на внутренний рынок. +8 заводов.' },
    { id: 'a_scs', x: 0, y: 4, days: 60, req: ['a_bri'], name: 'Южно-Китайское море', fx: { claims: ['TWN', 'VNM', 'PHL'], amph: 0.2 },
      desc: 'Поводы для войны с Тайванем, Вьетнамом и Филиппинами. Штраф за форсирование проливов −20 п.п.' },
    { id: 'a_tech', x: 2, y: 4, days: 60, req: ['a_dual'], name: 'Технологический суверенитет', fx: { rp: 0.15, nucCost: 0.2, nucDays: 0.3 },
      desc: '+15% ОИ, ядерная ветка дешевле на 20% и быстрее на 30%.' },
    { id: 'a_rejuv', x: 1, y: 5, days: 90, req: ['a_scs', 'a_tech'], name: 'Великое возрождение', fx: { pp: 1, defense: 0.15, addDivs: 12 },
      desc: '+1 ПВ в день, оборона +15%, +12 дивизий в резерв.' },

    { id: 'a_open', x: 3, y: 3, days: 50, req: ['a_reform'], name: 'Новая открытость', fx: { addFactories: 6, tension: -6 },
      desc: 'Иностранный капитал возвращается. +6 заводов, напряжённость −6.' },
    { id: 'a_private', x: 5, y: 3, days: 50, req: ['a_reform'], name: 'Свобода частного бизнеса', fx: { factoryEvery: 22, rp: 0.05 },
      desc: '+1 завод каждые 22 дня, +5% ОИ.' },
    { id: 'a_asean', x: 3, y: 4, days: 60, req: ['a_open'], name: 'Азиатское партнёрство', fx: { allies: ['VNM', 'THA', 'MYS', 'IDN', 'MNG', 'MMR'] },
      desc: 'Вьетнам, Таиланд, Малайзия, Индонезия, Монголия и Мьянма вступают в блок (если нейтральны).' },
    { id: 'a_innov', x: 5, y: 4, days: 60, req: ['a_private'], name: 'Инновационная экономика', fx: { rp: 0.15, train: 0.1 },
      desc: '+15% ОИ, обучение дивизий быстрее на 10%.' },
    { id: 'a_harmony', x: 4, y: 5, days: 90, req: ['a_asean', 'a_innov'], name: 'Гармоничное общество', fx: { pp: 1, tensionDecay: 2, addFactories: 8 },
      desc: '+1 ПВ в день, напряжённость спадает вдвое быстрее, +8 заводов.' },

    { id: 'a_navy', x: 6, y: 3, days: 50, req: ['a_hawks'], name: 'Флот открытого океана', fx: { amph: 0.25, attackBonus: 0.05 },
      desc: 'Авианосцы и десантные корабли. Штраф за проливы −25 п.п., атака +5%.' },
    { id: 'a_rocket', x: 8, y: 3, days: 50, req: ['a_hawks'], name: 'Ракетные войска', fx: { nucCost: 0.2, nucDays: 0.4 },
      desc: 'Ядерная ветка: −20% к стоимости, −40% ко времени.' },
    { id: 'a_taiwan', x: 6, y: 4, days: 60, req: ['a_navy'], name: 'Воссоединение', fx: { claims: ['TWN'], army: { name: 'Ударная группа Восточного театра', divs: 15 } },
      desc: 'Повод для войны с Тайванем, новая армия из 15 дивизий.' },
    { id: 'a_borders', x: 8, y: 4, days: 60, req: ['a_rocket'], name: 'Возвращение территорий', fx: { claims: ['IND', 'VNM', 'MNG', 'BTN'] },
      desc: 'Поводы для войны с Индией, Вьетнамом, Монголией и Бутаном.' },
    { id: 'a_tianxia', x: 7, y: 5, days: 90, req: ['a_taiwan', 'a_borders'], name: 'Поднебесная', fx: { justify: 0.4, attackBonus: 0.1, claims: 'neighbors' },
      desc: 'Повод для войны со всеми соседями, обоснование −40%, атака +10%.' }
  ]
};

// Плоский список всех фокусов (id уникальны благодаря префиксам s_/w_/a_)
const FOCUSES = [].concat(...Object.values(FOCUS_TREES));
// Разовые эффекты не попадают в постоянные бонусы
const FOCUS_ONCE = ['addFactories', 'addMP', 'addDivs', 'addPP', 'tension', 'claims', 'allies', 'annex', 'army', 'factories', 'mp', 'gov', 'pop'];
