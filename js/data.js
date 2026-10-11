'use strict';
/* ============================================================
   СТАТИЧЕСКИЕ ДАННЫЕ: настройки баланса, блоки, страны,
   технологии, тайные операции, батальоны, державы.
   Сценарий: 1 января 2018 года, многополярный мир.
   Политика (идеологии, правительства, выборы) — в js/politics.js,
   события и мировые новости — в js/events.js.
   Хотите поменять баланс — меняйте числа здесь.
   ============================================================ */

const CFG = {
  START_DATE: Date.UTC(2018, 0, 1),           // 1 января 2018
  SPEEDS: [0, 1000, 500, 250, 100],           // мс реального времени на 1 игровой день (индекс 1..4)
  PLAYER: 'SOV',
  CAPITAL: 'RUS',
  CAPITAL_POS: { lat: 55.75, lng: 37.62 },    // Москва
  START: { pp: 60, mp: 1500, divs: 30, org: 100, rp: 50, tension: 18 },

  PP_BASE: 2.0,                // политвласть в день
  RP_BASE: 1.0,                // очки исследований в день
  RP_PER_FACTORY: 0.03,
  MP_PER_POP: 1e-8,            // тыс. призывников в день на одного жителя
  ANNEXED_MP: 0.5,             // присоединённые земли дают половину призывников

  DIV: { pp: 6, mp: 18, days: 14, attack: 10, defense: 10 },
  ARMY: { max: 40, stepDays: 3, seaStepDays: 6, haltOrg: 15 },   // армия: потолок дивизий, дни на переход, остановка наступления
  ORG_REGEN: 3.5,              // восстановление организации армии в день, %
  ENEMY_DIV_DEF: 9,

  JUSTIFY: { pp: 20, ppPerFactory: 0.8, ppMax: 90, days: 18, daysPerFactory: 0.6, tension: 2 },
  DECLARE_TENSION: 6,
  SPY_BASE_TENSION_FAIL: 2.5,
  FORTIFY_PP: 20,
  PEACE_PP: 25,
  INFLUENCE: { pp: 40, days: 45 },
  INTEGRATE: { pp: 60, days: 60 },
  // Политика: поддержка партии, вмешательство в выборы, переворот
  POL: { support: 20, supportDays: 120, meddle: 35, meddleWindow: 180, coup: 60, coupMinPop: 12 },

  WARHEAD_DAYS: 90,
  NUKE_TENSION: 30,
  NUCLEAR_WINTER: 7,           // столько пустошей — и мир погружается в ядерную зиму
  VICTORY_SHARE: 0.55,         // доля мировой промышленности для победы
  TENSION_DECAY: 0.06,
  AUTOSAVE_DAYS: 30,
  SAVE_KEY: 'red_meridian_save_v3',
  SETTINGS_KEY: 'red_meridian_settings_v1'
};

/* Блоки. Ключи исторические (так их знает код), названия — 2018 года:
   SOV — земли России, COM — ОДКБ и союзники Москвы, WEST — НАТО и союзники США,
   AXIS — партнёры Китая по «Поясу и пути», UAF — земли Украины (если за неё играют),
   GUAM — ГУАМ (Грузия, Украина, Азербайджан, Молдова), NEU — неприсоединившиеся. */
const FACTIONS = {
  SOV:  { name: 'Россия',             color: '#b3121f', side: '#4d070c', stroke: '#ff8a7a', leader: 'RUS' },
  COM:  { name: 'ОДКБ',               color: '#9a3a5c', side: '#3f1726', stroke: '#f0a0bc', leader: 'RUS' },
  WEST: { name: 'НАТО',               color: '#2d67c4', side: '#12284d', stroke: '#9cc2ff', leader: 'USA' },
  AXIS: { name: 'Пояс и путь',        color: '#a8841c', side: '#3e3008', stroke: '#f0d070', leader: 'CHN' },
  UAF:  { name: 'Украина',            color: '#2fa3e0', side: '#0c3550', stroke: '#a8dcff', leader: 'UKR' },
  GUAM: { name: 'ГУАМ',               color: '#3e8f8c', side: '#123332', stroke: '#9fe0dc', leader: 'UKR' },
  NEU:  { name: 'Неприсоединившиеся', color: '#6b6748', side: '#2a281b', stroke: '#b9b48e' },
  NONE: { name: 'Без государства',    color: '#7f8b96', side: '#30363c', stroke: '#c9d2da' }
};

// Множитель обороны дивизий по доктрине блока
const FACTION_DEF = { SOV: 1.0, COM: 0.9, WEST: 1.15, AXIS: 1.05, UAF: 1.05, GUAM: 0.9, NEU: 0.85, NONE: 0.5 };
// Блоки, за которые вступаются союзники (для ИИ)
const BLOCS = ['WEST', 'COM', 'AXIS', 'SOV', 'UAF', 'GUAM'];

// Состав блоков на 1 января 2018 года
const FACTION_MEMBERS = {
  SOV:  ['RUS'],
  COM:  ['BLR', 'KAZ', 'ARM', 'KGZ', 'TJK', 'SYR'],
  GUAM: ['UKR', 'GEO', 'AZE', 'MDA'],
  WEST: ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'ESP', 'PRT', 'NLD', 'BEL', 'LUX', 'NOR', 'DNK', 'ISL', 'POL', 'CZE',
         'SVK', 'HUN', 'ROU', 'BGR', 'HRV', 'SVN', 'ALB', 'MNE', 'EST', 'LVA', 'LTU', 'GRC', 'TUR', 'JPN', 'KOR', 'AUS',
         'NZL', 'ISR', 'GRL', 'PRI', 'FLK', 'ATF', 'NCL'],
  AXIS: ['CHN', 'PRK', 'PAK', 'LAO', 'KHM'],
  NONE: ['ATA']
};

const MAJORS = ['USA', 'GBR', 'FRA', 'DEU', 'JPN', 'CHN', 'ITA', 'IND', 'CAN', 'BRA', 'KOR'];

// Ручные стартовые значения: заводы (fac), дивизии (divs), укрепления (fort)
const COUNTRY_OVERRIDES = {
  RUS: { fac: 40 }, USA: { fac: 70, divs: 36, fort: 1 }, CHN: { fac: 68, divs: 45, fort: 1 },
  JPN: { fac: 20, divs: 8, fort: 1 }, DEU: { fac: 20, divs: 8 }, IND: { fac: 16, divs: 30, fort: 1 },
  GBR: { fac: 12, divs: 6, fort: 1 }, FRA: { fac: 12, divs: 8 }, KOR: { fac: 10, divs: 14, fort: 2 },
  ITA: { fac: 10, divs: 6 }, BRA: { fac: 9, divs: 8 }, CAN: { fac: 8, divs: 3 }, TUR: { fac: 8, divs: 16, fort: 1 },
  MEX: { fac: 7, divs: 4 }, ESP: { fac: 7, divs: 5 }, IRN: { fac: 5, divs: 14, fort: 1 }, SAU: { fac: 6, divs: 6 },
  ISR: { fac: 4, divs: 8, fort: 2 }, PAK: { fac: 3, divs: 14, fort: 1 }, POL: { fac: 6, divs: 6 }, UKR: { fac: 8, divs: 14, fort: 2 },
  PRK: { fac: 2, divs: 22, fort: 3 }, TWN: { fac: 6, divs: 8, fort: 2 }, IDN: { fac: 6, divs: 8 }, AUS: { fac: 6, divs: 3 },
  EGY: { fac: 3, divs: 10 }, VNM: { fac: 3, divs: 10, fort: 1 }, KAZ: { fac: 3, divs: 3 }, BLR: { fac: 2, divs: 4 },
  SYR: { fac: 0, divs: 5 }, SWE: { fac: 4, divs: 3 }, CHE: { fac: 4, divs: 3, fort: 2 }, FIN: { fac: 2, divs: 4, fort: 2 },
  AFG: { fac: 0, divs: 5, fort: 2 }, ATA: { fac: 0, divs: 0 }
};

// Ручные центры стран, где автоматический расчёт ошибается из-за островов и 180-го меридиана
const CENTROID_OVERRIDES = {
  RUS: { lat: 60, lng: 90 }, USA: { lat: 39, lng: -98 }, CAN: { lat: 57, lng: -101 }, FRA: { lat: 46.6, lng: 2.4 },
  NOR: { lat: 62, lng: 10 }, FJI: { lat: -17.8, lng: 178 }, IDN: { lat: -2, lng: 115 }, CHL: { lat: -33, lng: -71 },
  NZL: { lat: -41.5, lng: 173 }, GBR: { lat: 53, lng: -1.5 }, JPN: { lat: 36.5, lng: 138.5 }, GRL: { lat: 73, lng: -41 }
};

// Морские переправы: страны через узкий пролив считаются соседями,
// но наступление через воду слабее (форсирование пролива)
const SEA_LINKS = [
  ['RUS', 'JPN'], ['RUS', 'USA'], ['GBR', 'FRA'], ['ESP', 'MAR'], ['DNK', 'SWE'], ['DNK', 'NOR'], ['CUB', 'USA'],
  ['TWN', 'CHN'], ['LKA', 'IND'], ['FIN', 'EST'], ['AUS', 'PNG'], ['KOR', 'JPN'], ['ITA', 'TUN'],
  ['YEM', 'DJI'], ['SAU', 'EGY'], ['ISL', 'GRL'], ['DEU', 'SWE'], ['TWN', 'PHL'], ['CHN', 'KOR']
];

const DIFFICULTY = {
  easy:   { name: 'Новичок',           desc: 'Слабая оборона врага, щедрая политвласть.',      aiDef: 0.85, aiGrowth: 0.75, aiAggr: 0.6, pp: 1.25 },
  normal: { name: 'Стратег',           desc: 'Задуманный баланс сил.',                          aiDef: 1.0,  aiGrowth: 1.0,  aiAggr: 1.0, pp: 1.0 },
  hard:   { name: 'Главнокомандующий', desc: 'Мир объединится против вас. Без права на ошибку.', aiDef: 1.2, aiGrowth: 1.3, aiAggr: 1.4, pp: 0.9 }
};

/* ---------------- ТЕХНОЛОГИИ ---------------- */
const TECH_BRANCHES = [
  { id: 'industry', icon: 'i-factory', name: 'Цифровая экономика',            desc: 'Пассивный рост заводов и научного потенциала' },
  { id: 'armor',    icon: 'i-div',     name: 'Армия нового поколения',        desc: 'Множитель силы атаки дивизий' },
  { id: 'nuclear',  icon: 'i-nuke',    name: 'Стратегические ядерные силы',   desc: 'Арсенал есть у всех трёх держав — путь к праву на ядерный удар' }
];

const TECHS = [
  { id: 'ind1', branch: 'industry', tier: 1, name: 'Цифровые платформы', cost: 90, days: 20, req: [], fx: { factoryEvery: 30 },
    desc: 'Госуслуги, логистика и заводы уходят в «цифру». +1 завод каждые 30 дней.' },
  { id: 'ind2', branch: 'industry', tier: 2, name: 'Роботизированные производства', cost: 195, days: 30, req: ['ind1'], fx: { factoryEvery: 20, rp: 0.15 },
    desc: '+1 завод каждые 20 дней, +15% очков исследований.' },
  { id: 'ind3', branch: 'industry', tier: 3, name: 'Искусственный интеллект', cost: 360, days: 40, req: ['ind2'], fx: { factoryEvery: 12, train: 0.25 },
    desc: '+1 завод каждые 12 дней, обучение дивизий быстрее на 25%.' },
  { id: 'ind4', branch: 'industry', tier: 4, name: 'Квантовые вычисления', cost: 570, days: 55, req: ['ind3'], fx: { factoryEvery: 7, rp: 0.25, pp: 0.5 },
    desc: '+1 завод каждые 7 дней, +25% ОИ, +0,5 политвласти в день.' },

  { id: 'arm1', branch: 'armor', tier: 1, name: 'Модернизация Т-90М', cost: 90, days: 20, req: [], fx: { attack: 1.1 },
    desc: 'Новая СУО, динамическая защита и тепловизоры. Атака дивизий ×1,1.' },
  { id: 'arm2', branch: 'armor', tier: 2, name: 'Платформа «Армата»', cost: 210, days: 30, req: ['arm1'], fx: { attack: 1.25, train: 0.1 },
    desc: 'Танк с необитаемой башней. Атака ×1,25, обучение дивизий быстрее на 10%.' },
  { id: 'arm3', branch: 'armor', tier: 3, name: 'Ударные беспилотники', cost: 375, days: 45, req: ['arm2'], fx: { attack: 1.45, loss: 0.2 },
    desc: 'Дроны-разведчики и барражирующие боеприпасы. Атака ×1,45, потери в наступлении −20%.' },
  { id: 'arm4', branch: 'armor', tier: 4, name: 'Сетецентрическая война', cost: 600, days: 60, req: ['arm3'], fx: { attack: 1.7, org: 0.5 },
    desc: 'Единое информационное поле от спутника до солдата. Атака ×1,7, восстановление организации +50%.' },

  { id: 'nuc1', branch: 'nuclear', tier: 1, name: 'Модернизация ядерной триады', cost: 180, days: 30, req: [], fx: {},
    desc: 'Новые подлодки, бомбардировщики и шахтные комплексы.' },
  { id: 'nuc2', branch: 'nuclear', tier: 2, name: 'Система предупреждения о ракетном нападении', cost: 330, days: 40, req: ['nuc1'], fx: { rp: 0.05 },
    desc: 'Радары и спутники видят пуск за минуты. +5% ОИ.' },
  { id: 'nuc3', branch: 'nuclear', tier: 3, name: 'Доктрина ядерного сдерживания', cost: 540, days: 55, req: ['nuc2'], fx: {},
    desc: 'Политическое решение: при каких условиях держава применит оружие. Его испытание не останется незамеченным.' },
  { id: 'nuc4', branch: 'nuclear', tier: 4, name: 'Боевое дежурство «Сармат»', cost: 780, days: 70, req: ['nuc3'], fx: { nukes: true },
    desc: 'Тяжёлая МБР заступает на дежурство. ОТКРЫВАЕТ ЯДЕРНЫЙ УДАР. +1 боеголовка, далее +1 каждые 90 дней.' },
  { id: 'nuc5', branch: 'nuclear', tier: 5, name: 'Гиперзвуковой блок «Авангард»', cost: 1050, days: 90, req: ['nuc4'], fx: { thermo: true },
    desc: 'Перехватить невозможно. Удар уничтожает все войска цели и задевает соседей (−25% дивизий). Боеголовки — каждые 45 дней.' }
];

/* Национальные фокусы — в js/focuses.js (у каждой державы своё дерево) */

/* ---------------- ТАЙНЫЕ ОПЕРАЦИИ ---------------- */
const SPY_OPS = [
  { id: 'intel',    name: 'Сбор разведданных',   pp: 10, base: 0.85, icon: 'i-eye',
    desc: '+45 к уровню разведданных: точные сведения о дивизиях и обороне.' },
  { id: 'sabotage', name: 'Кибератака на оборону', pp: 25, base: 0.7,  icon: 'i-shield',
    desc: 'Связь, ПВО и логистика выведены из строя: −20% обороны цели на 45 дней (накапливается до −60%).' },
  { id: 'industry', name: 'Диверсия на заводах', pp: 35, base: 0.6,  icon: 'i-factory',
    desc: 'Уничтожить 1–3 завода противника.' }
];

const OP_NAMES = ['Гроза', 'Буря', 'Вихрь', 'Кутузов', 'Суворов', 'Полярная звезда', 'Стальной рассвет', 'Днепр', 'Метель',
  'Искра', 'Зарница', 'Таран', 'Северное сияние', 'Ураган', 'Клинок', 'Рубин', 'Молния', 'Гранит', 'Кремень', 'Сокол',
  'Беркут', 'Аврора', 'Гиперион', 'Цифровой щит', 'Восточный ветер'];

/* ---------------- БАТАЛЬОНЫ И ШАБЛОНЫ ДИВИЗИЙ ----------------
   Дивизия собирается из батальонов (до 10). Характеристики дивизии — сумма батальонов:
     att/def — вклад в атаку и оборону; org — «выносливость» (чем выше, тем медленнее тает организация в наступлении);
     speed — скорость марша (берётся у самого медленного: пешая пехота тормозит, остальное на технике); pp/mp/days — цена и время обучения.
   armor — танки: усиливаются технологиями «Армии нового поколения», помогают прорыву;
   antiArmor — ПТРК: в обороне гасят танковые удары. */
const BATTALIONS = {
  inf:  { name: 'Пехота',            short: 'ПЕХ',  att: 1.0, def: 1.3, org: 60, speed: 1.0, pp: 0.4, mp: 1.8, days: 1 },
  mot:  { name: 'Мотострелки на БМП', short: 'МСБ',  att: 1.2, def: 1.2, org: 50, speed: 1.6, pp: 0.8, mp: 1.8, days: 2 },
  tank: { name: 'Танки',             short: 'ТНК',  att: 3.0, def: 1.0, org: 30, speed: 1.5, pp: 1.2, mp: 1.0, days: 3, armor: true },
  art:  { name: 'Артиллерия и РСЗО', short: 'АРТ',  att: 2.0, def: 0.6, org: 20, speed: 1.5, pp: 0.8, mp: 0.8, days: 2 },
  at:   { name: 'ПТРК',              short: 'ПТРК', att: 0.6, def: 1.6, org: 20, speed: 1.5, pp: 0.7, mp: 0.8, days: 2, antiArmor: true }
};
const TEMPLATE_MAX_BATS = 10;
const TEMPLATE_MAX = 8;
// Стартовые шаблоны: названия у России, США и Китая, состав
const START_TEMPLATES = [
  { names: { SOV: 'Общевойсковая дивизия', WST: 'Пехотная дивизия', AXS: 'Общевойсковая дивизия НОАК', UA: 'Пехотная бригада' }, bats: { inf: 7, art: 2 } },
  { names: { SOV: 'Танковая дивизия', WST: 'Бронетанковая дивизия', AXS: 'Тяжёлая общевойсковая дивизия', UA: 'Танковая бригада' }, bats: { tank: 4, mot: 4, art: 1 } },
  { names: { SOV: 'Мотострелковая дивизия', WST: 'Дивизия «Страйкер»', AXS: 'Механизированная дивизия', UA: 'Механизированная бригада' }, bats: { mot: 6, art: 2, at: 1 } }
];

/* ---------------- ДЕРЖАВЫ (за них играют люди) ----------------
   Блок, который никто не выбрал, остаётся под управлением ИИ как обычные страны.
   leader/title — лидер на старте; дальше власть может смениться (выборы, фокусы, перевороты),
   актуального лидера даёт Game.leaderOf(тег). */
const POWERS = {
  SOV: {
    name: 'Россия', faction: 'SOV', allyFaction: 'COM', family: ['SOV', 'COM'],
    color: '#b3121f', side: '#4d070c', stroke: '#ff8a7a', emblem: 'i-star-emblem',
    capital: 'RUS', capitalPos: { lat: 55.75, lng: 37.62 }, capitalName: 'Москва', start: ['RUS'],
    rivals: ['USA', 'CHN'], pov: { lat: 52, lng: 60 },
    leader: 'Владимир Путин', title: 'Президент России',
    allyName: 'ОДКБ', mp: 1500, divs: 34, techs: ['nuc1', 'nuc2', 'arm1'],
    spirits: [{ id: 'sanctions', name: 'Санкции Запада', fx: { pp: -0.3, rp: -0.05 }, days: 720, desc: 'Ограничения на кредиты и технологии после 2014 года.' }],
    armies: [{ name: '1-я гвардейская танковая армия', divs: 10, tanks: 4, loc: 'RUS' }, { name: '20-я гвардейская армия', divs: 8, loc: 'RUS' },
      { name: '58-я армия', divs: 6, loc: 'RUS' }, { name: '5-я армия', divs: 5, loc: 'RUS' }],
    generals: ['Валерий Герасимов', 'Александр Дворников', 'Сергей Суровикин', 'Андрей Сердюков', 'Андрей Картаполов',
      'Олег Салюков', 'Александр Журавлёв', 'Сергей Рудской', 'Александр Лапин', 'Рустам Мурадов']
  },
  WST: {
    name: 'США', faction: 'WEST', allyFaction: 'WEST', family: ['WEST'],
    color: '#1747c9', side: '#0b1f55', stroke: '#9cc2ff', emblem: 'i-emblem-west',
    capital: 'USA', capitalPos: { lat: 38.9, lng: -77.04 }, capitalName: 'Вашингтон', start: ['USA'],
    rivals: ['RUS', 'CHN'], pov: { lat: 40, lng: -60 },
    leader: 'Дональд Трамп', title: 'Президент США',
    allyName: 'НАТО', mp: 1300, divs: 0, techs: ['nuc1', 'nuc2', 'ind1', 'arm1'],
    spirits: [{ id: 'polarization', name: 'Поляризация общества', fx: { pp: -0.2 }, days: 720, desc: 'Страна расколота пополам: каждое решение даётся с боем.' }],
    armies: [{ name: 'III корпус', divs: 12, tanks: 4, loc: 'USA' }, { name: 'XVIII воздушно-десантный корпус', divs: 10, loc: 'USA' },
      { name: 'I корпус', divs: 6, loc: 'USA' }],
    generals: ['Марк Милли', 'Кёртис Скапаротти', 'Тони Томас', 'Стивен Таунсенд', 'Роберт Абрамс', 'Пол Накасоне',
      'Майкл Гарретт', 'Джозеф Вотел', 'Кеннет Маккензи', 'Кристофер Каволи']
  },
  AXS: {
    name: 'Китай', faction: 'AXIS', allyFaction: 'AXIS', family: ['AXIS'],
    color: '#d99a00', side: '#4f3700', stroke: '#ffd97a', emblem: 'i-emblem-axis',
    capital: 'CHN', capitalPos: { lat: 39.9, lng: 116.4 }, capitalName: 'Пекин', start: ['CHN'],
    rivals: ['USA', 'RUS'], pov: { lat: 32, lng: 105 },
    leader: 'Си Цзиньпин', title: 'Председатель КНР',
    allyName: 'Пояс и путь', mp: 2600, divs: 0, techs: ['nuc1', 'ind1'],
    spirits: [{ id: 'aging', name: 'Старение населения', fx: { mpMult: -0.15 }, days: 1095, desc: 'Последствия политики «одна семья — один ребёнок».' }],
    armies: [{ name: 'Восточный театр', divs: 14, tanks: 4, loc: 'CHN' }, { name: 'Северный театр', divs: 12, tanks: 3, loc: 'CHN' },
      { name: 'Западный театр', divs: 8, loc: 'CHN' }, { name: 'Южный театр', divs: 6, loc: 'CHN' }],
    generals: ['Хань Вэйго', 'Ли Цзопэн', 'Сюй Цилян', 'Чжан Юся', 'Вэй Фэнхэ', 'Ли Шанфу', 'Хэ Вэйдун', 'Чжао Цзунци',
      'Ван Нин', 'Лю Юэцзюнь']
  }
};
POWERS.UA = {
  name: 'Украина', faction: 'UAF', allyFaction: 'GUAM', family: ['UAF', 'GUAM'],
  color: '#2fa3e0', side: '#0c3550', stroke: '#a8dcff', emblem: 'i-emblem-ua',
  capital: 'UKR', capitalPos: { lat: 50.45, lng: 30.52 }, capitalName: 'Киев', start: ['UKR'],
  rivals: ['RUS'], pov: { lat: 49, lng: 34 },
  leader: 'Пётр Порошенко', title: 'Президент Украины',
  allyName: 'ГУАМ', mp: 700, divs: 24, techs: ['arm1'],
  spirits: [
    { id: 'donbass', name: 'Война на Донбассе', fx: { pp: -0.25, mpMult: 0.1 }, days: 1460, desc: 'Линия соприкосновения, обстрелы, тысячи людей под ружьём.' },
    { id: 'corruption', name: 'Коррупция', fx: { rp: -0.05, pp: -0.1 }, days: 1095, desc: 'Олигархи и «схемы» тормозят реформы.' }
  ],
  armies: [{ name: 'ОК «Восток»', divs: 10, tanks: 3, loc: 'UKR' }, { name: 'ОК «Юг»', divs: 6, loc: 'UKR' }, { name: 'ОК «Север»', divs: 5, loc: 'UKR' }],
  generals: ['Виктор Муженко', 'Руслан Хомчак', 'Валерий Залужный', 'Сергей Наев', 'Александр Сырский', 'Михаил Забродский',
    'Юрий Содоль', 'Александр Павлюк', 'Сергей Шаптала', 'Евгений Мойсюк']
};
const POWER_TAGS = Object.keys(POWERS);

// Названия веток и технологий для США и Китая (у России — исходные)
const BRANCH_NAMES = {
  UA: { industry: 'Индустрия 4.0', armor: 'ВСУ нового образца', nuclear: 'Ракетная программа' },
  WST: { industry: 'Экономика инноваций', armor: 'Армия будущего', nuclear: 'Ядерная триада США' },
  AXS: { industry: 'Сделано в Китае', armor: 'Интеллектуализация НОАК', nuclear: 'Ракетные войска НОАК' }
};
const TECH_NAMES = {
  UA: { ind1: 'Электронное правительство', ind2: 'IT-кластеры', ind3: 'Оборонные стартапы', ind4: 'Цифровая экономика',
    arm1: 'Танк «Оплот»', arm2: 'Модернизация Т-64БМ «Булат»', arm3: 'Ударные беспилотники «Байрактар»', arm4: 'Стандарты НАТО',
    nuc1: 'Возрождение ракетной отрасли', nuc2: 'Противокорабельный «Нептун»', nuc3: 'Тайная ядерная программа', nuc4: 'Ракетный комплекс «Гром-2»', nuc5: 'Ядерный арсенал' },
  WST: { ind1: 'Облачные вычисления', ind2: 'Возвращение производств', ind3: 'Искусственный интеллект', ind4: 'Квантовое превосходство',
    arm1: 'M1A2C «Абрамс»', arm2: 'Программа OMFV', arm3: 'Рои беспилотников', arm4: 'Многодоменные операции',
    nuc1: 'Модернизация триады', nuc2: 'Космический эшелон SBIRS', nuc3: 'Обзор ядерной политики', nuc4: 'МБР «Сентинел»', nuc5: 'Гиперзвуковое оружие LRHW' },
  AXS: { ind1: 'Интернет плюс', ind2: 'Умные заводы', ind3: 'План развития ИИ', ind4: 'Квантовый спутник «Мо-цзы»',
    arm1: 'Танк «Тип 99А»', arm2: 'Колёсная бронетехника нового поколения', arm3: 'Беспилотники «Вин Лун»', arm4: 'Интеллектуализированная война',
    nuc1: 'Расширение арсенала', nuc2: 'Шахтные поля в пустыне Гоби', nuc3: 'Стратегия активной обороны', nuc4: 'МБР «Дунфэн-41»', nuc5: 'Гиперзвуковой «Дунфэн-17»' }
};
