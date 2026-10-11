'use strict';
/* ============================================================
   СТАТИЧЕСКИЕ ДАННЫЕ: настройки баланса, фракции, страны,
   технологии, национальные фокусы, тайные операции, события.
   Хотите поменять баланс — меняйте числа здесь.
   ============================================================ */

const CFG = {
  START_DATE: Date.UTC(1953, 2, 5),          // 5 марта 1953
  SPEEDS: [0, 1000, 500, 250, 100],           // мс реального времени на 1 игровой день (индекс 1..4)
  PLAYER: 'SOV',
  CAPITAL: 'RUS',
  CAPITAL_POS: { lat: 55.75, lng: 37.62 },    // Москва
  START: { pp: 50, mp: 1500, divs: 30, org: 100, rp: 40, tension: 12 },

  PP_BASE: 2.0,                // политвласть в день
  RP_BASE: 1.0,                // очки исследований в день
  RP_PER_FACTORY: 0.03,
  MP_PER_POP: 1e-8,            // тыс. призывников в день на одного жителя
  ANNEXED_MP: 0.5,             // присоединённые земли дают половину призывников

  DIV: { pp: 6, mp: 18, days: 14, attack: 10, defense: 10 },
  ORG_REGEN: 3.5,              // восстановление организации армии в день, %
  ENEMY_DIV_DEF: 9,

  JUSTIFY: { pp: 20, ppPerFactory: 0.8, ppMax: 90, days: 18, daysPerFactory: 0.6, tension: 2 },
  DECLARE_TENSION: 6,
  SPY_BASE_TENSION_FAIL: 2.5,
  FORTIFY_PP: 20,
  PEACE_PP: 25,
  INFLUENCE: { pp: 40, days: 45 },
  INTEGRATE: { pp: 60, days: 60 },

  WARHEAD_DAYS: 90,
  NUKE_TENSION: 30,
  NUCLEAR_WINTER: 7,           // столько пустошей — и мир погружается в ядерную зиму
  VICTORY_SHARE: 0.55,         // доля мировой промышленности для победы
  TENSION_DECAY: 0.06,
  AUTOSAVE_DAYS: 30,
  SAVE_KEY: 'red_meridian_save_v1',
  SETTINGS_KEY: 'red_meridian_settings_v1'
};

const FACTIONS = {
  SOV:  { name: 'СССР',               color: '#c8141e', side: '#5c0a0f', stroke: '#ff8a7a', leader: 'RUS' },
  COM:  { name: 'Коминтерн',          color: '#a23a52', side: '#431824', stroke: '#f0a0b0', leader: 'RUS' },
  WEST: { name: 'Западный блок',      color: '#2d67c4', side: '#12284d', stroke: '#9cc2ff', leader: 'USA' },
  AXIS: { name: 'Пакт Оси',           color: '#4c5059', side: '#1d1f24', stroke: '#b5bcc8', leader: 'DEU' },
  NEU:  { name: 'Неприсоединившиеся', color: '#6b6748', side: '#2a281b', stroke: '#b9b48e' },
  NONE: { name: 'Без государства',    color: '#7f8b96', side: '#30363c', stroke: '#c9d2da' }
};

// Множитель обороны дивизий по доктрине фракции
const FACTION_DEF = { SOV: 1.0, COM: 0.9, WEST: 1.15, AXIS: 1.1, NEU: 0.85, NONE: 0.5 };

const USSR_CORE = ['RUS', 'UKR', 'BLR', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'GEO', 'ARM', 'AZE', 'LTU', 'LVA', 'EST', 'MDA'];

// Альтернативная история: в 1945-м Запад подписал сепаратный мир с генеральской хунтой,
// и «Европейский Рейх» уцелел как третий полюс Холодной войны.
const FACTION_MEMBERS = {
  COM:  ['POL', 'CZE', 'SVK', 'ROU', 'BGR', 'ALB', 'MNG', 'PRK', 'CHN', 'VNM'],
  WEST: ['USA', 'GBR', 'FRA', 'CAN', 'ITA', 'NLD', 'BEL', 'LUX', 'NOR', 'DNK', 'ISL', 'TUR', 'GRC', 'JPN', 'KOR',
         'PHL', 'AUS', 'NZL', 'PAK', 'IRN', 'THA', 'TWN', 'ZAF', 'FLK', 'ATF', 'GRL', 'PRI', 'IRL', 'ISR'],
  AXIS: ['DEU', 'AUT', 'HUN', 'HRV', 'ESP', 'PRT', 'ARG'],
  NONE: ['ATA']
};

const MAJORS = ['USA', 'GBR', 'FRA', 'DEU', 'JPN', 'CHN', 'ITA', 'IND', 'CAN'];

// Ручные стартовые значения: заводы (fac), дивизии (divs), укрепления (fort)
const COUNTRY_OVERRIDES = {
  // СССР
  RUS: { fac: 42 }, UKR: { fac: 9 }, BLR: { fac: 3 }, KAZ: { fac: 4 }, UZB: { fac: 2 }, AZE: { fac: 2 },
  GEO: { fac: 1 }, ARM: { fac: 1 }, LTU: { fac: 1 }, LVA: { fac: 1 }, EST: { fac: 1 }, MDA: { fac: 1 },
  KGZ: { fac: 1 }, TJK: { fac: 1 }, TKM: { fac: 1 },
  // Западный блок
  USA: { fac: 60, divs: 38, fort: 1 }, GBR: { fac: 24, divs: 18, fort: 2 }, FRA: { fac: 16, divs: 16, fort: 1 },
  CAN: { fac: 9, divs: 6 }, ITA: { fac: 9, divs: 10 }, JPN: { fac: 10, divs: 8, fort: 1 }, TUR: { fac: 4, divs: 14, fort: 1 },
  NLD: { fac: 4, divs: 4 }, BEL: { fac: 4, divs: 4 }, NOR: { fac: 2, divs: 4, fort: 1 }, DNK: { fac: 1, divs: 2 },
  KOR: { fac: 2, divs: 10, fort: 1 }, TWN: { fac: 1, divs: 8, fort: 2 }, IRN: { fac: 2, divs: 6 }, PAK: { fac: 2, divs: 7 },
  AUS: { fac: 5, divs: 4 }, ZAF: { fac: 4, divs: 3 }, GRC: { fac: 1, divs: 6, fort: 1 }, ISR: { fac: 1, divs: 4, fort: 1 },
  // Пакт Оси
  DEU: { fac: 34, divs: 32, fort: 2 }, ESP: { fac: 6, divs: 12, fort: 1 }, ARG: { fac: 6, divs: 8 },
  HUN: { fac: 3, divs: 6 }, AUT: { fac: 3, divs: 5, fort: 1 }, HRV: { fac: 1, divs: 3 }, PRT: { fac: 2, divs: 4 },
  // Коминтерн
  CHN: { fac: 12, divs: 45 }, POL: { fac: 6, divs: 10 }, CZE: { fac: 5, divs: 6 }, SVK: { fac: 2, divs: 3 },
  ROU: { fac: 4, divs: 8 }, BGR: { fac: 2, divs: 5 }, ALB: { fac: 1, divs: 2 }, MNG: { fac: 1, divs: 3 },
  PRK: { fac: 2, divs: 8 }, VNM: { fac: 1, divs: 6 },
  // Неприсоединившиеся
  IND: { fac: 8, divs: 14 }, SWE: { fac: 5, divs: 6, fort: 1 }, CHE: { fac: 3, divs: 6, fort: 3 },
  FIN: { fac: 2, divs: 6, fort: 2 }, SRB: { fac: 3, divs: 10, fort: 1 }, EGY: { fac: 2, divs: 5 },
  BRA: { fac: 5, divs: 6 }, MEX: { fac: 3, divs: 4 }, IDN: { fac: 3, divs: 9 }, AFG: { fac: 0, divs: 4, fort: 2 },
  ATA: { fac: 0, divs: 0 }
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
  ['YEM', 'DJI'], ['SAU', 'EGY'], ['ISL', 'GRL'], ['DEU', 'SWE']
];

const DIFFICULTY = {
  easy:   { name: 'Курсант', desc: 'Слабая оборона врага, щедрая политвласть.', aiDef: 0.85, aiGrowth: 0.75, aiAggr: 0.6, pp: 1.25 },
  normal: { name: 'Маршал',  desc: 'Задуманный баланс сил.',                     aiDef: 1.0,  aiGrowth: 1.0,  aiAggr: 1.0, pp: 1.0 },
  hard:   { name: 'Генсек',  desc: 'Мир объединится против вас. Без права на ошибку.', aiDef: 1.2, aiGrowth: 1.3, aiAggr: 1.4, pp: 0.9 }
};

/* ---------------- ТЕХНОЛОГИИ ---------------- */
const TECH_BRANCHES = [
  { id: 'industry', icon: 'i-factory', name: 'Машиностроение двойного назначения', desc: 'Пассивный рост заводов и научного потенциала' },
  { id: 'armor',    icon: 'i-div',     name: 'Тяжёлые прорывные танки',            desc: 'Множитель силы атаки дивизий' },
  { id: 'nuclear',  icon: 'i-nuke',    name: 'Проект «Сокрушение Манхэттена»',     desc: 'Лаборатория №2: путь к стратегическому ядерному оружию' }
];

const TECHS = [
  { id: 'ind1', branch: 'industry', tier: 1, name: 'Станки двойного назначения', cost: 90, days: 20, req: [], fx: { factoryEvery: 30 },
    desc: 'Гражданские цеха переводятся на выпуск военной продукции. +1 завод каждые 30 дней.' },
  { id: 'ind2', branch: 'industry', tier: 2, name: 'Уральские конвейеры', cost: 195, days: 30, req: ['ind1'], fx: { factoryEvery: 20, rp: 0.15 },
    desc: '+1 завод каждые 20 дней, +15% очков исследований.' },
  { id: 'ind3', branch: 'industry', tier: 3, name: 'Плановая автоматизация', cost: 360, days: 40, req: ['ind2'], fx: { factoryEvery: 12, train: 0.25 },
    desc: '+1 завод каждые 12 дней, обучение дивизий быстрее на 25%.' },
  { id: 'ind4', branch: 'industry', tier: 4, name: 'Кибернетика Госплана', cost: 570, days: 55, req: ['ind3'], fx: { factoryEvery: 7, rp: 0.25, pp: 0.5 },
    desc: '+1 завод каждые 7 дней, +25% ОИ, +0,5 политвласти в день.' },

  { id: 'arm1', branch: 'armor', tier: 1, name: 'Т-54М «Прорыв»', cost: 90, days: 20, req: [], fx: { attack: 1.1 },
    desc: 'Модернизированный средний танк. Атака дивизий ×1,1.' },
  { id: 'arm2', branch: 'armor', tier: 2, name: 'ИС-7 «Молот»', cost: 210, days: 30, req: ['arm1'], fx: { attack: 1.25, train: 0.1 },
    desc: 'Тяжёлый танк прорыва. Атака ×1,25, обучение дивизий быстрее на 10%.' },
  { id: 'arm3', branch: 'armor', tier: 3, name: 'Объект 279', cost: 375, days: 45, req: ['arm2'], fx: { attack: 1.45, loss: 0.2 },
    desc: 'Четырёхгусеничный танк для ядерной войны. Атака ×1,45, потери в наступлении −20%.' },
  { id: 'arm4', branch: 'armor', tier: 4, name: 'Танковые армии прорыва', cost: 600, days: 60, req: ['arm3'], fx: { attack: 1.7, org: 0.5 },
    desc: 'Оперативные объединения нового типа. Атака ×1,7, восстановление организации +50%.' },

  { id: 'nuc1', branch: 'nuclear', tier: 1, name: 'Обогащение урана «Челябинск-40»', cost: 180, days: 30, req: [], fx: {},
    desc: 'Промышленное разделение изотопов урана-235.' },
  { id: 'nuc2', branch: 'nuclear', tier: 2, name: 'Реактор «Аннушка»', cost: 330, days: 40, req: ['nuc1'], fx: { rp: 0.05 },
    desc: 'Наработка оружейного плутония. +5% ОИ.' },
  { id: 'nuc3', branch: 'nuclear', tier: 3, name: 'Изделие РДС-Т «Гроза»', cost: 540, days: 55, req: ['nuc2'], fx: {},
    desc: 'Боевой ядерный заряд. Его испытание не останется незамеченным.' },
  { id: 'nuc4', branch: 'nuclear', tier: 4, name: 'Носитель Р-7 «Семёрка»', cost: 780, days: 70, req: ['nuc3'], fx: { nukes: true },
    desc: 'Межконтинентальная ракета. ОТКРЫВАЕТ ЯДЕРНЫЙ УДАР. +1 боеголовка, далее +1 каждые 90 дней.' },
  { id: 'nuc5', branch: 'nuclear', tier: 5, name: 'Термоядерное изделие «Царь»', cost: 1050, days: 90, req: ['nuc4'], fx: { thermo: true },
    desc: 'Удар уничтожает все войска цели и задевает соседей (−25% дивизий). Боеголовки — каждые 45 дней.' }
];

/* ---------------- НАЦИОНАЛЬНЫЕ ФОКУСЫ ---------------- */
const FOCUSES = [
  { id: 'f_course', x: 2, y: 0, days: 35, req: [], name: 'Курс Громова', fx: { pp: 0.5 },
    desc: 'Новый лидер укрепляет вертикаль власти. +0,5 политвласти в день.' },
  { id: 'f_plan', x: 0, y: 1, days: 50, req: ['f_course'], name: 'Пятилетка ускорения', fx: { factories: 5 },
    desc: '+5 заводов немедленно.' },
  { id: 'f_mobil', x: 2, y: 1, days: 50, req: ['f_course'], name: 'Всеобщая мобилизация', fx: { mp: 400, mpMult: 0.3 },
    desc: '+400 тыс. призывников сразу, прирост призывников +30%.' },
  { id: 'f_kgb', x: 4, y: 1, days: 45, req: ['f_course'], name: 'Комитет госбезопасности', fx: { spyCost: 0.3, spyChance: 0.15 },
    desc: 'Тайные операции дешевле на 30%, шанс успеха +15%.' },
  { id: 'f_atom', x: 0, y: 2, days: 60, req: ['f_plan'], name: 'Атомный приоритет', fx: { nucCost: 0.2, nucDays: 0.4 },
    desc: 'Ядерная ветка исследований: −20% к стоимости, −40% ко времени.' },
  { id: 'f_deep', x: 2, y: 2, days: 60, req: ['f_mobil'], name: 'Теория глубокой операции', fx: { attackBonus: 0.1, org: 0.25 },
    desc: '+10% к атаке, восстановление организации +25%.' },
  { id: 'f_curtain', x: 4, y: 2, days: 45, req: ['f_kgb'], name: 'Железный занавес', fx: { spyTension: 0.5, intelKeep: true },
    desc: 'Провалы разведки повышают напряжённость вдвое меньше. Разведданные не устаревают.' },
  { id: 'f_revolution', x: 1, y: 3, days: 70, req: ['f_deep'], excl: ['f_coexist'], name: 'Мировая революция', fx: { justify: 0.4, attackBonus: 0.1 },
    desc: 'Обоснование войны −40% к стоимости и времени, +10% к атаке. Исключает соседний мирный курс.' },
  { id: 'f_coexist', x: 3, y: 3, days: 70, req: ['f_curtain'], excl: ['f_revolution'], name: 'Мирное сосуществование', fx: { tensionDecay: 3, pp: 1, influence: 0.4 },
    desc: 'Напряжённость спадает втрое быстрее, +1 ПВ в день, распространение влияния −40% ПВ. Исключает соседний военный курс.' },
  { id: 'f_hegemony', x: 2, y: 4, days: 90, reqAny: ['f_revolution', 'f_coexist'], name: 'Красная гегемония', fx: { pp: 1, rp: 0.15, factories: 5 },
    desc: '+1 ПВ в день, +15% ОИ, +5 заводов.' }
];

/* ---------------- ТАЙНЫЕ ОПЕРАЦИИ ---------------- */
const SPY_OPS = [
  { id: 'intel',    name: 'Сбор разведданных',   pp: 10, base: 0.85, icon: 'i-eye',
    desc: '+45 к уровню разведданных: точные сведения о дивизиях и обороне.' },
  { id: 'sabotage', name: 'Саботаж обороны',     pp: 25, base: 0.7,  icon: 'i-shield',
    desc: '−20% обороны цели на 45 дней (накапливается до −60%).' },
  { id: 'industry', name: 'Диверсия на заводах', pp: 35, base: 0.6,  icon: 'i-factory',
    desc: 'Уничтожить 1–3 завода противника.' }
];

const OP_NAMES = ['Багратион-2', 'Гроза', 'Буря', 'Вихрь', 'Кутузов', 'Суворов', 'Полярная звезда', 'Красный молот',
  'Стальной рассвет', 'Днепр', 'Метель', 'Искра', 'Уран-2', 'Зарница', 'Таран', 'Северное сияние', 'Ураган', 'Клинок',
  'Рубин', 'Молния', 'Гранит', 'Кремень', 'Сокол', 'Беркут', 'Аврора'];

/* ---------------- ДЕРЖАВЫ (за них играют люди) ----------------
   Блок, который никто не выбрал, остаётся под управлением ИИ как обычные страны. */
const POWERS = {
  SOV: {
    name: 'СССР', faction: 'SOV', allyFaction: 'COM', family: ['SOV', 'COM'],
    color: '#c8141e', side: '#5c0a0f', stroke: '#ff8a7a', emblem: 'i-star-emblem',
    capital: 'RUS', capitalPos: { lat: 55.75, lng: 37.62 }, capitalName: 'Москва', start: USSR_CORE,
    rivals: ['USA', 'DEU'], pov: { lat: 48, lng: 55 },
    leader: 'Аркадий Громов', initials: 'АГ', title: 'Генеральный секретарь ЦК', trait: '«Стальной инженер»',
    bio: 'Бывший инженер-танкист и герой Курской дуги. Неожиданный выбор Президиума — технократ, верящий в машины больше, чем в лозунги.',
    allyName: 'Коминтерн', mp: 1500, divs: 30
  },
  WST: {
    name: 'США', faction: 'WEST', allyFaction: 'WEST', family: ['WEST'],
    color: '#1747c9', side: '#0b1f55', stroke: '#9cc2ff', emblem: 'i-emblem-west',
    capital: 'USA', capitalPos: { lat: 38.9, lng: -77.04 }, capitalName: 'Вашингтон', start: ['USA'],
    rivals: ['RUS', 'DEU'], pov: { lat: 40, lng: -60 },
    leader: 'Гарольд Стэнтон', initials: 'ГС', title: 'Президент США', trait: '«Арсенал демократии»',
    bio: 'Генерал инженерных войск, строивший мосты через Рейн. Избран на волне страха перед Москвой и Берлином.',
    allyName: 'Западный блок', mp: 1300, divs: 0
  },
  AXS: {
    name: 'Германский Рейх', faction: 'AXIS', allyFaction: 'AXIS', family: ['AXIS'],
    color: '#22252b', side: '#0d0e10', stroke: '#c9ced6', emblem: 'i-emblem-axis',
    capital: 'DEU', capitalPos: { lat: 52.52, lng: 13.4 }, capitalName: 'Берлин', start: ['DEU', 'AUT'],
    rivals: ['RUS', 'USA'], pov: { lat: 48, lng: 15 },
    leader: 'Конрад фон Ведель', initials: 'КВ', title: 'Рейхсканцлер', trait: '«Технократ»',
    bio: 'Генерал-инженер, возглавивший хунту после сепаратного мира 1945-го. Мечтает вернуть Рейху утраченное величие.',
    allyName: 'Пакт Оси', mp: 1000, divs: 0
  }
};
const POWER_TAGS = Object.keys(POWERS);

// Названия веток, технологий и фокусов для США и Рейха (у СССР — исходные)
const BRANCH_NAMES = {
  WST: { industry: 'Арсенал демократии', armor: 'Тяжёлые танки прорыва', nuclear: 'Манхэттенский проект II' },
  AXS: { industry: 'Рурская индустрия', armor: 'Панцерваффе нового поколения', nuclear: 'Урановый проект' }
};
const TECH_NAMES = {
  WST: { ind1: 'Конверсия гражданских заводов', ind2: 'Конвейеры Детройта', ind3: 'Автоматизация производства', ind4: 'Электронные вычислительные центры',
    arm1: 'M48 «Паттон»', arm2: 'Тяжёлый танк T43', arm3: 'Штурмовой танк T95', arm4: 'Бронетанковые корпуса прорыва',
    nuc1: 'Обогащение урана в Ок-Ридже', nuc2: 'Реакторы Хэнфорда', nuc3: 'Компактный заряд Mk-7', nuc4: 'Ракета «Атлас»', nuc5: 'Термоядерный заряд «Касл»' },
  AXS: { ind1: 'Рурские станкостроительные заводы', ind2: 'Конвейеры Вольфсбурга', ind3: 'Министерство вооружений: автоматизация', ind4: 'Электромеханические вычислители',
    arm1: '«Пантера II»', arm2: '«Тигр III»', arm3: 'Сверхтяжёлый танк «Маус II»', arm4: 'Танковые армии прорыва',
    nuc1: 'Урановая машина', nuc2: 'Тяжеловодный реактор', nuc3: 'Изделие «Вундерваффе»', nuc4: 'Ракета A-10 «Америка»', nuc5: 'Термоядерный заряд «Сумерки богов»' }
};
const FOCUS_NAMES = {
  WST: { f_course: 'Курс Стэнтона', f_plan: 'Военная экономика', f_mobil: 'Выборочная служба', f_kgb: 'Центральное разведуправление',
    f_atom: 'Атомный приоритет', f_deep: 'Воздушно-наземная операция', f_curtain: 'Охота на ведьм', f_revolution: 'Отбрасывание',
    f_coexist: 'Сдерживание', f_hegemony: 'Pax Americana' },
  AXS: { f_course: 'Курс фон Веделя', f_plan: 'Четырёхлетний план', f_mobil: 'Тотальная мобилизация', f_kgb: 'Абвер-II',
    f_atom: 'Урановый приоритет', f_deep: 'Блицкриг нового типа', f_curtain: 'Стальной занавес', f_revolution: 'Новый порядок',
    f_coexist: 'Европейский концерт', f_hegemony: 'Европейская гегемония' }
};

/* ---------------- СОБЫТИЯ ----------------
   date — событие наступит не раньше этой даты (если выполнено условие cond)
   weight — участвует в случайном розыгрыше
   art — иконка на «иллюстрации» события
*/
const EVENTS = [
  {
    id: 'korea_armistice', date: '1953-07-27', art: 'i-flag', cat: 'dip',
    cond: () => Game.isIndependent('PRK') && Game.isIndependent('KOR'),
    title: 'Перемирие в Корее',
    text: 'В Пханмунджоме представители КНДР, Китая и войск ООН готовы подписать перемирие. Генштаб докладывает: возобновить войну можно в любой момент — но Вашингтон ждёт именно этого.',
    options: [
      { label: 'Подписать перемирие', tip: 'Напряжённость −5 · +15 ПВ', fx: () => { Game.addTension(-5); Game.addPP(15); } },
      { label: 'Сорвать переговоры', tip: 'Напряжённость +6 · КНДР +6 дивизий · повод для войны с Южной Кореей',
        fx: () => { Game.addTension(6); Game.c('PRK').divs += 6; const k = Game.c('KOR'); if (k && !Game.atWar(k)) k.cb[Game.cur] = true; Bus.emit('mapDirty'); } }
    ]
  },
  {
    id: 'castle_bravo', date: '1954-03-01', art: 'i-nuke', cat: 'alert',
    title: 'Операция «Касл Браво»',
    text: 'На атолле Бикини американцы взорвали термоядерное устройство мощностью 15 мегатонн. Радиоактивный пепел накрыл японскую шхуну. Курчатов просит у Политбюро новых ресурсов.',
    options: [
      { label: 'Ускорить Лабораторию №2', tip: '−25 ПВ · ускорить атомные исследования на 20 дней (или +80 ОИ)',
        fx: () => { Game.addPP(-25); if (!Game.boostResearch('nuclear', 20)) Game.addRP(80); } },
      { label: 'Призвать к мораторию', tip: 'Напряжённость −6 · +5 ПВ', fx: () => { Game.addTension(-6); Game.addPP(5); } }
    ]
  },
  {
    id: 'geneva', date: '1955-07-18', art: 'i-flag', cat: 'dip',
    title: 'Женевское совещание',
    text: 'Лидеры Запада впервые садятся за один стол с советской делегацией. Президент США предлагает «открытое небо». Что ответит Громов?',
    options: [
      { label: 'Протянуть руку Западу', tip: 'Напряжённость −8 · разведданные по Западному блоку +20',
        fx: () => { Game.addTension(-8); Game.eachCountry(c => { if (c.faction === 'WEST') c.intel[Game.cur] = Math.min(100, Game.intel(c) + 20); }); } },
      { label: 'Продемонстрировать силу', tip: 'Напряжённость +4 · +30 ПВ', fx: () => { Game.addTension(4); Game.addPP(30); } }
    ]
  },
  {
    id: 'hungary', date: '1956-10-23', art: 'i-swords', cat: 'alert',
    cond: () => Game.isIndependent('HUN') && Game.c('HUN').faction === 'AXIS',
    title: 'Будапештское восстание',
    text: 'Студенты и рабочие Будапешта поднялись против прогерманского режима. Рейх перебрасывает войска к Дунаю. Венгерские коммунисты просят оружия.',
    options: [
      { label: 'Поддержать восставших оружием', tip: '−30 ПВ · напряжённость +6 · 60%: Венгрия вступает в Коминтерн',
        fx: () => {
          Game.addPP(-30); Game.addTension(6);
          const h = Game.c('HUN');
          if (U.chance(0.6)) { Game.setFaction('HUN', 'COM'); Game.log('success', 'Венгрия свободна', 'Восставшие взяли власть. Венгрия вступает в Коминтерн.', 'HUN'); }
          else { h.divs *= 0.6; h.cb[Game.cur] = true; Game.log('alert', 'Восстание подавлено', 'Войска Рейха утопили восстание в крови. Повод для войны с Венгрией получен.', 'HUN'); }
        } },
      { label: 'Не вмешиваться', tip: '+10 ПВ', fx: () => Game.addPP(10) }
    ]
  },
  {
    id: 'suez', date: '1956-10-29', art: 'i-globe', cat: 'dip',
    cond: () => Game.isIndependent('EGY') && Game.c('EGY').faction === 'NEU',
    title: 'Суэцкий кризис',
    text: 'Насер национализировал Суэцкий канал. Британские и французские десантники высаживаются в Порт-Саиде. Каир ждёт слова Москвы.',
    options: [
      { label: 'Пригрозить Лондону и Парижу', tip: 'Напряжённость +7 · Египет вступает в Коминтерн',
        fx: () => { Game.addTension(7); Game.setFaction('EGY', 'COM'); } },
      { label: 'Сохранить нейтралитет', tip: '+15 ПВ · напряжённость −2', fx: () => { Game.addPP(15); Game.addTension(-2); } }
    ]
  },
  {
    id: 'cuba', date: '1959-01-01', art: 'i-flag', cat: 'dip',
    cond: () => Game.isIndependent('CUB') && Game.c('CUB').faction === 'NEU',
    title: 'Революция на Кубе',
    text: 'Барбудос Фиделя Кастро вошли в Гавану. Новое правительство ищет друзей — в девяноста милях от Флориды.',
    options: [
      { label: 'Признать правительство Кастро', tip: 'Куба вступает в Коминтерн · напряжённость +5',
        fx: () => { Game.setFaction('CUB', 'COM'); Game.addTension(5); } },
      { label: 'Не вмешиваться', tip: '+10 ПВ', fx: () => Game.addPP(10) }
    ]
  },
  {
    id: 'caribbean', date: '1962-10-16', art: 'i-nuke', cat: 'alert',
    cond: () => Game.c('CUB') && Game.c('CUB').faction === 'COM' && Game.isIndependent('USA'),
    title: 'Карибский кризис',
    text: 'Самолёт-разведчик U-2 сфотографировал на Кубе стартовые позиции ракет. Флот США блокирует остров. Мир на грани.',
    options: [
      { label: 'Не отступать', tip: 'Напряжённость +18 · +80 ПВ · 30%: США объявляют войну',
        fx: () => { Game.addTension(18); Game.addPP(80); if (U.chance(0.3)) Game.aiDeclareWar('USA', Game.cur, 'Карибский кризис перерос в войну'); } },
      { label: 'Пойти на компромисс', tip: 'Напряжённость −15 · +20 ПВ', fx: () => { Game.addTension(-15); Game.addPP(20); } }
    ]
  },

  /* --- Случайные события --- */
  {
    id: 'harvest', weight: 3, art: 'i-factory', cat: 'info',
    title: 'Неурожай на целинных землях',
    text: 'Засуха погубила урожай в Казахстане и на Алтае. Госплан докладывает о нехватке зерна.',
    options: [
      { label: 'Закупить зерно за границей', tip: '−20 ПВ', fx: () => Game.addPP(-20) },
      { label: 'Затянуть пояса', tip: '−120 тыс. призывников', fx: () => Game.addMP(-120) }
    ]
  },
  {
    id: 'defector', weight: 2, art: 'i-eye', cat: 'intel',
    cond: () => Game.isIndependent('USA'),
    title: 'Перебежчик из ЦРУ',
    text: 'Сотрудник резидентуры ЦРУ в Вене попросил политического убежища. У него с собой микрофильмы.',
    options: [
      { label: 'Выжать всё до капли', tip: 'Полные разведданные по США · Западный блок +25 разведданных',
        fx: () => { Game.eachCountry(c => { if (c.faction === 'WEST') c.intel[Game.cur] = Math.min(100, Game.intel(c) + 25); }); Game.c('USA').intel[Game.cur] = 100; } },
      { label: 'Обменять на наших агентов', tip: 'Напряжённость −4 · +10 ПВ', fx: () => { Game.addTension(-4); Game.addPP(10); } }
    ]
  },
  {
    id: 'strikes', weight: 2, art: 'i-flag', cat: 'dip',
    cond: () => Game.isIndependent('FRA') || Game.isIndependent('ITA'),
    title: 'Забастовки в Западной Европе',
    text: 'Профсоюзы Франции и Италии вывели на улицы миллионы рабочих. Местные компартии просят поддержки.',
    options: [
      { label: 'Финансировать компартии', tip: '−20 ПВ · Франция и Италия: −15% дивизий и саботаж · напряжённость +2',
        fx: () => {
          Game.addPP(-20); Game.addTension(2);
          ['FRA', 'ITA'].forEach(id => { const c = Game.c(id); if (c && c.ctrl === id) { c.divs *= 0.85; Game.applySabotage(c, 0.1, 30); } });
        } },
      { label: 'Не вмешиваться', tip: '+8 ПВ', fx: () => Game.addPP(8) }
    ]
  },
  {
    id: 'academy', weight: 3, art: 'i-rp', cat: 'sci',
    title: 'Прорыв в Академии наук',
    text: 'Новосибирские физики добились результата, который опережает западные лаборатории на годы.',
    options: [
      { label: 'Направить в оборонку', tip: '+60 ОИ', fx: () => Game.addRP(60) },
      { label: 'Направить в промышленность', tip: '+2 завода', fx: () => Game.addFactories(2) }
    ]
  },
  {
    id: 'axis_drills', weight: 2, art: 'i-div', cat: 'mil',
    cond: () => Game.isIndependent('DEU') && Game.c('DEU').faction === 'AXIS' && !Game.atWar(Game.c('DEU')),
    title: 'Учения Оси у границ',
    text: 'Панцерваффе Рейха проводят крупнейшие с 1944 года манёвры у польской границы.',
    options: [
      { label: 'Ответные манёвры', tip: 'Германия +3 дивизии · организация армии 100% · напряжённость +3',
        fx: () => { Game.c('DEU').divs += 3; Game.P().org = 100; Game.addTension(3); } },
      { label: 'Дипломатический протест', tip: 'Германия +3 дивизии · +8 ПВ', fx: () => { Game.c('DEU').divs += 3; Game.addPP(8); } }
    ]
  },
  {
    id: 'volunteers', weight: 2, art: 'i-mp', cat: 'mil',
    cond: () => Game.c('CHN') && Game.c('CHN').faction === 'COM',
    title: 'Добровольцы из Китая',
    text: 'Пекин предлагает направить в распоряжение советского командования корпус народных добровольцев.',
    options: [
      { label: 'Принять добровольцев', tip: '+4 дивизии · напряжённость +1', fx: () => { Game.addDivs(4); Game.addTension(1); } },
      { label: 'Направить их на стройки', tip: '+2 завода', fx: () => Game.addFactories(2) }
    ]
  },
  {
    id: 'uprising', weight: 3, art: 'i-swords', cat: 'alert',
    cond: () => Game.annexedLands().length > 0,
    title: 'Волнения на присоединённых землях',
    setup: () => ({ target: U.pick(Game.annexedLands()).id }),
    text: ctx => `В ${Game.c(ctx.target).name} вспыхнули беспорядки. Подпольщики жгут склады и нападают на патрули.`,
    options: [
      { label: 'Ввести войска', tip: '−2 дивизии', fx: () => Game.addDivs(-2) },
      { label: 'Объявить амнистию', tip: '−25 ПВ', fx: () => Game.addPP(-25) },
      { label: 'Игнорировать', tip: 'Регион теряет 30% заводов',
        fx: ctx => { const c = Game.c(ctx.target); c.factories = Math.floor(c.factories * 0.7); } }
    ]
  },
  {
    id: 'spy_scandal', weight: 2, art: 'i-eye', cat: 'intel',
    cond: () => Game.P().stats.spyOk + Game.P().stats.spyFail >= 3,
    title: 'Шпионский скандал',
    text: 'Западная пресса публикует имена советских агентов. Посольства требуют объяснений.',
    options: [
      { label: 'Отрицать всё', tip: 'Напряжённость +3', fx: () => Game.addTension(3) },
      { label: 'Пожертвовать резидентурой', tip: '−15 ПВ · напряжённость −2', fx: () => { Game.addPP(-15); Game.addTension(-2); } }
    ]
  },
  {
    id: 'oil', weight: 2, art: 'i-factory', cat: 'success',
    title: 'Нефть Татарии',
    text: 'Геологи открыли гигантское Ромашкинское месторождение. «Второе Баку» даст топливо армии и заводам.',
    options: [{ label: 'Слава советским геологам!', tip: '+2 завода · +10 ПВ', fx: () => { Game.addFactories(2); Game.addPP(10); } }]
  },
  {
    id: 'nonaligned', weight: 2, art: 'i-globe', cat: 'dip',
    cond: () => Game.isIndependent('IND') && Game.c('IND').faction === 'NEU',
    title: 'Движение неприсоединения',
    text: 'Неру, Насер и Тито провозглашают «третий путь». Индия колеблется.',
    options: [
      { label: 'Поддержать Неру', tip: '−15 ПВ · 35%: Индия вступает в Коминтерн',
        fx: () => { Game.addPP(-15); Game.c('IND').intel[Game.cur] = Math.min(100, Game.intel(Game.c('IND')) + 30); if (U.chance(0.35)) Game.setFaction('IND', 'COM'); } },
      { label: 'Игнорировать', tip: '+5 ПВ', fx: () => Game.addPP(5) }
    ]
  },
  {
    id: 'reich_crisis', weight: 1, art: 'i-flag', cat: 'intel',
    cond: () => Game.isIndependent('DEU') && Game.c('DEU').faction === 'AXIS' && !Game.atWar(Game.c('DEU')),
    title: 'Кризис наследования в Рейхе',
    text: 'Старый фельдмаршал при смерти. Генералы делят власть, а МГБ имеет выходы на заговорщиков.',
    options: [
      { label: 'Поддержать заговорщиков', tip: '−30 ПВ · Германия −25% дивизий и саботаж обороны',
        fx: () => { Game.addPP(-30); const d = Game.c('DEU'); d.divs *= 0.75; Game.applySabotage(d, 0.2, 60); } },
      { label: 'Выждать', tip: '+5 ПВ', fx: () => Game.addPP(5) }
    ]
  },
  {
    id: 'marshall', weight: 1, art: 'i-factory', cat: 'info',
    cond: () => Game.S.tension >= 40 && Game.isIndependent('USA'),
    title: 'План Маршалла-2',
    text: 'Конгресс США одобрил гигантскую программу перевооружения союзников.',
    options: [{ label: 'Осудить «империалистов»', tip: 'Западный блок +1 завод в каждой стране · +10 ПВ',
      fx: () => { Game.eachCountry(c => { if (c.faction === 'WEST' && c.ctrl === c.id && !c.radioactive) c.factories += 1; }); Game.addPP(10); } }]
  },

  /* --- События США (powers: ['WST']) --- */
  {
    id: 'w_mccarthy', powers: ['WST'], weight: 2, art: 'i-eye', cat: 'intel',
    title: 'Комиссия по антиамериканской деятельности',
    text: 'Сенатор требует проверить на лояльность всех сотрудников Госдепартамента. Газеты ищут «красных» под каждой кроватью.',
    options: [
      { label: 'Поддержать проверки', tip: '+20 ПВ · напряжённость +2', fx: () => { Game.addPP(20); Game.addTension(2); } },
      { label: 'Остановить истерию', tip: '−10 ПВ · напряжённость −3', fx: () => { Game.addPP(-10); Game.addTension(-3); } }
    ]
  },
  {
    id: 'w_highways', powers: ['WST'], weight: 2, art: 'i-factory', cat: 'success',
    title: 'Система межштатных автострад',
    text: 'Конгресс одобрил строительство сети скоростных дорог — для экономики и для переброски войск.',
    options: [
      { label: 'Строить для экономики', tip: '+3 завода', fx: () => Game.addFactories(3) },
      { label: 'Строить для армии', tip: 'Организация армии 100% · +20 ПВ', fx: () => { Game.P().org = 100; Game.addPP(20); } }
    ]
  },
  {
    id: 'w_retaliation', powers: ['WST'], weight: 1, art: 'i-nuke', cat: 'alert',
    title: 'Доктрина массированного возмездия',
    text: 'Госсекретарь предлагает объявить: на любую агрессию США ответят ударом по местам и средствами по своему выбору.',
    options: [
      { label: 'Объявить доктрину', tip: '+60 ОИ · напряжённость +5', fx: () => { Game.addRP(60); Game.addTension(5); } },
      { label: 'Сохранить двусмысленность', tip: '+15 ПВ', fx: () => Game.addPP(15) }
    ]
  },

  /* --- События Рейха (powers: ['AXS']) --- */
  {
    id: 'a_ruhr', powers: ['AXS'], weight: 2, art: 'i-factory', cat: 'success',
    title: 'Рурское экономическое чудо',
    text: 'Восстановленные шахты и домны Рура работают в три смены. Промышленники требуют государственных заказов.',
    options: [
      { label: 'Военные заказы', tip: '+2 завода · +2 дивизии', fx: () => { Game.addFactories(2); Game.addDivs(2); } },
      { label: 'Гражданская экономика', tip: '+4 завода', fx: () => Game.addFactories(4) }
    ]
  },
  {
    id: 'a_vienna', powers: ['AXS'], weight: 2, art: 'i-flag', cat: 'alert',
    title: 'Волнения в Вене',
    text: 'Австрийские студенты требуют автономии. Гауляйтер просит прислать войска.',
    options: [
      { label: 'Ввести войска', tip: '−2 дивизии · напряжённость +1', fx: () => { Game.addDivs(-2); Game.addTension(1); } },
      { label: 'Пойти на уступки', tip: '−20 ПВ', fx: () => Game.addPP(-20) }
    ]
  },
  {
    id: 'a_scientists', powers: ['AXS'], weight: 1, art: 'i-rp', cat: 'sci',
    title: 'Учёные возвращаются из эмиграции',
    text: 'Группа физиков, бежавших в 1930-е, согласилась вернуться — за гарантии свободы исследований.',
    options: [
      { label: 'Дать гарантии', tip: '+80 ОИ · −15 ПВ', fx: () => { Game.addRP(80); Game.addPP(-15); } },
      { label: 'Отказать', tip: '+10 ПВ', fx: () => Game.addPP(10) }
    ]
  }
];
